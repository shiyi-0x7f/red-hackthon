use tauri::State;
use std::collections::HashMap;
use crate::state::AppState;
use crate::error::{AppError, AppResult};

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
