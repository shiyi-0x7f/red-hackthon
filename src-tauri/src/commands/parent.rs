use tauri::State;
use crate::state::AppState;
use crate::error::{AppError, AppResult};

/// 验证家长密码
#[tauri::command]
pub async fn verify_parent_password(
    password: String,
    state: State<'_, AppState>,
) -> AppResult<bool> {
    tracing::debug!("家长密码验证");

    let db = state.db.lock().map_err(|e| AppError::Internal(e.to_string()))?;

    // 从 app_settings 读取密码哈希
    let stored_hash: Option<String> = db.query_row(
        "SELECT value FROM app_settings WHERE key = 'parent_password'",
        [],
        |row| row.get(0),
    ).ok();

    match stored_hash {
        Some(hash) if !hash.is_empty() => {
            // 有设置过密码，进行验证
            Ok(bcrypt::verify(&password, &hash).unwrap_or(false))
        },
        _ => {
            // 未设置密码，使用默认密码 "123456"
            Ok(password == "123456")
        }
    }
}

/// 设置家长密码
#[tauri::command]
pub async fn set_parent_password(
    current_password: String,
    new_password: String,
    state: State<'_, AppState>,
) -> AppResult<bool> {
    tracing::debug!("设置家长密码");

    // 先验证当前密码
    let db = state.db.lock().map_err(|e| AppError::Internal(e.to_string()))?;

    let stored_hash: Option<String> = db.query_row(
        "SELECT value FROM app_settings WHERE key = 'parent_password'",
        [],
        |row| row.get(0),
    ).ok();

    let verified = match &stored_hash {
        Some(hash) if !hash.is_empty() => {
            bcrypt::verify(&current_password, hash).unwrap_or(false)
        },
        _ => current_password == "123456",
    };

    if !verified {
        return Ok(false);
    }

    // 哈希新密码
    let new_hash = bcrypt::hash(&new_password, 10)
        .map_err(|e| AppError::Internal(format!("密码哈希失败: {}", e)))?;

    db.execute(
        "INSERT INTO app_settings (key, value, updated_at) VALUES ('parent_password', ?1, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = ?1, updated_at = datetime('now')",
        rusqlite::params![new_hash],
    )?;

    tracing::info!("家长密码已更新");
    Ok(true)
}

/// 获取学习概览
#[tauri::command]
pub async fn get_learning_overview(
    student_id: String,
    range: String, // "week" | "month" | "all"
    state: State<'_, AppState>,
) -> AppResult<serde_json::Value> {
    tracing::debug!("学习概览: 学生 {} 范围 {}", student_id, range);

    let db = state.db.lock().map_err(|e| AppError::Internal(e.to_string()))?;

    let date_filter = match range.as_str() {
        "week" => "AND stat_date >= date('now', '-7 days')",
        "month" => "AND stat_date >= date('now', '-30 days')",
        _ => "",
    };

    // 汇总 daily_stats
    let query = format!(
        "SELECT COALESCE(SUM(total_duration_secs), 0), COALESCE(SUM(session_count), 0), COALESCE(SUM(question_count), 0), COALESCE(SUM(correct_count), 0)
         FROM daily_stats WHERE student_id = ?1 {}",
        date_filter
    );

    let (total_duration, session_count, question_count, correct_count): (i64, i64, i64, i64) = db.query_row(
        &query,
        rusqlite::params![student_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    ).unwrap_or((0, 0, 0, 0));

    let accuracy = if question_count > 0 {
        correct_count as f64 / question_count as f64
    } else {
        0.0
    };

    // 每日数据（最近 30 天）
    let mut daily_data: Vec<serde_json::Value> = Vec::new();
    if let Ok(mut stmt) = db.prepare(
        "SELECT stat_date, total_duration_secs, question_count, correct_count
         FROM daily_stats WHERE student_id = ?1
         ORDER BY stat_date DESC LIMIT 30"
    ) {
        if let Ok(rows) = stmt.query_map(rusqlite::params![student_id], |row| {
            let qc: i64 = row.get(2)?;
            let cc: i64 = row.get(3)?;
            Ok(serde_json::json!({
                "date": row.get::<_, String>(0)?,
                "duration_secs": row.get::<_, i64>(1)?,
                "duration_minutes": row.get::<_, i64>(1)? / 60,
                "question_count": qc,
                "correct_count": cc,
                "accuracy": if qc > 0 { cc as f64 / qc as f64 } else { 0.0 },
            }))
        }) {
            for row in rows.flatten() {
                daily_data.push(row);
            }
        }
    }
    daily_data.reverse();

    // 学习天数和连续天数
    let total_days: i64 = db.query_row(
        "SELECT COUNT(DISTINCT stat_date) FROM daily_stats WHERE student_id = ?1",
        rusqlite::params![student_id],
        |row| row.get(0),
    ).unwrap_or(0);

    Ok(serde_json::json!({
        "student_id": student_id,
        "range": range,
        "total_duration_secs": total_duration,
        "total_duration_minutes": total_duration / 60,
        "session_count": session_count,
        "question_count": question_count,
        "correct_count": correct_count,
        "accuracy_rate": accuracy,
        "total_learning_days": total_days,
        "daily_data": daily_data,
    }))
}

/// 获取知识掌握度概览
#[tauri::command]
pub async fn get_mastery_overview(
    student_id: String,
    state: State<'_, AppState>,
) -> AppResult<Vec<serde_json::Value>> {
    let db = state.db.lock().map_err(|e| AppError::Internal(e.to_string()))?;
    let mut result = Vec::new();

    if let Ok(mut stmt) = db.prepare(
        "SELECT km.knowledge_id, COALESCE(kn.name, km.knowledge_id), km.mastery_score, km.attempt_count, km.correct_count, km.forgetting_risk, km.last_practiced_at
         FROM knowledge_mastery km
         LEFT JOIN knowledge_nodes kn ON km.knowledge_id = kn.id
         WHERE km.student_id = ?1
         ORDER BY km.mastery_score ASC"
    ) {
        if let Ok(rows) = stmt.query_map(rusqlite::params![student_id], |row| {
            let attempts: i32 = row.get(3)?;
            let corrects: i32 = row.get(4)?;
            Ok(serde_json::json!({
                "knowledge_id": row.get::<_, String>(0)?,
                "name": row.get::<_, String>(1)?,
                "mastery_score": row.get::<_, f64>(2)?,
                "attempt_count": attempts,
                "correct_count": corrects,
                "accuracy": if attempts > 0 { corrects as f64 / attempts as f64 } else { 0.0 },
                "forgetting_risk": row.get::<_, f64>(5)?,
                "last_practiced_at": row.get::<_, Option<String>>(6)?,
            }))
        }) {
            for row in rows.flatten() {
                result.push(row);
            }
        }
    }

    Ok(result)
}
