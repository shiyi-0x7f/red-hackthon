use rusqlite::Connection;
use crate::db::connection;

/// 所有迁移
const MIGRATIONS: &[(&str, &str)] = &[
    ("001_init", include_str!("../../migrations/001_init.sql")),
    ("002_p0_features", include_str!("../../migrations/002_p0_features.sql")),
];

/// 运行所有待执行的迁移
pub fn run_all(conn: &Connection) -> Result<(), Box<dyn std::error::Error>> {
    let current_version = connection::get_db_version(conn)?;
    let total = MIGRATIONS.len() as i32;

    if current_version >= total {
        tracing::debug!("数据库已是最新版本 (v{})", current_version);
        return Ok(());
    }

    for (i, (name, sql)) in MIGRATIONS.iter().enumerate() {
        let version = (i + 1) as i32;
        if version <= current_version {
            continue;
        }

        tracing::info!("执行迁移: {} (v{})", name, version);
        conn.execute_batch(sql)?;
        connection::set_db_version(conn, version)?;
    }

    tracing::info!("数据库迁移完成，当前版本: v{}", total);
    Ok(())
}
