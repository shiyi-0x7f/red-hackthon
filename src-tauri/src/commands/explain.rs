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

    let prompt = prompts::explain_with_visual(
        &question.content_latex,
        &question.answer_latex,
        grade,
        &question.unit,
    );

    let full_text = if let Some(llm) = llm_clone {
        let messages = vec![
            Message {
                role: "system".to_string(),
                content: "你是一个小学数学讲解老师，请按用户给定格式输出讲解和可视化。".to_string(),
            },
            Message {
                role: "user".to_string(),
                content: prompt,
            },
        ];

        let opts = LLMOptions {
            temperature: Some(0.6),
            max_tokens: Some(1500),
            top_p: Some(0.9),
        };

        // 流式回调：每 chunk emit
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
        // 一次性发送给前端，模拟流式
        let _ = app.emit(
            "explanation:chunk",
            serde_json::json!({ "request_id": request_id, "delta": text }),
        );
        text
    };

    // === 4. 解析 visual spec ===
    let (display_text_raw, visual_spec) = parse_visual_spec(&full_text);

    // === 4.5 安全过滤（讲解正文）===
    let safety_result = safety::sanitize_output(&display_text_raw);
    let display_text = if safety_result.is_safe {
        display_text_raw
    } else {
        tracing::warn!("[explain] LLM 讲解触发 {} 项安全规则，已清洗", safety_result.violations.len());
        safety_result.sanitized
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

/// 从 LLM 完整输出中分离讲解正文 + visual JSON
fn parse_visual_spec(full: &str) -> (String, Option<serde_json::Value>) {
    // 查找 ```visual 块
    if let Some(start) = full.find("```visual") {
        let after = &full[start + 9..];
        if let Some(end) = after.find("```") {
            let json_str = after[..end].trim();
            let display = full[..start].trim_end().to_string();
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(json_str) {
                return (display, Some(v));
            }
            tracing::warn!("visual 块解析失败: {}", &json_str[..json_str.len().min(120)]);
            return (display, None);
        }
    }
    // 兼容：未指定 visual 但有 ```json 块
    if let Some(start) = full.find("```json") {
        let after = &full[start + 7..];
        if let Some(end) = after.find("```") {
            let json_str = after[..end].trim();
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(json_str) {
                if v.get("type").is_some() {
                    let display = full[..start].trim_end().to_string();
                    return (display, Some(v));
                }
            }
        }
    }
    (full.to_string(), None)
}

/// LLM 不可用时的兜底讲解
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
         **正确答案**：{answer}\n\n\
         ```visual\n\
         {{\"type\": \"none\"}}\n\
         ```",
        unit = unit,
        answer = answer
    )
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
