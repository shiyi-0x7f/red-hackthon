use tauri::State;
use crate::state::AppState;
use crate::error::AppResult;

/// 创建学生
#[tauri::command]
pub async fn create_student(
    name: String,
    grade: i32,
    state: State<'_, AppState>,
) -> AppResult<serde_json::Value> {
    let id = uuid::Uuid::new_v4().to_string();
    let db = state.db.lock().map_err(|e| crate::error::AppError::Internal(e.to_string()))?;

    db.execute(
        "INSERT INTO students (id, name, grade, created_at) VALUES (?1, ?2, ?3, datetime('now'))",
        rusqlite::params![id, name, grade],
    )?;

    tracing::info!("创建学生: {} ({}年级)", name, grade);

    Ok(serde_json::json!({
        "id": id,
        "name": name,
        "grade": grade
    }))
}

/// 获取学生信息
#[tauri::command]
pub async fn get_student(
    student_id: String,
    state: State<'_, AppState>,
) -> AppResult<serde_json::Value> {
    let db = state.db.lock().map_err(|e| crate::error::AppError::Internal(e.to_string()))?;

    let mut stmt = db.prepare(
        "SELECT id, name, grade, created_at FROM students WHERE id = ?1"
    )?;

    let result = stmt.query_row(rusqlite::params![student_id], |row| {
        Ok(serde_json::json!({
            "id": row.get::<_, String>(0)?,
            "name": row.get::<_, String>(1)?,
            "grade": row.get::<_, i32>(2)?,
            "created_at": row.get::<_, String>(3)?
        }))
    }).map_err(|_| crate::error::AppError::NotFound(format!("学生 {} 不存在", student_id)))?;

    Ok(result)
}

/// 获取学生列表
#[tauri::command]
pub async fn list_students(
    state: State<'_, AppState>,
) -> AppResult<Vec<serde_json::Value>> {
    let db = state.db.lock().map_err(|e| crate::error::AppError::Internal(e.to_string()))?;

    let mut stmt = db.prepare(
        "SELECT id, name, grade, created_at FROM students ORDER BY created_at DESC"
    )?;

    let students = stmt.query_map([], |row| {
        Ok(serde_json::json!({
            "id": row.get::<_, String>(0)?,
            "name": row.get::<_, String>(1)?,
            "grade": row.get::<_, i32>(2)?,
            "created_at": row.get::<_, String>(3)?
        }))
    })?.filter_map(|r| r.ok()).collect();

    Ok(students)
}
