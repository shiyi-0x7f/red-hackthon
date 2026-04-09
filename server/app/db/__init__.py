"""数据库层

采用 aiosqlite + 原生 SQL 的轻量方案，不使用 ORM。迁移文件直接复用
src-tauri/migrations/*.sql，所以 Tauri 和 server 两侧 schema 完全一致。
"""
