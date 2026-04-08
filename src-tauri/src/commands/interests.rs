use tauri::State;
use crate::state::AppState;
use crate::error::{AppError, AppResult};
use crate::ai::llm_client::{Message, LLMOptions};
use crate::ai::prompts;

/// 列出学生所有兴趣
#[tauri::command]
pub async fn list_interests(
    student_id: String,
    state: State<'_, AppState>,
) -> AppResult<Vec<serde_json::Value>> {
    let db = state.db.lock().map_err(|e| AppError::Internal(e.to_string()))?;
    let mut out: Vec<serde_json::Value> = Vec::new();
    let mut stmt = db.prepare(
        "SELECT id, category, name, affinity, source, notes, created_at
         FROM interest_profile WHERE student_id = ?1
         ORDER BY affinity DESC, created_at DESC"
    )?;
    let rows = stmt.query_map(rusqlite::params![student_id], |row| {
        Ok(serde_json::json!({
            "id": row.get::<_, i64>(0)?,
            "category": row.get::<_, String>(1)?,
            "name": row.get::<_, String>(2)?,
            "affinity": row.get::<_, f64>(3)?,
            "source": row.get::<_, String>(4)?,
            "notes": row.get::<_, Option<String>>(5)?,
            "created_at": row.get::<_, String>(6)?,
        }))
    })?;
    for r in rows.flatten() { out.push(r); }
    Ok(out)
}

/// 手动添加一条兴趣
#[tauri::command]
pub async fn add_interest(
    student_id: String,
    category: String,
    name: String,
    affinity: Option<f64>,
    notes: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<i64> {
    let aff = affinity.unwrap_or(0.8).clamp(0.0, 1.0);
    ensure_student_exists(&state, &student_id)?;
    let db = state.db.lock().map_err(|e| AppError::Internal(e.to_string()))?;
    let now = chrono::Utc::now().to_rfc3339();
    db.execute(
        "INSERT INTO interest_profile (student_id, category, name, affinity, source, notes, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 'manual', ?5, ?6, ?6)
         ON CONFLICT(student_id, category, name) DO UPDATE SET
             affinity = excluded.affinity,
             notes = COALESCE(excluded.notes, interest_profile.notes),
             updated_at = excluded.updated_at",
        rusqlite::params![student_id, category, name, aff, notes, now],
    )?;
    Ok(db.last_insert_rowid())
}

/// 删除一条兴趣
#[tauri::command]
pub async fn delete_interest(
    id: i64,
    state: State<'_, AppState>,
) -> AppResult<bool> {
    let db = state.db.lock().map_err(|e| AppError::Internal(e.to_string()))?;
    let n = db.execute("DELETE FROM interest_profile WHERE id = ?1", rusqlite::params![id])?;
    Ok(n > 0)
}

/// 从文本中提取兴趣，写库
///
/// 典型用法：开场/收场 check-in 对话后，调用这个命令提取学生说的话。
/// 如果 LLM 不可用，返回空数组不报错。
#[tauri::command]
pub async fn extract_interests_from_text(
    student_id: String,
    text: String,
    state: State<'_, AppState>,
) -> AppResult<serde_json::Value> {
    ensure_student_exists(&state, &student_id)?;

    let llm_clone = {
        let guard = state.llm_client.lock().map_err(|e: std::sync::PoisonError<_>| AppError::Internal(e.to_string()))?;
        guard.clone()
    };
    let llm = match llm_clone {
        Some(c) => c,
        None => return Ok(serde_json::json!({ "extracted": [], "reason": "no_llm" })),
    };

    let prompt = prompts::extract_interests(&text);
    let messages = vec![
        Message {
            role: "system".to_string(),
            content: "你必须严格输出 JSON 数组，除此之外不要任何文字。".to_string(),
        },
        Message { role: "user".to_string(), content: prompt },
    ];
    let opts = LLMOptions {
        temperature: Some(0.3),
        max_tokens: Some(500),
        top_p: Some(0.9),
    };
    let raw = llm.complete(&messages, &opts).await
        .map_err(|e| AppError::LLMError(format!("extract failed: {}", e)))?;

    let parsed = parse_interest_array(&raw).unwrap_or_default();

    // 写库（去重 upsert）
    let now = chrono::Utc::now().to_rfc3339();
    let mut inserted = 0;
    {
        let db = state.db.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        for item in &parsed {
            let category = item.get("category").and_then(|v| v.as_str()).unwrap_or("other");
            let name = item.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let affinity = item.get("affinity").and_then(|v| v.as_f64()).unwrap_or(0.7).clamp(0.0, 1.0);
            let notes = item.get("notes").and_then(|v| v.as_str());
            if name.is_empty() { continue; }
            let r = db.execute(
                "INSERT INTO interest_profile (student_id, category, name, affinity, source, notes, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, 'extracted', ?5, ?6, ?6)
                 ON CONFLICT(student_id, category, name) DO UPDATE SET
                     affinity = MAX(interest_profile.affinity, excluded.affinity),
                     notes = COALESCE(excluded.notes, interest_profile.notes),
                     updated_at = excluded.updated_at",
                rusqlite::params![student_id, category, name, affinity, notes, now],
            );
            if r.is_ok() { inserted += 1; }
        }
    }

    tracing::info!("[interest] 从 {} 字文本提取出 {} 条兴趣，写入 {} 条", text.len(), parsed.len(), inserted);

    Ok(serde_json::json!({
        "extracted": parsed,
        "inserted_count": inserted,
    }))
}

/// 获取 / 更新学生背景（nickname / school / hobby_summary 等）
#[tauri::command]
pub async fn get_student_background(
    student_id: String,
    state: State<'_, AppState>,
) -> AppResult<serde_json::Value> {
    let db = state.db.lock().map_err(|e| AppError::Internal(e.to_string()))?;
    let res = db.query_row(
        "SELECT nickname, school, hobby_summary, family_notes, dream FROM student_background WHERE student_id = ?1",
        rusqlite::params![student_id],
        |row| Ok(serde_json::json!({
            "student_id": student_id,
            "nickname": row.get::<_, Option<String>>(0)?,
            "school": row.get::<_, Option<String>>(1)?,
            "hobby_summary": row.get::<_, Option<String>>(2)?,
            "family_notes": row.get::<_, Option<String>>(3)?,
            "dream": row.get::<_, Option<String>>(4)?,
        })),
    ).unwrap_or_else(|_| serde_json::json!({
        "student_id": student_id,
        "nickname": null, "school": null, "hobby_summary": null,
        "family_notes": null, "dream": null,
    }));
    Ok(res)
}

#[tauri::command]
pub async fn update_student_background(
    student_id: String,
    nickname: Option<String>,
    school: Option<String>,
    hobby_summary: Option<String>,
    family_notes: Option<String>,
    dream: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<()> {
    ensure_student_exists(&state, &student_id)?;
    let db = state.db.lock().map_err(|e| AppError::Internal(e.to_string()))?;
    let now = chrono::Utc::now().to_rfc3339();
    db.execute(
        "INSERT INTO student_background (student_id, nickname, school, hobby_summary, family_notes, dream, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(student_id) DO UPDATE SET
             nickname = COALESCE(excluded.nickname, student_background.nickname),
             school = COALESCE(excluded.school, student_background.school),
             hobby_summary = COALESCE(excluded.hobby_summary, student_background.hobby_summary),
             family_notes = COALESCE(excluded.family_notes, student_background.family_notes),
             dream = COALESCE(excluded.dream, student_background.dream),
             updated_at = excluded.updated_at",
        rusqlite::params![student_id, nickname, school, hobby_summary, family_notes, dream, now],
    )?;
    Ok(())
}

// ============ 工具 ============

fn ensure_student_exists(state: &AppState, student_id: &str) -> AppResult<()> {
    let db = state.db.lock().map_err(|e| AppError::Internal(e.to_string()))?;
    let _ = db.execute(
        "INSERT OR IGNORE INTO students (id, name, grade, created_at, updated_at)
         VALUES (?1, '小明', 6, datetime('now'), datetime('now'))",
        rusqlite::params![student_id],
    );
    Ok(())
}

fn parse_interest_array(raw: &str) -> Option<Vec<serde_json::Value>> {
    let trimmed = raw.trim();
    // 直接 parse
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) {
        if let Some(arr) = v.as_array() { return Some(arr.clone()); }
    }
    // ```json
    if let Some(s) = trimmed.find("```json") {
        let after = &trimmed[s + 7..];
        if let Some(e) = after.find("```") {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(after[..e].trim()) {
                if let Some(arr) = v.as_array() { return Some(arr.clone()); }
            }
        }
    }
    // 取第一个 [...] 块
    if let (Some(s), Some(e)) = (trimmed.find('['), trimmed.rfind(']')) {
        if e > s {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&trimmed[s..=e]) {
                if let Some(arr) = v.as_array() { return Some(arr.clone()); }
            }
        }
    }
    None
}

/// 内部工具：拼接学生兴趣 + 背景为一段 RAG 上下文字符串
/// 供 chat.rs 和 question.rs 调用
pub fn build_interest_context(state: &AppState, student_id: &str) -> String {
    let Ok(db) = state.db.lock() else { return String::new() };
    let mut parts: Vec<String> = Vec::new();

    // 背景
    let bg = db.query_row(
        "SELECT nickname, hobby_summary, family_notes, dream FROM student_background WHERE student_id = ?1",
        rusqlite::params![student_id],
        |row| Ok((
            row.get::<_, Option<String>>(0)?,
            row.get::<_, Option<String>>(1)?,
            row.get::<_, Option<String>>(2)?,
            row.get::<_, Option<String>>(3)?,
        )),
    );
    if let Ok((nick, hobby, family, dream)) = bg {
        let mut bits: Vec<String> = Vec::new();
        if let Some(n) = nick { if !n.is_empty() { bits.push(format!("昵称叫{}", n)); } }
        if let Some(h) = hobby { if !h.is_empty() { bits.push(format!("兴趣：{}", h)); } }
        if let Some(f) = family { if !f.is_empty() { bits.push(format!("家庭：{}", f)); } }
        if let Some(d) = dream { if !d.is_empty() { bits.push(format!("长大想{}", d)); } }
        if !bits.is_empty() {
            parts.push(format!("【学生背景】{}", bits.join("；")));
        }
    }

    // 兴趣
    let mut items: Vec<String> = Vec::new();
    if let Ok(mut stmt) = db.prepare(
        "SELECT category, name, affinity FROM interest_profile
         WHERE student_id = ?1 ORDER BY affinity DESC LIMIT 8"
    ) {
        if let Ok(rows) = stmt.query_map(rusqlite::params![student_id], |row| {
            let cat: String = row.get(0)?;
            let name: String = row.get(1)?;
            let aff: f64 = row.get(2)?;
            Ok(format!("{}（{}, {:.0}%）", name, category_label(&cat), aff * 100.0))
        }) {
            for r in rows.flatten() { items.push(r); }
        }
    }
    if !items.is_empty() {
        parts.push(format!("【学生兴趣 TOP {}】{}", items.len(), items.join("、")));
    }

    parts.join("\n")
}

fn category_label(c: &str) -> &'static str {
    match c {
        "hobby" => "爱好",
        "book" => "读过的书",
        "movie" => "看过的片",
        "music" => "听过的歌",
        "sport" => "运动",
        "food" => "喜欢吃",
        "family" => "家人",
        _ => "其他",
    }
}
