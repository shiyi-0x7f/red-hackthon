use tauri::State;
use crate::state::AppState;
use crate::error::{AppError, AppResult};
use crate::services::decision_engine::{self, MasteryInfo};

/// 获取下一步教学动作
#[tauri::command]
pub async fn get_next_action(
    student_id: String,
    session_id: String,
    state: State<'_, AppState>,
) -> AppResult<serde_json::Value> {
    tracing::debug!("决策引擎: 学生 {} 会话 {}", student_id, session_id);

    // 从 DashMap 读取实时状态
    let (fatigue, consecutive_errors, session_secs) = if let Some(runtime) = state.student_states.get(&student_id) {
        (
            runtime.fatigue_level,
            runtime.consecutive_errors,
            runtime.session_duration_secs,
        )
    } else {
        (0.0, 0, 0)
    };

    let session_minutes = session_secs / 60;

    // 从数据库读取掌握度数据
    let mastery_data = {
        let db = state.db.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let mut mastery: Vec<MasteryInfo> = Vec::new();

        if let Ok(mut stmt) = db.prepare(
            "SELECT km.knowledge_id, COALESCE(kn.name, km.knowledge_id), km.mastery_score, km.forgetting_risk, km.last_practiced_at
             FROM knowledge_mastery km
             LEFT JOIN knowledge_nodes kn ON km.knowledge_id = kn.id
             WHERE km.student_id = ?1"
        ) {
            if let Ok(rows) = stmt.query_map(rusqlite::params![student_id], |row| {
                let last_practiced: Option<String> = row.get(4)?;
                let hours_ago = if let Some(ref lp) = last_practiced {
                    chrono::DateTime::parse_from_rfc3339(lp)
                        .map(|dt| {
                            let diff = chrono::Utc::now() - dt.with_timezone(&chrono::Utc);
                            diff.num_hours() as f64
                        })
                        .unwrap_or(0.0)
                } else {
                    0.0
                };
                Ok(MasteryInfo {
                    knowledge_id: row.get(0)?,
                    name: row.get(1)?,
                    mastery_score: row.get(2)?,
                    forgetting_risk: row.get(3)?,
                    last_practiced_hours_ago: hours_ago,
                })
            }) {
                for row in rows.flatten() {
                    mastery.push(row);
                }
            }
        }
        mastery
    };

    // 调用决策引擎
    let result = decision_engine::decide(
        fatigue,
        0.0, // frustration 暂未独立计算
        consecutive_errors,
        session_minutes,
        30, // max_session_minutes
        &mastery_data,
    );

    Ok(serde_json::json!({
        "action": result.action,
        "reasoning": result.reasoning,
        "params": result.params,
        "context": {
            "fatigue": fatigue,
            "consecutive_errors": consecutive_errors,
            "session_minutes": session_minutes,
            "mastery_count": mastery_data.len(),
        }
    }))
}
