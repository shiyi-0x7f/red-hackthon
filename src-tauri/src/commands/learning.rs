use tauri::State;
use crate::state::{AppState, StudentRuntimeState};
use crate::error::{AppError, AppResult};
use crate::services::{student_model, decision_engine, feature_engine};
use crate::services::feature_engine::AnswerData;
use crate::services::decision_engine::MasteryInfo;
use crate::ai::llm_client::{Message, LLMOptions};
use crate::ai::prompts;
use crate::commands::explain::log_event;

/// 开始学习会话
#[tauri::command]
pub async fn start_session(
    student_id: String,
    state: State<'_, AppState>,
) -> AppResult<serde_json::Value> {
    let session_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now();

    tracing::info!("学生 {} 开始学习会话 {}", student_id, session_id);

    // 写入 learning_sessions 表（先确保学生存在，避免外键报错）
    {
        let db = state.db.lock().map_err(|e| AppError::Internal(e.to_string()))?;

        // 自动创建默认学生（幂等）
        let default_name = if student_id == "default-student" { "小明" } else { &student_id };
        let _ = db.execute(
            "INSERT OR IGNORE INTO students (id, name, grade, created_at, updated_at)
             VALUES (?1, ?2, 6, datetime('now'), datetime('now'))",
            rusqlite::params![student_id, default_name],
        );

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
///
/// 新增字段：
/// - hints_used: 本题用了几层提示（0~3）
/// - 返回 next_action：决策引擎的下一步建议（自动出下一题闭环）
#[tauri::command]
pub async fn submit_answer(
    session_id: String,
    question_id: String,
    answer: serde_json::Value,
    time_spent_secs: i64,
    student_id: Option<String>,
    hints_used: Option<i32>,
    state: State<'_, AppState>,
) -> AppResult<serde_json::Value> {
    tracing::debug!("会话 {} 提交答案: 题目 {}", session_id, question_id);
    let hints_used = hints_used.unwrap_or(0).clamp(0, 3);

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

    // 从题库查找题目信息进行判题（先查 AI 动态出题缓存，再查静态题库）
    let question_info = state.ai_questions.get(&question_id).map(|r| r.clone())
        .or_else(|| state.question_bank.questions.iter().find(|q| q.id == question_id).cloned());

    let student_answer_str = match &answer {
        serde_json::Value::String(s) => s.clone(),
        other => other.to_string(),
    };

    // === 两层判题：规则 → LLM 兜底 ===
    let (is_correct, error_type, feedback) = if let Some(q) = &question_info {
        let (rule_result, rule_confident) = rule_judge(q, &student_answer_str);

        // 规则不确定（应用题/简答题/文本题）→ 调用 LLM 判题
        if !rule_confident {
            let llm_clone = {
                let guard = state.llm_client.lock().map_err(|e: std::sync::PoisonError<_>| AppError::Internal(e.to_string()))?;
                guard.clone()
            };
            if let Some(llm) = llm_clone {
                tracing::info!("规则判题不确定，走 LLM 兜底: {}", question_id);
                let grade = {
                    let db = state.db.lock().map_err(|e| AppError::Internal(e.to_string()))?;
                    db.query_row(
                        "SELECT grade FROM students WHERE id = ?1",
                        rusqlite::params![sid],
                        |row| row.get::<_, i32>(0),
                    ).unwrap_or(6)
                };
                let prompt = prompts::evaluate_answer(
                    &q.content_latex,
                    &q.answer_latex,
                    &student_answer_str,
                    grade,
                );
                let messages = vec![Message {
                    role: "user".to_string(),
                    content: prompt,
                }];
                let opts = LLMOptions {
                    temperature: Some(0.2),
                    max_tokens: Some(300),
                    top_p: Some(0.9),
                };
                match llm.complete(&messages, &opts).await {
                    Ok(raw) => match parse_judge_json(&raw) {
                        Some((c, et, fb)) => (c, et, fb),
                        None => {
                            tracing::warn!("LLM 判题 JSON 解析失败，回落规则判题");
                            (rule_result.0, rule_result.1, rule_result.2)
                        }
                    },
                    Err(e) => {
                        tracing::warn!("LLM 判题失败: {}, 回落规则判题", e);
                        (rule_result.0, rule_result.1, rule_result.2)
                    }
                }
            } else {
                (rule_result.0, rule_result.1, rule_result.2)
            }
        } else {
            (rule_result.0, rule_result.1, rule_result.2)
        }
    } else {
        (false, "unknown".to_string(), "题目信息未找到".to_string())
    };

    let record_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now();
    let q_difficulty = question_info.as_ref().map(|q| q.difficulty).unwrap_or(2);

    // 写入 answer_records + 更新 session + 加权 BKT
    {
        let db = state.db.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        db.execute(
            "INSERT INTO answer_records (id, session_id, question_id, student_id, student_answer, is_correct, time_spent_secs, hint_used, error_type, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            rusqlite::params![
                record_id,
                session_id,
                question_id,
                sid,
                student_answer_str,
                is_correct as i32,
                time_spent_secs,
                hints_used,
                error_type,
                now.to_rfc3339()
            ],
        )?;

        // 更新 session 统计
        db.execute(
            "UPDATE learning_sessions SET total_questions = total_questions + 1, correct_count = correct_count + ?1 WHERE id = ?2",
            rusqlite::params![is_correct as i32, session_id],
        )?;

        // 更新 knowledge_mastery (加权 BKT)
        if let Some(q) = &question_info {
            let knowledge_id = format!("kn-{}", q.unit.replace(" ", "_"));

            let existing: Option<(f64, i32, i32)> = db.query_row(
                "SELECT mastery_score, attempt_count, correct_count FROM knowledge_mastery WHERE student_id = ?1 AND knowledge_id = ?2",
                rusqlite::params![sid, knowledge_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            ).ok();

            let bkt_params = student_model::BKTParams::default();

            if let Some((old_mastery, attempts, corrects)) = existing {
                let new_mastery = student_model::bkt_update_weighted(
                    old_mastery, is_correct, hints_used, q_difficulty, &bkt_params,
                );
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
                let initial_mastery = student_model::bkt_update_weighted(
                    0.3, is_correct, hints_used, q_difficulty, &bkt_params,
                );
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

                let _ = db.execute(
                    "INSERT OR IGNORE INTO knowledge_nodes (id, name, grade, unit, sort_order) VALUES (?1, ?2, 6, 0, 0)",
                    rusqlite::params![knowledge_id, q.unit],
                );
            }
        }
    }

    // 更新 DashMap 实时状态
    let (rt_fatigue, rt_consec_err, rt_session_secs) = if let Some(mut runtime) = state.student_states.get_mut(&sid) {
        runtime.total_questions += 1;
        if is_correct {
            runtime.correct_count += 1;
            runtime.consecutive_errors = 0;
        } else {
            runtime.consecutive_errors += 1;
        }
        let elapsed_duration = now.signed_duration_since(runtime.session_start_at);
        let elapsed = elapsed_duration.num_seconds() as f64;
        runtime.session_duration_secs = elapsed as i64;
        runtime.fatigue_level = compute_fatigue(
            elapsed,
            runtime.consecutive_errors,
            runtime.total_questions,
        );
        runtime.last_activity_at = now;
        (runtime.fatigue_level, runtime.consecutive_errors, runtime.session_duration_secs)
    } else {
        (0.0, if is_correct { 0 } else { 1 }, time_spent_secs)
    };

    // === 写 behavior_features 快照 + student_states 快照 + event_log ===
    let (features, mastery_data) = {
        let db = state.db.lock().map_err(|e| AppError::Internal(e.to_string()))?;

        // 读最近 20 条 answer_records 算特征
        let mut stmt = db.prepare(
            "SELECT time_spent_secs, is_correct, hint_used FROM answer_records
             WHERE student_id = ?1 ORDER BY created_at DESC LIMIT 20"
        )?;
        let records: Vec<AnswerData> = stmt
            .query_map(rusqlite::params![sid], |row| {
                Ok(AnswerData {
                    time_spent_secs: row.get(0)?,
                    is_correct: row.get::<_, i32>(1)? == 1,
                    hint_used: row.get(2)?,
                    was_skipped: false,
                })
            })?
            .flatten()
            .collect();
        drop(stmt);

        let f = feature_engine::compute_features(&records);

        // 衍生：impulsivity = 响应时间 < 5s 的占比
        let impulsivity = if records.is_empty() {
            0.0
        } else {
            records.iter().filter(|r| r.time_spent_secs < 5).count() as f64 / records.len() as f64
        };
        let hint_dependency = (f.hint_usage_rate * 0.7 + (records.iter().filter(|r| r.hint_used > 0).count() as f64 / (records.len().max(1) as f64)) * 0.3).min(1.0);

        let _ = db.execute(
            "INSERT INTO behavior_features (student_id, session_id, avg_response_time, response_time_std, accuracy_rate, hint_usage_rate, max_consecutive_errors, impulsivity, hint_dependency, sample_count, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            rusqlite::params![
                sid, session_id, f.avg_response_time, f.response_time_std,
                f.accuracy_rate, f.hint_usage_rate, f.max_consecutive_errors,
                impulsivity, hint_dependency, records.len() as i32, now.to_rfc3339()
            ],
        );

        // student_states 快照
        let attention = (1.0 - rt_fatigue * 0.6 - impulsivity * 0.3).clamp(0.0, 1.0);
        let frustration = (rt_consec_err as f64 / 5.0).min(1.0);
        let cognitive_load = ((1.0 - f.accuracy_rate) * 0.5 + rt_fatigue * 0.5).min(1.0);
        let _ = db.execute(
            "INSERT INTO student_states (student_id, session_id, fatigue_level, attention_level, frustration, cognitive_load, consecutive_errors, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            rusqlite::params![
                sid, session_id, rt_fatigue, attention, frustration, cognitive_load, rt_consec_err, now.to_rfc3339()
            ],
        );

        // 读 mastery 用于决策
        let mut mastery: Vec<MasteryInfo> = Vec::new();
        if let Ok(mut stmt2) = db.prepare(
            "SELECT km.knowledge_id, COALESCE(kn.name, km.knowledge_id), km.mastery_score, km.forgetting_risk
             FROM knowledge_mastery km
             LEFT JOIN knowledge_nodes kn ON km.knowledge_id = kn.id
             WHERE km.student_id = ?1"
        ) {
            if let Ok(rows) = stmt2.query_map(rusqlite::params![sid], |row| {
                Ok(MasteryInfo {
                    knowledge_id: row.get(0)?,
                    name: row.get(1)?,
                    mastery_score: row.get(2)?,
                    forgetting_risk: row.get(3)?,
                    last_practiced_hours_ago: 0.0,
                })
            }) {
                for r in rows.flatten() { mastery.push(r); }
            }
        }

        (f, mastery)
    };

    // event_log
    log_event(&state, Some(&sid), Some(&session_id), "answer_submit", serde_json::json!({
        "question_id": question_id,
        "is_correct": is_correct,
        "error_type": error_type,
        "hints_used": hints_used,
        "time_spent_secs": time_spent_secs,
    }));

    // === decide_next：自动给出下一步建议（前端可据此自动出下一题） ===
    let next_action = decision_engine::decide(
        rt_fatigue,
        (rt_consec_err as f64 / 5.0).min(1.0),
        rt_consec_err,
        rt_session_secs / 60,
        30,
        &mastery_data,
    );
    log_event(&state, Some(&sid), Some(&session_id), "next_action", serde_json::json!({
        "action": next_action.action,
        "reasoning": next_action.reasoning,
    }));

    Ok(serde_json::json!({
        "record_id": record_id,
        "is_correct": is_correct,
        "error_type": error_type,
        "feedback": feedback,
        "time_spent_secs": time_spent_secs,
        "hints_used": hints_used,
        "behavior_features": {
            "avg_response_time": features.avg_response_time,
            "accuracy_rate": features.accuracy_rate,
            "hint_usage_rate": features.hint_usage_rate,
            "max_consecutive_errors": features.max_consecutive_errors,
        },
        "student_state": {
            "fatigue": rt_fatigue,
            "consecutive_errors": rt_consec_err,
            "session_minutes": rt_session_secs / 60,
        },
        "next_action": {
            "action": next_action.action,
            "reasoning": next_action.reasoning,
            "params": next_action.params,
        },
    }))
}

// =============================================
// 判题工具
// =============================================

/// 规则判题
///
/// 返回 ((is_correct, error_type, feedback), confident)
/// confident=false 时，调用方应该走 LLM 兜底
fn rule_judge(q: &crate::services::question_bank::BaseQuestion, student_answer: &str) -> ((bool, String, String), bool) {
    let qtype = q.question_type.as_str();

    // 应用题/简答题/综合应用 → 规则判题不可靠，交给 LLM
    let needs_llm = matches!(qtype, "应用题" | "简答题" | "综合应用");

    let correct_answer = q.answer_latex.trim();
    let student_ans = student_answer.trim();

    let normalize = |s: &str| -> String {
        s.replace(' ', "")
            .replace("\\,", "")
            .replace('$', "")
            .trim()
            .to_string()
    };

    let n_correct = normalize(correct_answer);
    let n_student = normalize(student_ans);

    let is_correct = n_correct == n_student
        || (!n_correct.is_empty() && (n_correct.contains(&n_student) || n_student.contains(&n_correct)) && n_student.len() >= 1);

    let error_type = if is_correct {
        "none".to_string()
    } else if student_ans.is_empty() {
        "careless".to_string()
    } else if n_student.len() < n_correct.len() / 2 {
        "conceptual".to_string()
    } else {
        "procedural".to_string()
    };

    let feedback = if is_correct {
        "做得好！继续加油".to_string()
    } else {
        format!("没关系，正确答案是 {}。我们一起看看哪里不对", correct_answer)
    };

    ((is_correct, error_type, feedback), !needs_llm)
}

/// AI 个性化会话总结
///
/// 读取 session 的 answer_records，组装成简短摘要喂给 LLM，
/// 输出结构化的 headline / highlights / to_review / encouragement
#[tauri::command]
pub async fn generate_session_summary(
    session_id: String,
    state: State<'_, AppState>,
) -> AppResult<serde_json::Value> {
    tracing::info!("生成会话总结: session={}", session_id);

    // 1. 读取 session 元信息
    let (sid, total_q, correct_q, started_at, ended_at) = {
        let db = state.db.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        db.query_row(
            "SELECT student_id, total_questions, correct_count, started_at, ended_at
             FROM learning_sessions WHERE id = ?1",
            rusqlite::params![session_id],
            |row| Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i32>(1)?,
                row.get::<_, i32>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
            )),
        ).map_err(|_| AppError::NotFound(format!("会话 {} 不存在", session_id)))?
    };

    if total_q == 0 {
        return Ok(serde_json::json!({
            "headline": "本次还没做题",
            "highlights": [],
            "to_review": [],
            "encouragement": "下次我们一起来挑战吧！",
            "fallback": true,
        }));
    }

    let accuracy_pct = (correct_q as f64 / total_q as f64 * 100.0).round() as i32;

    // 计算时长（分钟）
    let duration_minutes: i64 = {
        let start = chrono::DateTime::parse_from_rfc3339(&started_at)
            .map(|dt| dt.with_timezone(&chrono::Utc))
            .ok();
        let end = ended_at.as_deref()
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|dt| dt.with_timezone(&chrono::Utc))
            .unwrap_or_else(chrono::Utc::now);
        match start {
            Some(s) => (end - s).num_minutes().max(0),
            None => 0,
        }
    };

    // 2. 读 answer_records 摘要 + 取学生年级
    let (answers_brief, grade) = {
        let db = state.db.lock().map_err(|e| AppError::Internal(e.to_string()))?;

        let g: i32 = db.query_row(
            "SELECT grade FROM students WHERE id = ?1",
            rusqlite::params![sid],
            |row| row.get(0),
        ).unwrap_or(6);

        let mut stmt = db.prepare(
            "SELECT ar.is_correct, ar.error_type, ar.hint_used, ar.time_spent_secs, q.unit
             FROM answer_records ar
             LEFT JOIN questions q ON ar.question_id = q.id
             WHERE ar.session_id = ?1
             ORDER BY ar.created_at ASC LIMIT 30"
        )?;
        let rows: Vec<(i32, Option<String>, i32, i64, Option<String>)> = stmt
            .query_map(rusqlite::params![session_id], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?))
            })?
            .flatten()
            .collect();
        drop(stmt);

        let mut brief = String::new();
        for (i, (is_correct, err, hint, time, unit)) in rows.iter().enumerate() {
            let mark = if *is_correct == 1 { "✓" } else { "✗" };
            let unit_s = unit.as_deref().unwrap_or("（未知单元）");
            let err_s = err.as_deref().unwrap_or("");
            brief.push_str(&format!(
                "  {}. {} [{}] {}秒{}{}\n",
                i + 1,
                mark,
                unit_s,
                time,
                if *hint > 0 { format!(" 用了{}层提示", hint) } else { String::new() },
                if !err_s.is_empty() && *is_correct == 0 { format!(" 错因:{}", err_s) } else { String::new() },
            ));
        }
        (brief, g)
    };

    // 3. 取学生薄弱知识点
    let weak_topics: Vec<String> = {
        let db = state.db.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let mut topics = Vec::new();
        if let Ok(mut stmt) = db.prepare(
            "SELECT COALESCE(kn.name, km.knowledge_id) FROM knowledge_mastery km
             LEFT JOIN knowledge_nodes kn ON km.knowledge_id = kn.id
             WHERE km.student_id = ?1 ORDER BY km.mastery_score ASC LIMIT 3"
        ) {
            if let Ok(rows) = stmt.query_map(rusqlite::params![sid], |row| row.get::<_, String>(0)) {
                for r in rows.flatten() { topics.push(r); }
            }
        }
        topics
    };

    // 4. 调 LLM
    let llm_clone = {
        let guard = state.llm_client.lock().map_err(|e: std::sync::PoisonError<_>| AppError::Internal(e.to_string()))?;
        guard.clone()
    };

    if let Some(llm) = llm_clone {
        let prompt = prompts::session_summary(
            grade, total_q, correct_q, accuracy_pct, duration_minutes,
            &answers_brief, &weak_topics
        );
        let messages = vec![
            Message {
                role: "system".to_string(),
                content: "你是温暖的小学数学老师，必须严格 JSON 输出。".to_string(),
            },
            Message { role: "user".to_string(), content: prompt },
        ];
        let opts = LLMOptions {
            temperature: Some(0.7),
            max_tokens: Some(400),
            top_p: Some(0.9),
        };
        match llm.complete(&messages, &opts).await {
            Ok(raw) => {
                let parsed = parse_summary_json(&raw)
                    .unwrap_or_else(|| build_fallback_summary(accuracy_pct, &weak_topics));
                // 把统计字段并入返回
                let mut obj = parsed.as_object().cloned().unwrap_or_default();
                obj.insert("total_questions".to_string(), serde_json::json!(total_q));
                obj.insert("correct_count".to_string(), serde_json::json!(correct_q));
                obj.insert("accuracy_pct".to_string(), serde_json::json!(accuracy_pct));
                obj.insert("duration_minutes".to_string(), serde_json::json!(duration_minutes));
                obj.insert("from_llm".to_string(), serde_json::json!(true));
                return Ok(serde_json::Value::Object(obj));
            }
            Err(e) => {
                tracing::warn!("LLM 总结失败: {}, 走兜底", e);
            }
        }
    }

    // 5. 兜底
    let mut fallback = build_fallback_summary(accuracy_pct, &weak_topics).as_object().cloned().unwrap_or_default();
    fallback.insert("total_questions".to_string(), serde_json::json!(total_q));
    fallback.insert("correct_count".to_string(), serde_json::json!(correct_q));
    fallback.insert("accuracy_pct".to_string(), serde_json::json!(accuracy_pct));
    fallback.insert("duration_minutes".to_string(), serde_json::json!(duration_minutes));
    fallback.insert("from_llm".to_string(), serde_json::json!(false));
    Ok(serde_json::Value::Object(fallback))
}

fn parse_summary_json(raw: &str) -> Option<serde_json::Value> {
    let trimmed = raw.trim();
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) {
        if v.is_object() && v.get("headline").is_some() { return Some(v); }
    }
    if let Some(s) = trimmed.find("```json") {
        let after = &trimmed[s + 7..];
        if let Some(e) = after.find("```") {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(after[..e].trim()) {
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

fn build_fallback_summary(accuracy_pct: i32, weak_topics: &[String]) -> serde_json::Value {
    let headline = if accuracy_pct >= 90 {
        "今天的状态非常棒！"
    } else if accuracy_pct >= 70 {
        "稳扎稳打，进步明显"
    } else if accuracy_pct >= 50 {
        "继续努力，越来越好"
    } else {
        "没关系，慢慢来"
    };
    let to_review: Vec<String> = weak_topics.iter().take(3).cloned().collect();
    serde_json::json!({
        "headline": headline,
        "highlights": ["完成了今天的练习"],
        "to_review": to_review,
        "encouragement": "我们一起期待下一次的进步！",
    })
}

/// 解析 LLM 判题的 JSON 输出
fn parse_judge_json(raw: &str) -> Option<(bool, String, String)> {
    let try_parse = |s: &str| -> Option<serde_json::Value> { serde_json::from_str(s.trim()).ok() };

    let val = try_parse(raw)
        .or_else(|| {
            // ```json ... ```
            raw.find("```json").and_then(|s| {
                let after = &raw[s + 7..];
                after.find("```").and_then(|e| try_parse(&after[..e]))
            })
        })
        .or_else(|| {
            // 花括号
            let s = raw.find('{')?;
            let e = raw.rfind('}')?;
            try_parse(&raw[s..=e])
        })?;

    let is_correct = val.get("is_correct")?.as_bool()?;
    let error_type = val.get("error_type").and_then(|v| v.as_str()).unwrap_or("none").to_string();
    let feedback = val.get("feedback").and_then(|v| v.as_str()).unwrap_or("").to_string();
    Some((is_correct, error_type, feedback))
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
