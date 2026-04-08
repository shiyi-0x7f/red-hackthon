use tauri::State;
use crate::state::AppState;
use crate::error::{AppError, AppResult};
use crate::ai::llm_client::LLMClient;

/// 保存 API Key 到数据库并重新初始化 LLM 客户端
#[tauri::command]
pub async fn save_api_key(
    api_key: String,
    model: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<serde_json::Value> {
    tracing::info!("保存 API Key (长度: {})", api_key.len());

    // 保存到数据库
    {
        let db = state.db.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        db.execute(
            "INSERT INTO app_settings (key, value, updated_at) VALUES ('api_key', ?1, datetime('now'))
             ON CONFLICT(key) DO UPDATE SET value = ?1, updated_at = datetime('now')",
            rusqlite::params![api_key],
        )?;

        if let Some(ref m) = model {
            db.execute(
                "INSERT INTO app_settings (key, value, updated_at) VALUES ('llm_model', ?1, datetime('now'))
                 ON CONFLICT(key) DO UPDATE SET value = ?1, updated_at = datetime('now')",
                rusqlite::params![m],
            )?;
        }
    }

    // 重新初始化 LLM 客户端
    let model_id = model.unwrap_or_else(|| "deepseek-ai/DeepSeek-V3".to_string());

    if !api_key.is_empty() {
        let new_client = LLMClient::new(
            "https://api.siliconflow.cn/v1",
            &api_key,
            &model_id,
        );
        let mut guard = state.llm_client.lock().map_err(|e: std::sync::PoisonError<_>| AppError::Internal(e.to_string()))?;
        *guard = Some(new_client);
        tracing::info!("LLM 客户端已重新初始化，模型: {}", model_id);

        Ok(serde_json::json!({
            "success": true,
            "message": "API Key 已保存，对话功能已启用",
            "model": model_id,
        }))
    } else {
        let mut guard = state.llm_client.lock().map_err(|e: std::sync::PoisonError<_>| AppError::Internal(e.to_string()))?;
        *guard = None;

        Ok(serde_json::json!({
            "success": true,
            "message": "API Key 已清除，对话功能使用预设回复",
        }))
    }
}

/// 获取当前设置
#[tauri::command]
pub async fn get_settings(
    state: State<'_, AppState>,
) -> AppResult<serde_json::Value> {
    let db = state.db.lock().map_err(|e| AppError::Internal(e.to_string()))?;

    let api_key_masked: Option<String> = db.query_row(
        "SELECT value FROM app_settings WHERE key = 'api_key'",
        [],
        |row| row.get::<_, String>(0),
    ).ok().map(|key| {
        if key.len() > 6 {
            format!("{}••••{}", &key[..3], &key[key.len()-4..])
        } else {
            "••••••".to_string()
        }
    });

    let model: Option<String> = db.query_row(
        "SELECT value FROM app_settings WHERE key = 'llm_model'",
        [],
        |row| row.get(0),
    ).ok();

    let has_llm = state.llm_client.lock()
        .map(|g| g.is_some())
        .unwrap_or(false);

    Ok(serde_json::json!({
        "api_key_masked": api_key_masked,
        "model": model.unwrap_or_else(|| "deepseek-ai/DeepSeek-V3".to_string()),
        "llm_available": has_llm,
    }))
}
