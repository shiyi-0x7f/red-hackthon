use rusqlite::Connection;

/// 数据库连接辅助工具

/// 检查数据库连接是否正常
pub fn check_connection(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch("SELECT 1")?;
    Ok(())
}

/// 获取数据库版本
pub fn get_db_version(conn: &Connection) -> Result<i32, rusqlite::Error> {
    conn.query_row("PRAGMA user_version", [], |row| row.get(0))
}

/// 设置数据库版本
pub fn set_db_version(conn: &Connection, version: i32) -> Result<(), rusqlite::Error> {
    conn.execute_batch(&format!("PRAGMA user_version = {}", version))?;
    Ok(())
}
