use tauri::State;
use crate::state::{AppState, StudentRuntimeState};
use crate::error::{AppError, AppResult};
use crate::services::student_model;

/// 开始学习会话
#[tauri::command]
pub async fn start_session(
    student_id: String,
    state: State<'_, AppState>,
) -> AppResult<serde_json::Value> {
    let session_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now();

    tracing::info!("学生 {} 开始学习会话 {}", student_id, session_id);

    // 写入 learning_sessions 表
    {
        let db = state.db.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        db.execute(
            "INSERT INTO learning_sessions (id, student_id, started_at, total_questions, correct_count)
             VALUES (?1, ?2, ?3, 0, 0)",
            rusqlite::params![session_id, student_id, now.to_rfc3339()],
        )?;
    }

    // 初始化 DashMap 学生实时状态
    state.student_states.insert(
        student_id.clone(),
        StudentRuntimeState {
            student_id: student_id.clone(),
            current_session_id: Some(session_id.clone()),
            fatigue_level: 0.0,
            consecutive_errors: 0,
            session_duration_secs: 0,
            last_activity_at: now,
            session_start_at: now,
            total_questions: 0,
            correct_count: 0,
        },
    );

    Ok(serde_json::json!({
        "session_id": session_id,
        "student_id": student_id,
        "started_at": now.to_rfc3339()
    }))
}

/// 提交答案
#[tauri::command]
pub async fn submit_answer(
    session_id: String,
    question_id: String,
    answer: serde_json::Value,
    time_spent_secs: i64,
    student_id: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<serde_json::Value> {
    tracing::debug!("会话 {} 提交答案: 题目 {}", session_id, question_id);

    // 从会话获取学生 ID
    let sid = if let Some(s) = student_id {
        s
    } else {
        let db = state.db.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        db.query_row(
            "SELECT student_id FROM learning_sessions WHERE id = ?1",
            rusqlite::params![session_id],
            |row| row.get::<_, String>(0),
        ).map_err(|_| AppError::NotFound(format!("会话 {} 不存在", session_id)))?
    };

    // 从题库查找题目信息进行判题
    let question_info = state.question_bank.questions.iter()
        .find(|q| q.id == question_id);

    let student_answer_str = match &answer {
        serde_json::Value::String(s) => s.clone(),
        other => other.to_string(),
    };

    // 简单判题逻辑（对比标准答案）
    let (is_correct, error_type, feedback) = if let Some(q) = question_info {
        let correct_answer = q.answer_latex.trim();
        let student_ans = student_answer_str.trim();

        // 归一化比较：去除空格和 LaTeX 标记
        let normalize = |s: &str| -> String {
            s.replace(" ", "")
                .replace("\\,", "")
                .replace("$", "")
                .trim()
                .to_string()
        };

        let is_correct = normalize(correct_answer) == normalize(student_ans);

        let error_type = if is_correct {
            "无".to_string()
        } else {
            // 简单错因推断
            if student_ans.is_empty() {
                "未作答".to_string()
            } else if student_ans.len() < correct_answer.len() / 2 {
                "审题错误".to_string()
            } else {
                "计算错误".to_string()
            }
        };

        let feedback = if is_correct {
            "做得好！继续加油 🎉".to_string()
        } else {
            format!("没关系，正确答案是 {}。我们一起看看哪里不对 💪", correct_answer)
        };

        (is_correct, error_type, feedback)
    } else {
        // 找不到题目信息，默认记录
        (false, "未知".to_string(), "题目信息未找到".to_string())
    };

    let record_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now();

    // 写入 answer_records
    {
        let db = state.db.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        db.execute(
            "INSERT INTO answer_records (id, session_id, question_id, student_id, student_answer, is_correct, time_spent_secs, hint_used, error_type, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8, ?9)",
            rusqlite::params![
                record_id,
                session_id,
                question_id,
                sid,
                student_answer_str,
                is_correct as i32,
                time_spent_secs,
                error_type,
                now.to_rfc3339()
            ],
        )?;

        // 更新 session 统计
        db.execute(
            "UPDATE learning_sessions SET total_questions = total_questions + 1, correct_count = correct_count + ?1 WHERE id = ?2",
            rusqlite::params![is_correct as i32, session_id],
        )?;

        // 更新 knowledge_mastery (BKT)
        if let Some(q) = question_info {
            // 查找或创建 mastery 记录（使用 unit 名称作为 knowledge_id）
            let knowledge_id = format!("kn-{}", q.unit.replace(" ", "_"));

            let existing: Option<(f64, i32, i32)> = db.query_row(
                "SELECT mastery_score, attempt_count, correct_count FROM knowledge_mastery WHERE student_id = ?1 AND knowledge_id = ?2",
                rusqlite::params![sid, knowledge_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            ).ok();

            let bkt_params = student_model::BKTParams::default();

            if let Some((old_mastery, attempts, corrects)) = existing {
                let new_mastery = student_model::bkt_update(old_mastery, is_correct, &bkt_params);
                let forgetting = student_model::forgetting_risk(new_mastery, 0.0);

                db.execute(
                    "UPDATE knowledge_mastery SET mastery_score = ?1, attempt_count = ?2, correct_count = ?3, last_practiced_at = ?4, forgetting_risk = ?5, bkt_p_know = ?1, updated_at = ?4
                     WHERE student_id = ?6 AND knowledge_id = ?7",
                    rusqlite::params![
                        new_mastery,
                        attempts + 1,
                        corrects + if is_correct { 1 } else { 0 },
                        now.to_rfc3339(),
                        forgetting,
                        sid,
                        knowledge_id
                    ],
                )?;
            } else {
                let initial_mastery = student_model::bkt_update(0.3, is_correct, &bkt_params);
                db.execute(
                    "INSERT INTO knowledge_mastery (student_id, knowledge_id, mastery_score, attempt_count, correct_count, last_practiced_at, forgetting_risk, bkt_p_know, updated_at)
                     VALUES (?1, ?2, ?3, 1, ?4, ?5, 0.0, ?3, ?5)",
                    rusqlite::params![
                        sid,
                        knowledge_id,
                        initial_mastery,
                        if is_correct { 1 } else { 0 },
                        now.to_rfc3339()
                    ],
                )?;

                // 同时确保 knowledge_nodes 表有记录
                let _ = db.execute(
                    "INSERT OR IGNORE INTO knowledge_nodes (id, name, grade, unit, sort_order) VALUES (?1, ?2, 6, 0, 0)",
                    rusqlite::params![knowledge_id, q.unit],
                );
            }
        }
    }

    // 更新 DashMap 实时状态
    if let Some(mut runtime) = state.student_states.get_mut(&sid) {
        runtime.total_questions += 1;
        if is_correct {
            runtime.correct_count += 1;
            runtime.consecutive_errors = 0;
        } else {
            runtime.consecutive_errors += 1;
        }
        // 更新疲劳度（基于时间和错误）
        let elapsed_duration = now.signed_duration_since(runtime.session_start_at);
        let elapsed = elapsed_duration.num_seconds() as f64;
        runtime.session_duration_secs = elapsed as i64;
        runtime.fatigue_level = compute_fatigue(
            elapsed,
            runtime.consecutive_errors,
            runtime.total_questions,
        );
        runtime.last_activity_at = now;
    }

    Ok(serde_json::json!({
        "record_id": record_id,
        "is_correct": is_correct,
        "error_type": error_type,
        "feedback": feedback,
        "time_spent_secs": time_spent_secs,
    }))
}

/// 结束学习会话
#[tauri::command]
pub async fn end_session(
    session_id: String,
    reason: String,
    state: State<'_, AppState>,
) -> AppResult<serde_json::Value> {
    let now = chrono::Utc::now();
    tracing::info!("结束会话 {}: {}", session_id, reason);

    let (total_q, correct_q, duration_secs, student_id) = {
        let db = state.db.lock().map_err(|e| AppError::Internal(e.to_string()))?;

        // 获取会话信息
        let (sid, started_at_str, total_q, correct_q): (String, String, i32, i32) = db.query_row(
            "SELECT student_id, started_at, total_questions, correct_count FROM learning_sessions WHERE id = ?1",
            rusqlite::params![session_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        ).map_err(|_| AppError::NotFound(format!("会话 {} 不存在", session_id)))?;

        // 计算时长
        let started_at = chrono::DateTime::parse_from_rfc3339(&started_at_str)
            .map(|dt| dt.with_timezone(&chrono::Utc))
            .unwrap_or(now);
        let duration = (now - started_at).num_seconds();

        // 更新会话结束
        db.execute(
            "UPDATE learning_sessions SET ended_at = ?1, end_reason = ?2, total_duration_secs = ?3 WHERE id = ?4",
            rusqlite::params![now.to_rfc3339(), reason, duration, session_id],
        )?;

        // 更新 daily_stats
        let today = now.format("%Y-%m-%d").to_string();
        db.execute(
            "INSERT INTO daily_stats (student_id, stat_date, total_duration_secs, session_count, question_count, correct_count)
             VALUES (?1, ?2, ?3, 1, ?4, ?5)
             ON CONFLICT(student_id, stat_date) DO UPDATE SET
                total_duration_secs = total_duration_secs + ?3,
                session_count = session_count + 1,
                question_count = question_count + ?4,
                correct_count = correct_count + ?5",
            rusqlite::params![sid, today, duration, total_q, correct_q],
        )?;

        (total_q, correct_q, duration, sid)
    };

    // 清除 DashMap 中的会话状态
    if let Some(mut runtime) = state.student_states.get_mut(&student_id) {
        runtime.current_session_id = None;
        runtime.consecutive_errors = 0;
        runtime.fatigue_level = 0.0;
    }

    let accuracy = if total_q > 0 {
        correct_q as f64 / total_q as f64
    } else {
        0.0
    };

    Ok(serde_json::json!({
        "session_id": session_id,
        "student_id": student_id,
        "reason": reason,
        "ended_at": now.to_rfc3339(),
        "total_questions": total_q,
        "correct_count": correct_q,
        "accuracy": accuracy,
        "duration_secs": duration_secs,
        "summary": format!("本次学习完成 {} 道题，正确 {} 道，正确率 {:.0}%", total_q, correct_q, accuracy * 100.0),
    }))
}

/// 计算疲劳度 (0.0 ~ 1.0)
fn compute_fatigue(elapsed_secs: f64, consecutive_errors: i32, total_questions: i32) -> f64 {
    // 时间疲劳：30分钟后开始上升
    let time_fatigue = (elapsed_secs / 1800.0).min(1.0) * 0.4;
    // 错误疲劳：连续错误越多越疲劳
    let error_fatigue = (consecutive_errors as f64 / 5.0).min(1.0) * 0.4;
    // 题量疲劳
    let quantity_fatigue = (total_questions as f64 / 30.0).min(1.0) * 0.2;

    (time_fatigue + error_fatigue + quantity_fatigue).min(1.0)
}
