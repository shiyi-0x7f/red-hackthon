use tauri::State;
use crate::state::AppState;
use crate::error::{AppError, AppResult};
use crate::services::pacing_engine;

/// 获取节奏控制状态
#[tauri::command]
pub async fn get_pacing_status(
    session_id: String,
    state: State<'_, AppState>,
) -> AppResult<serde_json::Value> {
    tracing::debug!("节奏控制状态: 会话 {}", session_id);

    // 从数据库获取会话开始时间
    let started_at_str = {
        let db = state.db.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        db.query_row(
            "SELECT started_at FROM learning_sessions WHERE id = ?1",
            rusqlite::params![session_id],
            |row| row.get::<_, String>(0),
        ).ok()
    };

    let elapsed_minutes = if let Some(ref started) = started_at_str {
        chrono::DateTime::parse_from_rfc3339(started)
            .map(|dt| {
                let diff = chrono::Utc::now() - dt.with_timezone(&chrono::Utc);
                diff.num_minutes()
            })
            .unwrap_or(0)
    } else {
        0
    };

    let max_minutes = 30; // 可从配置读取
    let pacing_state = pacing_engine::evaluate(elapsed_minutes, max_minutes);

    let phase_str = match pacing_state.phase {
        pacing_engine::PacingPhase::Normal => "normal",
        pacing_engine::PacingPhase::Warning => "warning",
        pacing_engine::PacingPhase::WindingDown => "winding_down",
        pacing_engine::PacingPhase::Overtime => "overtime",
    };

    let message = match pacing_state.phase {
        pacing_engine::PacingPhase::Normal => format!("学习进行中，还剩 {} 分钟", pacing_state.remaining_minutes),
        pacing_engine::PacingPhase::Warning => format!("⚠️ 还剩 {} 分钟，注意合理安排时间", pacing_state.remaining_minutes),
        pacing_engine::PacingPhase::WindingDown => "⏰ 即将结束，我们来做个小总结吧".to_string(),
        pacing_engine::PacingPhase::Overtime => "🛑 已超时，建议结束学习休息一下".to_string(),
    };

    Ok(serde_json::json!({
        "session_id": session_id,
        "elapsed_minutes": pacing_state.elapsed_minutes,
        "max_minutes": pacing_state.max_minutes,
        "remaining_minutes": pacing_state.remaining_minutes,
        "phase": phase_str,
        "should_warn": matches!(pacing_state.phase, pacing_engine::PacingPhase::Warning | pacing_engine::PacingPhase::WindingDown),
        "should_stop": matches!(pacing_state.phase, pacing_engine::PacingPhase::Overtime),
        "message": message,
    }))
}
