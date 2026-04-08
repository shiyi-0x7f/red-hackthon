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

/// 错题本：返回学生最近答错的题目
///
/// 字段：question_id / unit / question_type / content / correct_answer /
/// student_answer / error_type / created_at
#[tauri::command]
pub async fn get_wrong_answers(
    student_id: String,
    limit: Option<i32>,
    state: State<'_, AppState>,
) -> AppResult<Vec<serde_json::Value>> {
    let limit = limit.unwrap_or(20).clamp(1, 100);
    let db = state.db.lock().map_err(|e| AppError::Internal(e.to_string()))?;

    let mut out: Vec<serde_json::Value> = Vec::new();
    let mut stmt = db.prepare(
        "SELECT ar.id, ar.question_id, ar.student_answer, ar.error_type, ar.created_at,
                q.content, q.answer, q.question_type,
                COALESCE(kn.name, '') AS unit
         FROM answer_records ar
         LEFT JOIN questions q ON ar.question_id = q.id
         LEFT JOIN knowledge_nodes kn ON q.knowledge_id = kn.id
         WHERE ar.student_id = ?1 AND ar.is_correct = 0
         ORDER BY ar.created_at DESC LIMIT ?2"
    )?;
    let rows = stmt.query_map(rusqlite::params![student_id, limit], |row| {
        Ok(serde_json::json!({
            "record_id": row.get::<_, String>(0)?,
            "question_id": row.get::<_, String>(1)?,
            "student_answer": row.get::<_, String>(2)?,
            "error_type": row.get::<_, Option<String>>(3)?,
            "created_at": row.get::<_, String>(4)?,
            "content_latex": row.get::<_, Option<String>>(5)?.unwrap_or_default(),
            "answer_latex": row.get::<_, Option<String>>(6)?.unwrap_or_default(),
            "question_type": row.get::<_, Option<String>>(7)?.unwrap_or_default(),
            "unit": row.get::<_, String>(8)?,
        }))
    })?;
    for r in rows.flatten() { out.push(r); }
    Ok(out)
}

/// 艾宾浩斯间隔（小时）：第 N 次练习后距离下次理想复习的间隔
/// attempt=1 → 20 分钟后（0.33h）
/// attempt=2 → 1 小时后
/// attempt=3 → 8 小时后
/// attempt=4 → 24 小时（1 天）
/// attempt=5 → 48 小时（2 天）
/// attempt=6 → 96 小时（4 天）
/// attempt=7 → 168 小时（7 天）
/// attempt=8 → 360 小时（15 天）
/// attempt≥9 → 720 小时（30 天）
fn ebbinghaus_interval_hours(attempts: i32, mastery: f64) -> f64 {
    let base: f64 = match attempts {
        0 | 1 => 0.33,
        2 => 1.0,
        3 => 8.0,
        4 => 24.0,
        5 => 48.0,
        6 => 96.0,
        7 => 168.0,
        8 => 360.0,
        _ => 720.0,
    };
    // 掌握度高的延长间隔（最多 2 倍），掌握度低的缩短（最多 0.5 倍）
    let mastery_factor = 0.5 + mastery * 1.5;
    base * mastery_factor
}

/// 复习推荐：基于艾宾浩斯遗忘曲线 + 优先级打分
///
/// 算法：
/// 1. 查询所有 knowledge_mastery 行
/// 2. 对每个 KP 计算理想复习间隔 (ebbinghaus)
/// 3. 如果 hours_since_last >= ideal_interval → "due now"（到期）
/// 4. 优先级分 = overdue_ratio * (1 - mastery) * forgetting_risk
/// 5. 按优先级降序返回，最多 5 条（减少学生复习负担）
///
/// 只返回"到期"的 KP，未到期的不打扰。如果全部都没到期 → 返回空列表。
#[tauri::command]
pub async fn get_review_recommendations(
    student_id: String,
    state: State<'_, AppState>,
) -> AppResult<Vec<serde_json::Value>> {
    let db = state.db.lock().map_err(|e| AppError::Internal(e.to_string()))?;

    let mut candidates: Vec<(f64, serde_json::Value)> = Vec::new();

    let mut stmt = db.prepare(
        "SELECT km.knowledge_id, COALESCE(kn.name, km.knowledge_id) AS name,
                km.mastery_score, km.forgetting_risk, km.attempt_count,
                km.last_practiced_at
         FROM knowledge_mastery km
         LEFT JOIN knowledge_nodes kn ON km.knowledge_id = kn.id
         WHERE km.student_id = ?1"
    )?;
    let rows = stmt.query_map(rusqlite::params![student_id], |row| {
        Ok((
            row.get::<_, String>(0)?, // knowledge_id
            row.get::<_, String>(1)?, // name
            row.get::<_, f64>(2)?,    // mastery_score
            row.get::<_, f64>(3)?,    // forgetting_risk
            row.get::<_, i32>(4)?,    // attempt_count
            row.get::<_, Option<String>>(5)?, // last_practiced_at
        ))
    })?;

    let now = chrono::Utc::now();
    for row in rows.flatten() {
        let (kid, name, mastery, risk, attempts, last_at) = row;
        let hours_ago: f64 = last_at.as_ref()
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|dt| (now - dt.with_timezone(&chrono::Utc)).num_seconds() as f64 / 3600.0)
            .unwrap_or(0.0);

        let ideal = ebbinghaus_interval_hours(attempts, mastery);

        // 只纳入到期或过期的项（留 80% buffer，避免卡点即提醒）
        if hours_ago < ideal * 0.8 {
            continue;
        }

        // 过期比例（>=1 表示已过期）
        let overdue_ratio = hours_ago / ideal.max(0.1);

        // 优先级：过期越久、掌握度越低、遗忘风险越高 → 分数越高
        let priority = overdue_ratio * (1.0 - mastery).max(0.1) * (risk + 0.1);

        candidates.push((
            priority,
            serde_json::json!({
                "knowledge_id": kid,
                "name": name,
                "mastery_score": mastery,
                "forgetting_risk": risk,
                "attempt_count": attempts,
                "hours_since_last": hours_ago as i64,
                "ideal_interval_hours": ideal as i64,
                "overdue_ratio": overdue_ratio,
                "priority_score": priority,
            }),
        ));
    }

    // 按优先级降序
    candidates.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

    // 最多返回 5 条（减少学习压力）
    let out: Vec<serde_json::Value> = candidates.into_iter().take(5).map(|(_, v)| v).collect();
    Ok(out)
}

/// 获取学生整体学习概况（用于 Profile 页统计卡 + 时间趋势图）
///
/// 返回：
/// - total_questions / correct_count / accuracy
/// - total_duration_minutes（总学习时长）
/// - learning_days（有学习的天数）
/// - daily_stats: 最近 7 天每日 {date, duration_minutes, question_count, correct_count}
/// - mastery_data: 各知识点掌握度（用于雷达图 / 弱项排行）
#[tauri::command]
pub async fn get_profile_overview(
    student_id: String,
    state: State<'_, AppState>,
) -> AppResult<serde_json::Value> {
    let db = state.db.lock().map_err(|e| AppError::Internal(e.to_string()))?;

    // 总答题数 + 正确数
    let total_questions: i64 = db.query_row(
        "SELECT COUNT(*) FROM answer_records WHERE student_id = ?1",
        rusqlite::params![student_id],
        |row| row.get(0),
    ).unwrap_or(0);

    let correct_count: i64 = db.query_row(
        "SELECT COUNT(*) FROM answer_records WHERE student_id = ?1 AND is_correct = 1",
        rusqlite::params![student_id],
        |row| row.get(0),
    ).unwrap_or(0);

    // 总学习时长（从 daily_stats 累加）+ 学习天数
    let (total_duration_secs, learning_days): (i64, i64) = db.query_row(
        "SELECT COALESCE(SUM(total_duration_secs), 0), COUNT(DISTINCT stat_date)
         FROM daily_stats WHERE student_id = ?1",
        rusqlite::params![student_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    ).unwrap_or((0, 0));

    // 最近 7 天每日数据
    let mut daily_stats: Vec<serde_json::Value> = Vec::new();
    if let Ok(mut stmt) = db.prepare(
        "SELECT stat_date, total_duration_secs, question_count, correct_count
         FROM daily_stats WHERE student_id = ?1
         ORDER BY stat_date DESC LIMIT 7"
    ) {
        if let Ok(rows) = stmt.query_map(rusqlite::params![student_id], |row| {
            let date: String = row.get(0)?;
            let dur: i64 = row.get(1)?;
            let q: i64 = row.get(2)?;
            let c: i64 = row.get(3)?;
            Ok(serde_json::json!({
                "date": date,
                "duration_minutes": dur / 60,
                "question_count": q,
                "correct_count": c,
            }))
        }) {
            for r in rows.flatten() { daily_stats.push(r); }
        }
    }
    // 倒序还原为时间正序
    daily_stats.reverse();

    // 各知识点掌握度
    let mut mastery_data: Vec<serde_json::Value> = Vec::new();
    if let Ok(mut stmt) = db.prepare(
        "SELECT km.knowledge_id, COALESCE(kn.name, km.knowledge_id), km.mastery_score, km.attempt_count, km.forgetting_risk
         FROM knowledge_mastery km
         LEFT JOIN knowledge_nodes kn ON km.knowledge_id = kn.id
         WHERE km.student_id = ?1 ORDER BY km.mastery_score DESC"
    ) {
        if let Ok(rows) = stmt.query_map(rusqlite::params![student_id], |row| {
            Ok(serde_json::json!({
                "knowledge_id": row.get::<_, String>(0)?,
                "name": row.get::<_, String>(1)?,
                "mastery_score": row.get::<_, f64>(2)?,
                "attempt_count": row.get::<_, i32>(3)?,
                "forgetting_risk": row.get::<_, f64>(4)?,
            }))
        }) {
            for r in rows.flatten() { mastery_data.push(r); }
        }
    }

    let accuracy = if total_questions > 0 {
        correct_count as f64 / total_questions as f64
    } else { 0.0 };

    Ok(serde_json::json!({
        "student_id": student_id,
        "total_questions": total_questions,
        "correct_count": correct_count,
        "accuracy": accuracy,
        "total_duration_minutes": total_duration_secs / 60,
        "learning_days": learning_days,
        "daily_stats": daily_stats,
        "mastery_data": mastery_data,
    }))
}

/// 获取学生实时画像（6 层聚合，给 Practice 页右侧仪表盘用）
///
/// 数据源：
/// - knowledge_layer ← knowledge_mastery 表（top-3 弱点）
/// - behavior_layer  ← behavior_features 最近一行（accuracy / hint_dependency / impulsivity / avg_response_time）
/// - state_layer     ← student_states 最近一行 + DashMap 兜底
/// - session_layer   ← DashMap 实时会话信息
#[tauri::command]
pub async fn get_realtime_profile(
    student_id: String,
    state: State<'_, AppState>,
) -> AppResult<serde_json::Value> {
    let db = state.db.lock().map_err(|e| AppError::Internal(e.to_string()))?;

    // === knowledge_layer ===
    let mut weak_topics: Vec<serde_json::Value> = Vec::new();
    let mut total_mastery = 0.0;
    let mut count = 0;
    if let Ok(mut stmt) = db.prepare(
        "SELECT km.knowledge_id, COALESCE(kn.name, km.knowledge_id), km.mastery_score, km.forgetting_risk, km.attempt_count
         FROM knowledge_mastery km
         LEFT JOIN knowledge_nodes kn ON km.knowledge_id = kn.id
         WHERE km.student_id = ?1
         ORDER BY km.mastery_score ASC LIMIT 3"
    ) {
        if let Ok(rows) = stmt.query_map(rusqlite::params![student_id], |row| {
            Ok(serde_json::json!({
                "name": row.get::<_, String>(1)?,
                "mastery": row.get::<_, f64>(2)?,
                "forgetting_risk": row.get::<_, f64>(3)?,
                "attempts": row.get::<_, i32>(4)?,
            }))
        }) {
            for r in rows.flatten() { weak_topics.push(r); }
        }
    }
    if let Ok(mut stmt) = db.prepare(
        "SELECT AVG(mastery_score), COUNT(*) FROM knowledge_mastery WHERE student_id = ?1"
    ) {
        if let Ok(row) = stmt.query_row(rusqlite::params![student_id], |row| {
            Ok((row.get::<_, Option<f64>>(0)?, row.get::<_, i64>(1)?))
        }) {
            total_mastery = row.0.unwrap_or(0.0);
            count = row.1;
        }
    }

    // === behavior_layer (最近 1 条快照) ===
    let behavior = db.query_row(
        "SELECT avg_response_time, accuracy_rate, hint_usage_rate, impulsivity, hint_dependency, max_consecutive_errors, sample_count
         FROM behavior_features WHERE student_id = ?1 ORDER BY id DESC LIMIT 1",
        rusqlite::params![student_id],
        |row| Ok(serde_json::json!({
            "avg_response_time": row.get::<_, f64>(0)?,
            "accuracy_rate": row.get::<_, f64>(1)?,
            "hint_usage_rate": row.get::<_, f64>(2)?,
            "impulsivity": row.get::<_, f64>(3)?,
            "hint_dependency": row.get::<_, f64>(4)?,
            "max_consecutive_errors": row.get::<_, i32>(5)?,
            "sample_count": row.get::<_, i32>(6)?,
        })),
    ).unwrap_or_else(|_| serde_json::json!({
        "avg_response_time": 0.0, "accuracy_rate": 0.0, "hint_usage_rate": 0.0,
        "impulsivity": 0.0, "hint_dependency": 0.0, "max_consecutive_errors": 0, "sample_count": 0
    }));

    // === state_layer (最近 1 条快照) ===
    let state_snapshot = db.query_row(
        "SELECT fatigue_level, attention_level, frustration, cognitive_load, consecutive_errors
         FROM student_states WHERE student_id = ?1 ORDER BY id DESC LIMIT 1",
        rusqlite::params![student_id],
        |row| Ok(serde_json::json!({
            "fatigue": row.get::<_, f64>(0)?,
            "attention": row.get::<_, f64>(1)?,
            "frustration": row.get::<_, f64>(2)?,
            "cognitive_load": row.get::<_, f64>(3)?,
            "consecutive_errors": row.get::<_, i32>(4)?,
        })),
    ).unwrap_or_else(|_| serde_json::json!({
        "fatigue": 0.0, "attention": 1.0, "frustration": 0.0, "cognitive_load": 0.0, "consecutive_errors": 0
    }));

    drop(db);

    // === session_layer (DashMap) ===
    let session = if let Some(rt) = state.student_states.get(&student_id) {
        serde_json::json!({
            "active": rt.current_session_id.is_some(),
            "duration_secs": rt.session_duration_secs,
            "total_questions": rt.total_questions,
            "correct_count": rt.correct_count,
        })
    } else {
        serde_json::json!({"active": false, "duration_secs": 0, "total_questions": 0, "correct_count": 0})
    };

    Ok(serde_json::json!({
        "student_id": student_id,
        "knowledge_layer": {
            "avg_mastery": total_mastery,
            "topic_count": count,
            "weak_topics": weak_topics,
        },
        "behavior_layer": behavior,
        "state_layer": state_snapshot,
        "session_layer": session,
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
