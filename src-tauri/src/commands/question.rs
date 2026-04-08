use tauri::State;
use std::collections::HashMap;
use crate::state::AppState;
use crate::error::{AppError, AppResult};
use crate::ai::llm_client::{Message, LLMOptions};
use crate::ai::prompts;

/// 生成练习题
///
/// 根据学生画像清晰度自动选择模式：
/// - 冷启动（答题 < 5）→ 诊断模式（每单元 1 题）
/// - 初步画像（5~20）→ 按单元出题
/// - 画像清晰（> 20）→ 自适应出题
#[tauri::command]
pub async fn generate_quiz(
    student_id: String,
    knowledge_ids: Vec<String>,
    count: Option<i32>,
    unit: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<serde_json::Value> {
    let count = count.unwrap_or(5) as usize;
    tracing::debug!("为学生 {} 生成 {} 道题, unit={:?}", student_id, count, unit);

    // 查询学生答题数据量以判断画像清晰度
    let (total_answers, mastery_data) = {
        let db = state.db.lock().map_err(|e| AppError::Internal(e.to_string()))?;

        // 统计答题总数
        let total: i64 = db
            .query_row(
                "SELECT COUNT(*) FROM answer_records WHERE student_id = ?1",
                rusqlite::params![student_id],
                |row| row.get(0),
            )
            .unwrap_or(0);

        // 获取各单元掌握度
        let mut mastery: HashMap<String, f64> = HashMap::new();
        if let Ok(mut stmt) = db.prepare(
            "SELECT kn.name, km.mastery_score
             FROM knowledge_mastery km
             JOIN knowledge_nodes kn ON km.knowledge_id = kn.id
             WHERE km.student_id = ?1"
        ) {
            if let Ok(rows) = stmt.query_map(rusqlite::params![student_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, f64>(1)?))
            }) {
                for row in rows.flatten() {
                    mastery.insert(row.0, row.1);
                }
            }
        }

        (total, mastery)
    };

    let qb = &state.question_bank;

    // 确定出题模式
    let (mode, questions) = if let Some(ref unit_name) = unit {
        // 指定单元出题
        let qs = qb.quiz_for_unit(unit_name, count);
        ("unit", qs)
    } else if total_answers < 5 {
        // 冷启动诊断模式
        let qs = qb.diagnose_quiz(1);
        ("diagnose", qs)
    } else if total_answers < 20 || mastery_data.is_empty() {
        // 初步画像 — 按单元顺序
        let qs = qb.diagnose_quiz(2);
        ("emerging", qs)
    } else {
        // 画像清晰 — 自适应
        let qs = qb.adaptive_quiz(&mastery_data, count);
        ("adaptive", qs)
    };

    tracing::info!(
        "学生 {} 出题模式: {}, 生成 {} 道题",
        student_id,
        mode,
        questions.len()
    );

    let questions_json: Vec<serde_json::Value> = questions
        .iter()
        .map(|q| {
            serde_json::json!({
                "id": q.id,
                "unit": q.unit,
                "semester": q.semester,
                "question_type": q.question_type,
                "content_latex": q.content_latex,
                "answer_latex": q.answer_latex,
                "difficulty": q.difficulty,
            })
        })
        .collect();

    Ok(serde_json::json!({
        "mode": mode,
        "total": questions_json.len(),
        "questions": questions_json,
    }))
}

/// AI 动态出题
///
/// 行为：
/// 1. 取学生薄弱知识点（mastery_score 最低的 3 个）作为提示
/// 2. 调 LLM 生成一道符合 unit + difficulty 的题
/// 3. 解析 JSON，给题分配一个 ai-xxxx 的 id，注入到 question_bank（内存）以便后续判题
///    （注：因 question_bank 是只读 Arc，这里返回题目数据让前端塞进 store；
///     后端再用一个 ai_questions DashMap 缓存题目，submit_answer 才能找到它）
#[tauri::command]
pub async fn generate_ai_question(
    student_id: String,
    unit: String,
    difficulty: Option<i32>,
    state: State<'_, AppState>,
) -> AppResult<serde_json::Value> {
    let difficulty = difficulty.unwrap_or(2).clamp(1, 5);
    tracing::info!("AI 出题: student={} unit={} difficulty={}", student_id, unit, difficulty);

    // 取学生年级 + 薄弱知识点
    let (grade, weak_topics) = {
        let db = state.db.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let grade: i32 = db.query_row(
            "SELECT grade FROM students WHERE id = ?1",
            rusqlite::params![student_id],
            |row| row.get(0),
        ).unwrap_or(6);

        let mut topics: Vec<String> = Vec::new();
        if let Ok(mut stmt) = db.prepare(
            "SELECT COALESCE(kn.name, km.knowledge_id) FROM knowledge_mastery km
             LEFT JOIN knowledge_nodes kn ON km.knowledge_id = kn.id
             WHERE km.student_id = ?1 ORDER BY km.mastery_score ASC LIMIT 3"
        ) {
            if let Ok(rows) = stmt.query_map(rusqlite::params![student_id], |row| row.get::<_, String>(0)) {
                for r in rows.flatten() { topics.push(r); }
            }
        }
        (grade, topics)
    };

    // LLM 出题
    let llm_clone = {
        let guard = state.llm_client.lock().map_err(|e: std::sync::PoisonError<_>| AppError::Internal(e.to_string()))?;
        guard.clone()
    };
    let llm = match llm_clone {
        Some(c) => c,
        None => return Err(AppError::LLMError("AI 出题需要先在设置页配置 API Key".to_string())),
    };

    let prompt = prompts::generate_question(grade, &unit, difficulty, &weak_topics);
    let messages = vec![
        Message {
            role: "system".to_string(),
            content: "你是数学命题老师，必须以严格 JSON 输出，不要任何其他文字。".to_string(),
        },
        Message { role: "user".to_string(), content: prompt },
    ];
    let opts = LLMOptions {
        temperature: Some(0.8),
        max_tokens: Some(500),
        top_p: Some(0.9),
    };

    let raw = llm.complete(&messages, &opts).await
        .map_err(|e| AppError::LLMError(format!("LLM 出题失败: {}", e)))?;

    let parsed = parse_ai_question_json(&raw)
        .ok_or_else(|| AppError::LLMError(format!("LLM 输出无法解析为题目 JSON: {}", &raw[..raw.len().min(200)])))?;

    // 生成 id 并写入 ai_questions 缓存（让 submit_answer 能找到）
    let q_id = format!("ai-{}", uuid::Uuid::new_v4().to_string().split('-').next().unwrap_or("xxxx"));
    let q_type = parsed.get("question_type").and_then(|v| v.as_str()).unwrap_or("填空题").to_string();
    let content = parsed.get("content_latex").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let answer = parsed.get("answer_latex").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let unit_out = parsed.get("unit").and_then(|v| v.as_str()).unwrap_or(&unit).to_string();
    let hint = parsed.get("hint").and_then(|v| v.as_str()).unwrap_or("").to_string();

    let ai_q = crate::services::question_bank::BaseQuestion {
        id: q_id.clone(),
        unit: unit_out.clone(),
        semester: "AI".to_string(),
        question_type: q_type.clone(),
        content_latex: content.clone(),
        answer_latex: answer.clone(),
        difficulty,
    };
    state.ai_questions.insert(q_id.clone(), ai_q);

    Ok(serde_json::json!({
        "id": q_id,
        "unit": unit_out,
        "semester": "AI",
        "question_type": q_type,
        "content_latex": content,
        "answer_latex": answer,
        "difficulty": difficulty,
        "hint": hint,
        "ai_generated": true,
    }))
}

/// 解析 LLM 出题返回的 JSON（兼容裸 JSON / ```json 包裹 / 花括号片段）
fn parse_ai_question_json(raw: &str) -> Option<serde_json::Value> {
    let trimmed = raw.trim();
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) {
        if v.is_object() && v.get("content_latex").is_some() { return Some(v); }
    }
    if let Some(start) = trimmed.find("```json") {
        let after = &trimmed[start + 7..];
        if let Some(end) = after.find("```") {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(after[..end].trim()) {
                if v.is_object() { return Some(v); }
            }
        }
    }
    if let (Some(s), Some(e)) = (trimmed.find('{'), trimmed.rfind('}')) {
        if e > s {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&trimmed[s..=e]) {
                if v.is_object() { return Some(v); }
            }
        }
    }
    None
}

/// 获取题库概览
#[tauri::command]
pub async fn get_question_bank_overview(
    state: State<'_, AppState>,
) -> AppResult<serde_json::Value> {
    let qb = &state.question_bank;
    let units: Vec<serde_json::Value> = qb
        .unit_names()
        .iter()
        .map(|name| {
            let qs = qb.questions_for_unit(name);
            serde_json::json!({
                "unit": name,
                "count": qs.len(),
                "types": qs.iter().map(|q| q.question_type.as_str()).collect::<Vec<_>>(),
            })
        })
        .collect();

    Ok(serde_json::json!({
        "total_questions": qb.questions.len(),
        "total_units": units.len(),
        "units": units,
    }))
}
