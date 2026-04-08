use tauri::{State, AppHandle, Emitter};
use crate::state::AppState;
use crate::error::{AppError, AppResult};
use crate::ai::llm_client::{Message, LLMOptions};
use crate::ai::prompts;
use crate::ai::safety;

/// 流式讲解 + 可视化生成
///
/// 行为：
/// 1. 命中 explanations 缓存 → 直接返回（仍发一次 chunk + done 事件，便于前端统一处理）
/// 2. 未命中且 LLM 可用 → 调用 LLM 流式输出，逐 token emit `explanation:chunk`
///    - 同时尾部解析 ```visual ... ``` 代码块，写回缓存
/// 3. LLM 不可用 → 返回静态兜底讲解（无可视化）
///
/// 事件 payload：
/// - `explanation:chunk` { request_id, delta }
/// - `explanation:done`  { request_id, full_text, visual_spec(JSON|null), from_cache }
#[tauri::command]
pub async fn generate_explanation_stream(
    app: AppHandle,
    request_id: String,
    question_id: String,
    student_id: Option<String>,
    session_id: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<serde_json::Value> {
    tracing::info!("讲解请求: {} (req={})", question_id, request_id);

    // === 1. 取题目信息（AI 动态题优先） ===
    let question = state.ai_questions.get(&question_id).map(|r| r.clone())
        .or_else(|| state.question_bank.questions.iter().find(|q| q.id == question_id).cloned())
        .ok_or_else(|| AppError::NotFound(format!("题目 {} 不存在", question_id)))?;

    // === 2. 命中缓存？===
    let cached: Option<(String, Option<String>)> = {
        let db = state.db.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        db.query_row(
            "SELECT explanation_text, visual_spec FROM explanations WHERE question_id = ?1",
            rusqlite::params![question_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .ok()
    };

    if let Some((text, visual_json)) = cached {
        tracing::debug!("讲解缓存命中: {}", question_id);

        // 一次性 emit 文本（前端仍走流式渲染逻辑）
        let _ = app.emit(
            "explanation:chunk",
            serde_json::json!({ "request_id": request_id, "delta": text }),
        );

        let visual_spec: serde_json::Value = visual_json
            .as_deref()
            .and_then(|s| serde_json::from_str(s).ok())
            .unwrap_or(serde_json::json!({ "type": "none" }));

        let _ = app.emit(
            "explanation:done",
            serde_json::json!({
                "request_id": request_id,
                "full_text": text,
                "visual_spec": visual_spec,
                "from_cache": true,
            }),
        );

        // 写事件日志
        log_event(&state, student_id.as_deref(), session_id.as_deref(), "explanation_request",
            serde_json::json!({"question_id": question_id, "from_cache": true}));

        return Ok(serde_json::json!({
            "request_id": request_id,
            "from_cache": true,
            "full_text": text,
        }));
    }

    // === 3. 取 LLM 客户端 ===
    let llm_clone = {
        let guard = state.llm_client.lock().map_err(|e: std::sync::PoisonError<_>| AppError::Internal(e.to_string()))?;
        guard.clone()
    };

    // 学生年级（默认 6）
    let grade = student_id
        .as_deref()
        .and_then(|sid| {
            let db = state.db.lock().ok()?;
            db.query_row(
                "SELECT grade FROM students WHERE id = ?1",
                rusqlite::params![sid],
                |row| row.get::<_, i32>(0),
            )
            .ok()
        })
        .unwrap_or(6);

    // === 3a. 流式讲解（第一层：explain_text_only，纯 markdown，不含 visual 块） ===
    let explain_prompt = prompts::explain_text_only(
        &question.content_latex,
        &question.answer_latex,
        grade,
        &question.unit,
    );

    let display_text_raw = if let Some(ref llm) = llm_clone {
        let messages = vec![
            Message {
                role: "system".to_string(),
                content: "你是一个小学数学讲解老师，只输出 markdown 讲解，不生成任何可视化代码块。".to_string(),
            },
            Message {
                role: "user".to_string(),
                content: explain_prompt,
            },
        ];

        let opts = LLMOptions {
            temperature: Some(0.6),
            max_tokens: Some(1200),
            top_p: Some(0.9),
        };

        let app_clone = app.clone();
        let req_id_clone = request_id.clone();
        let stream_result = llm
            .complete_stream(&messages, &opts, move |delta| {
                let _ = app_clone.emit(
                    "explanation:chunk",
                    serde_json::json!({
                        "request_id": req_id_clone,
                        "delta": delta,
                    }),
                );
            })
            .await;

        match stream_result {
            Ok(text) => text,
            Err(e) => {
                tracing::warn!("LLM 流式讲解失败: {}, 走兜底", e);
                fallback_explanation(&question.unit, &question.content_latex, &question.answer_latex)
            }
        }
    } else {
        let text = fallback_explanation(&question.unit, &question.content_latex, &question.answer_latex);
        let _ = app.emit(
            "explanation:chunk",
            serde_json::json!({ "request_id": request_id, "delta": text }),
        );
        text
    };

    // === 4. 安全过滤（讲解正文）===
    let safety_result = safety::sanitize_output(&display_text_raw);
    let display_text = if safety_result.is_safe {
        display_text_raw
    } else {
        tracing::warn!("[explain] LLM 讲解触发 {} 项安全规则，已清洗", safety_result.violations.len());
        safety_result.sanitized
    };

    // === 4a. 可视化三层漏斗 ===
    let visual_spec: Option<serde_json::Value> = if !is_geometric_question(&question.content_latex) {
        // 第一层：关键词预筛 — 非几何题直接跳过，省两次 LLM 调用
        tracing::debug!("[explain] 非几何题，跳过 visual agents");
        None
    } else if let Some(llm) = llm_clone.clone() {
        // 第二层：Agent 1 规划
        tracing::debug!("[explain] 几何题命中关键词，调用 visual_plan agent");
        let plan_prompt = prompts::visual_plan(
            &question.content_latex,
            &question.answer_latex,
            &question.unit,
        );
        let plan_messages = vec![
            Message { role: "system".to_string(), content: "你必须严格 JSON 输出。".to_string() },
            Message { role: "user".to_string(), content: plan_prompt },
        ];
        let plan_opts = LLMOptions { temperature: Some(0.2), max_tokens: Some(200), top_p: Some(0.9) };

        match llm.complete(&plan_messages, &plan_opts).await {
            Ok(raw) => {
                let plan_json = parse_json_loose(&raw);
                let needs = plan_json.as_ref()
                    .and_then(|v| v.get("needs_visual"))
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                let description = plan_json.as_ref()
                    .and_then(|v| v.get("description"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .trim()
                    .to_string();

                if !needs || description.is_empty() {
                    tracing::debug!("[explain] visual_plan 返回 needs_visual=false");
                    None
                } else {
                    // 第三层：Agent 2 渲染
                    tracing::debug!("[explain] visual_plan 描述: {}, 调用 visual_render", description);
                    let render_prompt = prompts::visual_render(&description);
                    let render_messages = vec![
                        Message { role: "system".to_string(), content: "你必须严格 JSON 输出。".to_string() },
                        Message { role: "user".to_string(), content: render_prompt },
                    ];
                    let render_opts = LLMOptions { temperature: Some(0.4), max_tokens: Some(700), top_p: Some(0.9) };

                    match llm.complete(&render_messages, &render_opts).await {
                        Ok(raw2) => {
                            let rendered = parse_json_loose(&raw2);
                            match rendered {
                                Some(v) if v.get("type").and_then(|t| t.as_str()) == Some("jsxgraph") => {
                                    Some(v)
                                }
                                _ => {
                                    tracing::warn!("[explain] visual_render 未返回合法 jsxgraph JSON");
                                    None
                                }
                            }
                        }
                        Err(e) => {
                            tracing::warn!("[explain] visual_render LLM 失败: {}", e);
                            None
                        }
                    }
                }
            }
            Err(e) => {
                tracing::warn!("[explain] visual_plan LLM 失败: {}", e);
                None
            }
        }
    } else {
        None
    };

    // === 5. 写缓存 ===
    {
        let db = state.db.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let visual_json = visual_spec.as_ref().map(|v| v.to_string());
        let _ = db.execute(
            "INSERT OR REPLACE INTO explanations (question_id, explanation_text, visual_spec, model, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![
                question_id,
                display_text,
                visual_json,
                "siliconflow",
                chrono::Utc::now().to_rfc3339()
            ],
        );
    }

    // === 6. emit done ===
    let final_visual = visual_spec.unwrap_or_else(|| serde_json::json!({ "type": "none" }));
    let _ = app.emit(
        "explanation:done",
        serde_json::json!({
            "request_id": request_id,
            "full_text": display_text,
            "visual_spec": final_visual,
            "from_cache": false,
        }),
    );

    // 写事件日志
    log_event(&state, student_id.as_deref(), session_id.as_deref(), "explanation_request",
        serde_json::json!({"question_id": question_id, "from_cache": false}));

    Ok(serde_json::json!({
        "request_id": request_id,
        "from_cache": false,
        "full_text": display_text,
    }))
}

/// 分层提示
///
/// level: 1=启发 2=半步骤 3=详细步骤
#[tauri::command]
pub async fn get_layered_hint(
    question_id: String,
    level: i32,
    student_id: Option<String>,
    session_id: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<serde_json::Value> {
    let level = level.clamp(1, 3);
    tracing::info!("提示请求: {} level={}", question_id, level);

    let question = state.ai_questions.get(&question_id).map(|r| r.clone())
        .or_else(|| state.question_bank.questions.iter().find(|q| q.id == question_id).cloned())
        .ok_or_else(|| AppError::NotFound(format!("题目 {} 不存在", question_id)))?;

    let llm_clone = {
        let guard = state.llm_client.lock().map_err(|e: std::sync::PoisonError<_>| AppError::Internal(e.to_string()))?;
        guard.clone()
    };

    let grade = student_id
        .as_deref()
        .and_then(|sid| {
            let db = state.db.lock().ok()?;
            db.query_row(
                "SELECT grade FROM students WHERE id = ?1",
                rusqlite::params![sid],
                |row| row.get::<_, i32>(0),
            )
            .ok()
        })
        .unwrap_or(6);

    let hint_text = if let Some(llm) = llm_clone {
        let prompt = prompts::layered_hint(
            &question.content_latex,
            &question.answer_latex,
            level,
            grade,
        );
        let messages = vec![
            Message {
                role: "user".to_string(),
                content: prompt,
            },
        ];
        let opts = LLMOptions {
            temperature: Some(0.5),
            max_tokens: Some(120),
            top_p: Some(0.9),
        };
        match llm.complete(&messages, &opts).await {
            Ok(t) => t.trim().to_string(),
            Err(e) => {
                tracing::warn!("提示 LLM 失败: {}, 走兜底", e);
                fallback_hint(level, &question.content_latex)
            }
        }
    } else {
        fallback_hint(level, &question.content_latex)
    };

    // 安全过滤
    let hint_text = {
        let r = safety::sanitize_output(&hint_text);
        if r.is_safe { hint_text } else { r.sanitized }
    };

    // 写 hint_records
    if let Some(ref sid) = student_id {
        let db = state.db.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let _ = db.execute(
            "INSERT INTO hint_records (student_id, session_id, question_id, hint_level, hint_text, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![
                sid,
                session_id,
                question_id,
                level,
                hint_text,
                chrono::Utc::now().to_rfc3339()
            ],
        );
    }

    log_event(&state, student_id.as_deref(), session_id.as_deref(), "hint_request",
        serde_json::json!({"question_id": question_id, "level": level}));

    Ok(serde_json::json!({
        "level": level,
        "text": hint_text,
    }))
}

// =============================================
// 工具函数
// =============================================

/// 几何题关键词预筛
///
/// 命中任一关键词即视为"潜在几何题"，会进入 Agent 1（仍可被 LLM override
/// 为 needs_visual=false）。全部未命中则直接跳过 Agent 1 + Agent 2，省两次
/// LLM 调用。
const GEOMETRY_KEYWORDS: &[&str] = &[
    // 圆系
    "圆", "半径", "直径", "圆周率", "扇形", "圆环",
    // 多边形
    "三角形", "四边形", "五边形", "六边形", "多边形",
    "正方形", "长方形", "平行四边形", "梯形", "菱形",
    "边长", "对角线",
    // 立体
    "立方体", "长方体", "正方体", "圆柱", "圆锥", "球",
    "棱", "顶点", "底面", "侧面",
    // 角度 / 位置关系
    "角度", "度数", "平行", "垂直",
    // 量度
    "周长", "面积", "表面积", "体积",
    // 其他
    "坐标系", "几何", "图形", "画图",
];

pub(crate) fn is_geometric_question(content: &str) -> bool {
    GEOMETRY_KEYWORDS.iter().any(|k| content.contains(k))
}

/// 宽松解析 JSON：支持裸 JSON / ```json 代码块 / 花括号范围提取
fn parse_json_loose(raw: &str) -> Option<serde_json::Value> {
    let trimmed = raw.trim();
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) {
        return Some(v);
    }
    if let Some(start) = trimmed.find("```json") {
        let after = &trimmed[start + 7..];
        if let Some(end) = after.find("```") {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(after[..end].trim()) {
                return Some(v);
            }
        }
    }
    if let Some(start) = trimmed.find("```") {
        let after = &trimmed[start + 3..];
        let after = if let Some(nl) = after.find('\n') { &after[nl + 1..] } else { after };
        if let Some(end) = after.find("```") {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(after[..end].trim()) {
                return Some(v);
            }
        }
    }
    if let (Some(s), Some(e)) = (trimmed.find('{'), trimmed.rfind('}')) {
        if e > s {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&trimmed[s..=e]) {
                return Some(v);
            }
        }
    }
    None
}

/// LLM 不可用时的兜底讲解（纯 markdown，无 visual 块）
fn fallback_explanation(unit: &str, _content: &str, answer: &str) -> String {
    format!(
        "**第一步：审清题意**\n\
         我们先把题目要求看清楚，注意题目中的关键词和已知条件。\n\n\
         **第二步：确定方法**\n\
         这道题属于「{unit}」单元的内容，回忆一下我们学过的相关公式或方法。\n\n\
         **第三步：列式计算**\n\
         按照方法一步一步把式子写出来，注意符号和单位。\n\n\
         **第四步：核对答案**\n\
         算完之后回头检查一下，看看答案是否合理。\n\n\
         **正确答案**：{answer}",
        unit = unit,
        answer = answer
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_geometric_true_cases() {
        assert!(is_geometric_question("一个圆的半径是 5 厘米，求周长"));
        assert!(is_geometric_question("三角形内角和是多少"));
        assert!(is_geometric_question("正方体的表面积"));
        assert!(is_geometric_question("圆柱的体积"));
        assert!(is_geometric_question("求长方形的边长"));
        assert!(is_geometric_question("两条直线互相垂直"));
    }

    #[test]
    fn test_is_geometric_false_cases() {
        assert!(!is_geometric_question("计算：$\\frac{3}{5} \\times 10 = ?$"));
        assert!(!is_geometric_question("一根绳子长 12 米，第一次用去 1/3"));
        assert!(!is_geometric_question("小明骑车每小时行 15 千米"));
        assert!(!is_geometric_question("甲比乙多 25%，乙是甲的百分之几？"));
        assert!(!is_geometric_question("5 比 4 多几分之几？"));
    }

    #[test]
    fn test_parse_json_loose_bare() {
        let v = parse_json_loose("{\"a\":1}").unwrap();
        assert_eq!(v["a"], 1);
    }

    #[test]
    fn test_parse_json_loose_fenced() {
        let v = parse_json_loose("prefix\n```json\n{\"a\":2}\n```\nsuffix").unwrap();
        assert_eq!(v["a"], 2);
    }

    #[test]
    fn test_parse_json_loose_loose_braces() {
        let v = parse_json_loose("some text before {\"a\":3} some after").unwrap();
        assert_eq!(v["a"], 3);
    }
}

fn fallback_hint(level: i32, _content: &str) -> String {
    match level {
        1 => "想一想这道题考的是什么知识点？我们最近学的哪个公式可能用得上？".to_string(),
        2 => "我们可以先找出题目里的已知条件，再把要求的东西用一个式子表示出来。".to_string(),
        _ => "把已知条件代入公式，按步骤算一遍，注意单位和小数点。".to_string(),
    }
}

/// 写事件日志（失败不影响主流程）
pub(crate) fn log_event(
    state: &AppState,
    student_id: Option<&str>,
    session_id: Option<&str>,
    event_type: &str,
    payload: serde_json::Value,
) {
    let Some(sid) = student_id else { return };
    let Ok(db) = state.db.lock() else { return };
    let _ = db.execute(
        "INSERT INTO event_logs (student_id, session_id, event_type, payload, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![sid, session_id, event_type, payload.to_string(), chrono::Utc::now().to_rfc3339()],
    );
}
