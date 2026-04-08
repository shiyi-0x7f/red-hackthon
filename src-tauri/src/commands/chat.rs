use tauri::State;
use crate::state::{AppState, ChatPacingState};
use crate::error::{AppError, AppResult};
use crate::ai::llm_client::{Message, LLMOptions};
use crate::ai::prompts;
use crate::ai::safety;
use crate::commands::interests::build_interest_context;

/// 发送聊天消息（JSON 结构化输出）
#[tauri::command]
pub async fn send_chat_message(
    student_id: String,
    message: String,
    state: State<'_, AppState>,
) -> AppResult<serde_json::Value> {
    tracing::debug!("聊天: 学生 {} 说 '{}'", student_id, message);
    let now = chrono::Utc::now();

    // 确保学生存在（自动创建默认学生）
    let grade = {
        let db = state.db.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let existing_grade = db.query_row(
            "SELECT grade FROM students WHERE id = ?1",
            rusqlite::params![student_id],
            |row| row.get::<_, i32>(0),
        ).ok();

        match existing_grade {
            Some(g) => g,
            None => {
                tracing::info!("自动创建学生: {}", student_id);
                let _ = db.execute(
                    "INSERT OR IGNORE INTO students (id, name, grade, created_at, updated_at) VALUES (?1, '小明', 6, datetime('now'), datetime('now'))",
                    rusqlite::params![student_id],
                );
                6
            }
        }
    };

    // 获取最近对话历史（最多 6 条）
    let history = {
        let db = state.db.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let mut msgs: Vec<Message> = Vec::new();
        if let Ok(mut stmt) = db.prepare(
            "SELECT role, content FROM chat_records WHERE student_id = ?1 ORDER BY created_at DESC LIMIT 6"
        ) {
            if let Ok(rows) = stmt.query_map(rusqlite::params![student_id], |row| {
                Ok(Message {
                    role: row.get::<_, String>(0)?,
                    content: row.get::<_, String>(1)?,
                })
            }) {
                for row in rows.flatten() {
                    msgs.push(row);
                }
            }
        }
        msgs.reverse();
        msgs
    };

    // 统计今日聊天条数
    let today_count = {
        let db = state.db.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let today = now.format("%Y-%m-%d").to_string();
        db.query_row(
            "SELECT COUNT(*) FROM chat_records WHERE student_id = ?1 AND role = 'user' AND created_at LIKE ?2",
            rusqlite::params![student_id, format!("{}%", today)],
            |row| row.get::<_, i64>(0),
        ).unwrap_or(0)
    };

    let max_daily_chats = 20;
    let remaining = (max_daily_chats - today_count).max(0);

    // 检查是否超出每日上限
    if remaining <= 0 {
        return Ok(serde_json::json!({
            "reply": "今天聊天次数已经用完啦～明天再来找我聊天吧！现在可以去做做练习哦",
            "chat_remaining": 0,
            "is_limited": true,
            "limit_reason": "daily_quota",
            "is_stream": false,
        }));
    }

    // === 节奏控制：5 分钟硬限 + 15 分钟冷却 ===
    const MAX_CHAT_SECS: i64 = 300;        // 5 分钟一次会话
    const COOLDOWN_SECS: i64 = 15 * 60;    // 15 分钟冷却

    let mut entry = state.chat_pacing.entry(student_id.clone()).or_default();

    // 1. 在冷却中？
    if let Some(cool_start) = entry.cooldown_started_at {
        let elapsed = (now - cool_start).num_seconds();
        if elapsed < COOLDOWN_SECS {
            let remain_min = (COOLDOWN_SECS - elapsed) / 60 + 1;
            return Ok(serde_json::json!({
                "reply": format!("我们刚才聊了挺多啦，先各自休息一下吧，{} 分钟后再来找我聊天 ✨", remain_min),
                "chat_remaining": remaining,
                "is_limited": true,
                "limit_reason": "cooldown",
                "cooldown_remaining_secs": COOLDOWN_SECS - elapsed,
                "is_stream": false,
            }));
        } else {
            // 冷却结束，重置
            entry.cooldown_started_at = None;
            entry.accumulated_secs = 0;
            entry.session_started_at = None;
        }
    }

    // 2. 启动或延长当前会话
    if entry.session_started_at.is_none() {
        entry.session_started_at = Some(now);
        entry.accumulated_secs = 0;
    }
    let session_start = entry.session_started_at.unwrap();
    let session_secs = (now - session_start).num_seconds();
    entry.accumulated_secs = session_secs;

    // 3. 5 分钟硬限触发 → 进入冷却
    if session_secs >= MAX_CHAT_SECS {
        entry.cooldown_started_at = Some(now);
        let _msg_session_secs = session_secs;
        drop(entry);
        return Ok(serde_json::json!({
            "reply": "我们已经聊了差不多 5 分钟啦～休息一下，等会再聊吧。要不要先去做几道题练练手？",
            "chat_remaining": remaining,
            "is_limited": true,
            "limit_reason": "session_max",
            "session_secs": _msg_session_secs,
            "is_stream": false,
        }));
    }
    drop(entry);

    // 保存用户消息
    {
        let db = state.db.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let id = uuid::Uuid::new_v4().to_string();
        db.execute(
            "INSERT INTO chat_records (id, student_id, role, content, context_type, created_at) VALUES (?1, ?2, 'user', ?3, 'casual', ?4)",
            rusqlite::params![id, student_id, message, now.to_rfc3339()],
        )?;
    }

    // 提取 LLM 客户端
    let llm_clone = {
        let guard = state.llm_client.lock().map_err(|e: std::sync::PoisonError<_>| AppError::Internal(e.to_string()))?;
        guard.clone()
    };

    let has_llm = llm_clone.is_some();
    tracing::info!("LLM 客户端状态: {}", if has_llm { "可用 ✓" } else { "未配置 — 使用预设回复" });

    // === RAG: 根据用户意图检索学习上下文 ===
    let learning_context = retrieve_learning_context(&state, &student_id, &message)?;
    if !learning_context.is_empty() {
        tracing::info!("RAG 检索到学习上下文 ({} 字符)", learning_context.len());
    }

    // === RAG: 兴趣 / 背景上下文 ===
    let interest_context = build_interest_context(&state, &student_id);
    if !interest_context.is_empty() {
        tracing::info!("RAG 注入兴趣上下文 ({} 字符)", interest_context.len());
    }

    let reply = if let Some(llm) = llm_clone {
        // 构建消息列表
        let mut messages = vec![
            Message {
                role: "system".to_string(),
                content: prompts::system_persona(grade),
            },
        ];

        // 注入 RAG 上下文（作为 system 消息）
        if !learning_context.is_empty() {
            messages.push(Message {
                role: "system".to_string(),
                content: format!(
                    "以下是该学生的学习数据，请根据这些数据回答学生的问题：\n\n{}",
                    learning_context
                ),
            });
        }

        // 注入兴趣 / 背景上下文
        if !interest_context.is_empty() {
            messages.push(Message {
                role: "system".to_string(),
                content: format!(
                    "以下是该学生的兴趣和背景信息，请在回复中自然地体现对这些兴趣的了解（例如举例时选他喜欢的话题），但不要生硬地列举：\n\n{}",
                    interest_context
                ),
            });
        }

        for msg in &history {
            messages.push(msg.clone());
        }

        // 收束策略
        let turn_count = history.iter().filter(|m| m.role == "user").count();
        let user_content = if turn_count >= 3 {
            format!(
                "{}\n\n（系统提示：这已经是第{}轮对话了，请在回复后温和地引导学生回到学习中。）",
                message, turn_count + 1
            )
        } else {
            message.clone()
        };

        messages.push(Message {
            role: "user".to_string(),
            content: user_content,
        });

        let opts = LLMOptions {
            temperature: Some(0.8),
            max_tokens: Some(512),
            top_p: Some(0.9),
        };

        // 使用非流式调用（JSON 格式不适合流式）
        match llm.complete(&messages, &opts).await {
            Ok(raw_reply) => {
                tracing::debug!("LLM 原始回复: {}", raw_reply);
                raw_reply
            }
            Err(e) => {
                tracing::warn!("LLM 调用失败: {}", e);
                generate_fallback_reply(&message, grade)
            }
        }
    } else {
        generate_fallback_reply(&message, grade)
    };

    // 尝试解析 JSON（LLM 可能返回 JSON 或纯文本）
    let parsed = parse_llm_reply(&reply);

    // 取出回复正文
    let raw_display = parsed.get("text")
        .and_then(|v| v.as_str())
        .unwrap_or(&reply)
        .to_string();

    // === 安全过滤：禁用词 / 情感绑定 / 敏感内容升级 ===
    let safety_result = safety::sanitize_output(&raw_display);
    let display_text = if safety_result.is_safe {
        raw_display
    } else if safety_result.needs_escalation {
        // 敏感内容 → 替换为标准引导语，并日志记录
        tracing::warn!("[chat] 敏感内容触发，已替换为标准引导语");
        "嗯…谢谢你跟我说这些。我们可以一起跟你信任的大人聊聊吗？或者先休息一会，做点你喜欢的事。".to_string()
    } else {
        safety_result.sanitized
    };
    {
        let db = state.db.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let id = uuid::Uuid::new_v4().to_string();
        db.execute(
            "INSERT INTO chat_records (id, student_id, role, content, context_type, created_at) VALUES (?1, ?2, 'assistant', ?3, 'casual', ?4)",
            rusqlite::params![id, student_id, display_text, now.to_rfc3339()],
        )?;
    }

    let session_secs_now = state
        .chat_pacing
        .get(&student_id)
        .map(|e| e.accumulated_secs)
        .unwrap_or(0);

    Ok(serde_json::json!({
        "reply": display_text,
        "structured": parsed,
        "chat_remaining": remaining - 1,
        "is_limited": false,
        "session_secs": session_secs_now,
        "session_max_secs": 300,
        "needs_escalation": safety_result.needs_escalation,
        "safety_violations": safety_result.violations.len(),
    }))
}

/// 获取聊天历史
#[tauri::command]
pub async fn get_chat_history(
    student_id: String,
    limit: Option<i32>,
    state: State<'_, AppState>,
) -> AppResult<Vec<serde_json::Value>> {
    let limit = limit.unwrap_or(20);
    let db = state.db.lock().map_err(|e| AppError::Internal(e.to_string()))?;

    let mut records = Vec::new();
    if let Ok(mut stmt) = db.prepare(
        "SELECT id, role, content, context_type, created_at FROM chat_records WHERE student_id = ?1 ORDER BY created_at DESC LIMIT ?2"
    ) {
        if let Ok(rows) = stmt.query_map(rusqlite::params![student_id, limit], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "role": row.get::<_, String>(1)?,
                "content": row.get::<_, String>(2)?,
                "context_type": row.get::<_, Option<String>>(3)?,
                "created_at": row.get::<_, String>(4)?,
            }))
        }) {
            for row in rows.flatten() {
                records.push(row);
            }
        }
    }

    records.reverse();
    Ok(records)
}

/// 预设回复（无 LLM 时的回退）— 直接返回 JSON 格式字符串
fn generate_fallback_reply(message: &str, _grade: i32) -> String {
    let msg_lower = message.to_lowercase();

    let text = if msg_lower.contains("你好") || msg_lower.contains("嗨") || msg_lower.contains("hi") {
        "你好呀！我是你的数学学习搭子，今天想做什么呢？可以做几道题练习，也可以复习之前的内容！"
    } else if msg_lower.contains("不会") || msg_lower.contains("太难") || msg_lower.contains("难") {
        "没关系呀！每个人都有不太擅长的地方。我们可以从简单的开始，一步一步来！"
    } else if msg_lower.contains("累") || msg_lower.contains("不想") || msg_lower.contains("休息") {
        "学累了呀？那就去休息区放松一下吧！适当休息才能学得更好哦。"
    } else if msg_lower.contains("学") || msg_lower.contains("题") || msg_lower.contains("练习") {
        "好的！我们来做几道有趣的数学题吧，点击左边的学习按钮就可以开始啦！"
    } else if msg_lower.contains("复习") {
        "复习是个好主意！点击左边的复习按钮，AI会根据你的遗忘曲线找到最需要复习的知识点。"
    } else {
        "嗯嗯，我听到你说的啦！要不我们一起做几道数学题吧？"
    };

    // 返回 JSON 格式字符串
    serde_json::json!({
        "text": text,
        "question": null,
        "steps": null,
        "action": null
    }).to_string()
}

/// 解析 LLM 回复为结构化 JSON
fn parse_llm_reply(raw: &str) -> serde_json::Value {
    let trimmed = raw.trim();

    // 尝试直接解析
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) {
        if v.is_object() {
            return v;
        }
    }

    // 尝试提取 ```json ... ``` 代码块
    if let Some(start) = trimmed.find("```json") {
        let after = &trimmed[start + 7..];
        if let Some(end) = after.find("```") {
            let json_str = after[..end].trim();
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(json_str) {
                if v.is_object() {
                    return v;
                }
            }
        }
    }

    // 尝试提取 ``` ... ```
    if let Some(start) = trimmed.find("```") {
        let after = &trimmed[start + 3..];
        // 跳过语言标识符行
        let after = if let Some(nl) = after.find('\n') {
            &after[nl + 1..]
        } else {
            after
        };
        if let Some(end) = after.find("```") {
            let json_str = after[..end].trim();
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(json_str) {
                if v.is_object() {
                    return v;
                }
            }
        }
    }

    // 尝试提取花括号内容
    if let Some(start) = trimmed.find('{') {
        if let Some(end) = trimmed.rfind('}') {
            let json_str = &trimmed[start..=end];
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(json_str) {
                if v.is_object() {
                    return v;
                }
            }
        }
    }

    // 解析失败：包装为纯文本 JSON
    tracing::warn!("LLM 回复非 JSON，包装为纯文本: {}", &trimmed[..trimmed.len().min(100)]);
    serde_json::json!({
        "text": trimmed,
        "question": null,
        "steps": null,
        "action": null
    })
}

// =============================================
// RAG 学习上下文检索
// =============================================

/// 用户意图类型
#[derive(Debug)]
enum UserIntent {
    /// 复习相关（"复习"、"昨天学的"、"之前学的"）
    Review,
    /// 查看进度（"学了多少"、"进度"、"掌握"）
    Progress,
    /// 困难求助（"不会"、"太难"、"不懂"）
    Difficulty,
    /// 出题练习（"出题"、"练习"、"做题"）
    Practice,
    /// 通用闲聊
    General,
}

/// 从用户消息中检测意图
fn detect_intent(message: &str) -> UserIntent {
    let m = message.to_lowercase();
    if m.contains("复习") || m.contains("昨天") || m.contains("之前学") || m.contains("上次") || m.contains("回顾") {
        UserIntent::Review
    } else if m.contains("进度") || m.contains("掌握") || m.contains("学了多少") || m.contains("情况") || m.contains("学了什么") {
        UserIntent::Progress
    } else if m.contains("不会") || m.contains("太难") || m.contains("不懂") || m.contains("不理解") || m.contains("搞不清") {
        UserIntent::Difficulty
    } else if m.contains("出题") || m.contains("练习") || m.contains("做题") || m.contains("考考") {
        UserIntent::Practice
    } else {
        UserIntent::General
    }
}

/// 根据意图检索学习上下文（RAG 核心）
fn retrieve_learning_context(
    state: &AppState,
    student_id: &str,
    message: &str,
) -> AppResult<String> {
    let intent = detect_intent(message);
    tracing::debug!("RAG 意图检测: {:?}", intent);

    let db = state.db.lock().map_err(|e| AppError::Internal(e.to_string()))?;
    let mut context_parts: Vec<String> = Vec::new();

    match intent {
        UserIntent::Review => {
            // 查询最近的学习记录（按天分组）
            let mut stmt = db.prepare(
                "SELECT kn.name, ar.is_correct, ar.created_at, ar.error_type
                 FROM answer_records ar
                 JOIN questions q ON ar.question_id = q.id
                 JOIN knowledge_nodes kn ON q.knowledge_id = kn.id
                 WHERE ar.student_id = ?1
                 ORDER BY ar.created_at DESC LIMIT 20"
            ).map_err(|e| AppError::Internal(e.to_string()))?;

            let records: Vec<(String, i32, String, Option<String>)> = stmt.query_map(
                rusqlite::params![student_id],
                |row| Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i32>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                )),
            ).map_err(|e| AppError::Internal(e.to_string()))?
            .flatten().collect();

            if records.is_empty() {
                context_parts.push("【学习记录】该学生暂无答题记录，是新用户。".to_string());
            } else {
                let mut summary = String::from("【最近学习记录】\n");
                for (name, correct, time, err) in &records {
                    let result = if *correct == 1 { "✓" } else { "✗" };
                    let err_info = err.as_deref().unwrap_or("");
                    summary.push_str(&format!("- {} {} | {} {} {}\n",
                        &time[..10], name, result,
                        if *correct == 0 { "错误类型:" } else { "" },
                        err_info
                    ));
                }
                context_parts.push(summary);
            }

            // 查询需要复习的知识点（遗忘风险高的）
            let mut stmt2 = db.prepare(
                "SELECT kn.name, km.mastery_score, km.forgetting_risk, km.last_practiced_at
                 FROM knowledge_mastery km
                 JOIN knowledge_nodes kn ON km.knowledge_id = kn.id
                 WHERE km.student_id = ?1 AND km.forgetting_risk > 0.3
                 ORDER BY km.forgetting_risk DESC LIMIT 5"
            ).map_err(|e| AppError::Internal(e.to_string()))?;

            let risky: Vec<(String, f64, f64, Option<String>)> = stmt2.query_map(
                rusqlite::params![student_id],
                |row| Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, f64>(1)?,
                    row.get::<_, f64>(2)?,
                    row.get::<_, Option<String>>(3)?,
                )),
            ).map_err(|e| AppError::Internal(e.to_string()))?
            .flatten().collect();

            if !risky.is_empty() {
                let mut s = String::from("【建议复习的知识点（遗忘风险高）】\n");
                for (name, mastery, risk, last_time) in &risky {
                    let last = last_time.as_deref().map(|t| &t[..10]).unwrap_or("未练习");
                    s.push_str(&format!("- {}：掌握度 {:.0}%，遗忘风险 {:.0}%，上次练习 {}\n",
                        name, mastery * 100.0, risk * 100.0, last));
                }
                context_parts.push(s);
            }
        }

        UserIntent::Progress => {
            // 查询整体掌握度
            let mut stmt = db.prepare(
                "SELECT kn.name, km.mastery_score, km.attempt_count, km.correct_count
                 FROM knowledge_mastery km
                 JOIN knowledge_nodes kn ON km.knowledge_id = kn.id
                 WHERE km.student_id = ?1
                 ORDER BY km.mastery_score ASC LIMIT 10"
            ).map_err(|e| AppError::Internal(e.to_string()))?;

            let masteries: Vec<(String, f64, i32, i32)> = stmt.query_map(
                rusqlite::params![student_id],
                |row| Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, f64>(1)?,
                    row.get::<_, i32>(2)?,
                    row.get::<_, i32>(3)?,
                )),
            ).map_err(|e| AppError::Internal(e.to_string()))?
            .flatten().collect();

            if masteries.is_empty() {
                context_parts.push("【学习进度】暂无学习数据。".to_string());
            } else {
                let mut s = String::from("【知识点掌握情况（从低到高）】\n");
                for (name, score, attempts, correct) in &masteries {
                    s.push_str(&format!("- {}：掌握度 {:.0}%，练习 {} 道（正确 {} 道）\n",
                        name, score * 100.0, attempts, correct));
                }
                context_parts.push(s);
            }

            // 查询每日统计（最近7天）
            let mut stmt2 = db.prepare(
                "SELECT stat_date, question_count, correct_count, total_duration_secs
                 FROM daily_stats
                 WHERE student_id = ?1
                 ORDER BY stat_date DESC LIMIT 7"
            ).map_err(|e| AppError::Internal(e.to_string()))?;

            let daily: Vec<(String, i32, i32, i32)> = stmt2.query_map(
                rusqlite::params![student_id],
                |row| Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i32>(1)?,
                    row.get::<_, i32>(2)?,
                    row.get::<_, i32>(3)?,
                )),
            ).map_err(|e| AppError::Internal(e.to_string()))?
            .flatten().collect();

            if !daily.is_empty() {
                let mut s = String::from("【近7天学习统计】\n");
                for (date, q_count, c_count, duration) in &daily {
                    s.push_str(&format!("- {}：做了{}道题（正确{}道），学习{}分钟\n",
                        date, q_count, c_count, duration / 60));
                }
                context_parts.push(s);
            }
        }

        UserIntent::Difficulty => {
            // 查询该学生最薄弱的知识点
            let mut stmt = db.prepare(
                "SELECT kn.name, km.mastery_score, km.attempt_count
                 FROM knowledge_mastery km
                 JOIN knowledge_nodes kn ON km.knowledge_id = kn.id
                 WHERE km.student_id = ?1 AND km.mastery_score < 0.6
                 ORDER BY km.mastery_score ASC LIMIT 5"
            ).map_err(|e| AppError::Internal(e.to_string()))?;

            let weak: Vec<(String, f64, i32)> = stmt.query_map(
                rusqlite::params![student_id],
                |row| Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, f64>(1)?,
                    row.get::<_, i32>(2)?,
                )),
            ).map_err(|e| AppError::Internal(e.to_string()))?
            .flatten().collect();

            if !weak.is_empty() {
                let mut s = String::from("【薄弱知识点】\n");
                for (name, score, attempts) in &weak {
                    s.push_str(&format!("- {}：掌握度 {:.0}%，已练习 {} 道题\n",
                        name, score * 100.0, attempts));
                }
                context_parts.push(s);
            }

            // 查询最近的错题
            let mut stmt2 = db.prepare(
                "SELECT kn.name, q.content, ar.error_type, ar.created_at
                 FROM answer_records ar
                 JOIN questions q ON ar.question_id = q.id
                 JOIN knowledge_nodes kn ON q.knowledge_id = kn.id
                 WHERE ar.student_id = ?1 AND ar.is_correct = 0
                 ORDER BY ar.created_at DESC LIMIT 5"
            ).map_err(|e| AppError::Internal(e.to_string()))?;

            let errors: Vec<(String, String, Option<String>, String)> = stmt2.query_map(
                rusqlite::params![student_id],
                |row| Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, String>(3)?,
                )),
            ).map_err(|e| AppError::Internal(e.to_string()))?
            .flatten().collect();

            if !errors.is_empty() {
                let mut s = String::from("【最近错题】\n");
                for (name, _content, err_type, time) in &errors {
                    let err = err_type.as_deref().unwrap_or("未分类");
                    s.push_str(&format!("- [{}] {}，错误类型: {}\n", &time[..10], name, err));
                }
                context_parts.push(s);
            }
        }

        UserIntent::Practice => {
            // 查询掌握度中等的知识点（适合出题）
            let mut stmt = db.prepare(
                "SELECT kn.name, km.mastery_score
                 FROM knowledge_mastery km
                 JOIN knowledge_nodes kn ON km.knowledge_id = kn.id
                 WHERE km.student_id = ?1
                 ORDER BY km.mastery_score ASC LIMIT 5"
            ).map_err(|e| AppError::Internal(e.to_string()))?;

            let topics: Vec<(String, f64)> = stmt.query_map(
                rusqlite::params![student_id],
                |row| Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, f64>(1)?,
                )),
            ).map_err(|e| AppError::Internal(e.to_string()))?
            .flatten().collect();

            if !topics.is_empty() {
                let mut s = String::from("【建议出题方向（掌握度偏低的知识点）】\n");
                for (name, score) in &topics {
                    s.push_str(&format!("- {}：掌握度 {:.0}%\n", name, score * 100.0));
                }
                context_parts.push(s);
            }
        }

        UserIntent::General => {
            // 通用：只注入简要学习概况
            let total_questions: i64 = db.query_row(
                "SELECT COUNT(*) FROM answer_records WHERE student_id = ?1",
                rusqlite::params![student_id],
                |row| row.get(0),
            ).unwrap_or(0);

            let total_correct: i64 = db.query_row(
                "SELECT COUNT(*) FROM answer_records WHERE student_id = ?1 AND is_correct = 1",
                rusqlite::params![student_id],
                |row| row.get(0),
            ).unwrap_or(0);

            let mastered_count: i64 = db.query_row(
                "SELECT COUNT(*) FROM knowledge_mastery WHERE student_id = ?1 AND mastery_score >= 0.8",
                rusqlite::params![student_id],
                |row| row.get(0),
            ).unwrap_or(0);

            if total_questions > 0 {
                let accuracy = if total_questions > 0 { total_correct as f64 / total_questions as f64 * 100.0 } else { 0.0 };
                context_parts.push(format!(
                    "【学习概况】总做题 {} 道，正确率 {:.0}%，已掌握 {} 个知识点。",
                    total_questions, accuracy, mastered_count
                ));
            }
        }
    }

    Ok(context_parts.join("\n"))
}
