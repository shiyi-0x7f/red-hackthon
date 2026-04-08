use tauri::State;
use crate::state::AppState;
use crate::error::{AppError, AppResult};

/// 获取学生画像（含清晰度判断）
#[tauri::command]
pub async fn get_student_profile(
    student_id: String,
    state: State<'_, AppState>,
) -> AppResult<serde_json::Value> {
    tracing::debug!("获取学生画像: {}", student_id);

    let db = state.db.lock().map_err(|e| AppError::Internal(e.to_string()))?;

    // 统计答题数量
    let total_answers: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM answer_records WHERE student_id = ?1",
            rusqlite::params![student_id],
            |row| row.get(0),
        )
        .unwrap_or(0);

    // 统计正确率
    let correct_count: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM answer_records WHERE student_id = ?1 AND is_correct = 1",
            rusqlite::params![student_id],
            |row| row.get(0),
        )
        .unwrap_or(0);

    // 获取各单元掌握度
    let mut mastery_overview = Vec::new();
    if let Ok(mut stmt) = db.prepare(
        "SELECT km.knowledge_id, kn.name, km.mastery_score, km.attempt_count, km.forgetting_risk
         FROM knowledge_mastery km
         LEFT JOIN knowledge_nodes kn ON km.knowledge_id = kn.id
         WHERE km.student_id = ?1
         ORDER BY km.mastery_score ASC"
    ) {
        if let Ok(rows) = stmt.query_map(rusqlite::params![student_id], |row| {
            Ok(serde_json::json!({
                "knowledge_id": row.get::<_, String>(0)?,
                "name": row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                "mastery_score": row.get::<_, f64>(2)?,
                "attempt_count": row.get::<_, i32>(3)?,
                "forgetting_risk": row.get::<_, f64>(4)?,
            }))
        }) {
            for row in rows.flatten() {
                mastery_overview.push(row);
            }
        }
    }

    // 判断画像清晰度
    let profile_clarity = if total_answers < 5 {
        "cold_start"
    } else if total_answers < 20 {
        "emerging"
    } else {
        "clear"
    };

    let accuracy = if total_answers > 0 {
        correct_count as f64 / total_answers as f64
    } else {
        0.0
    };

    Ok(serde_json::json!({
        "student_id": student_id,
        "profile_clarity": profile_clarity,
        "total_answers": total_answers,
        "correct_count": correct_count,
        "accuracy": accuracy,
        "mastery_overview": mastery_overview,
        "knowledge_layer": {
            "total_mastered": mastery_overview.len(),
        },
        "behavior_layer": {},
        "state_layer": {},
    }))
}

/// 获取学生实时状态
#[tauri::command]
pub async fn get_student_state(
    student_id: String,
    state: State<'_, AppState>,
) -> AppResult<serde_json::Value> {
    tracing::debug!("获取学生实时状态: {}", student_id);

    // 从 DashMap 读取实时状态
    if let Some(runtime_state) = state.student_states.get(&student_id) {
        return Ok(serde_json::json!({
            "student_id": student_id,
            "fatigue": runtime_state.fatigue_level,
            "consecutive_errors": runtime_state.consecutive_errors,
            "session_duration_secs": runtime_state.session_duration_secs,
            "has_active_session": runtime_state.current_session_id.is_some(),
        }));
    }

    // 无实时状态
    Ok(serde_json::json!({
        "student_id": student_id,
        "fatigue": 0.0,
        "consecutive_errors": 0,
        "session_duration_secs": 0,
        "has_active_session": false,
    }))
}
