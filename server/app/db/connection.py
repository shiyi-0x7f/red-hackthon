"""数据库连接管理

单文件 SQLite，用 aiosqlite 做异步访问。
- 应用启动时执行一次迁移
- 每个请求从 `get_db()` 依赖注入拿连接
- 查询结果用 Row 对象（类似 dict）
"""
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import aiosqlite

from ..config import get_settings

_db_path: Path | None = None


def init_db_path() -> Path:
    """初始化数据库文件路径，确保父目录存在"""
    global _db_path
    settings = get_settings()
    path = settings.db_path
    path.parent.mkdir(parents=True, exist_ok=True)
    _db_path = path
    return path


def get_db_path() -> Path:
    if _db_path is None:
        return init_db_path()
    return _db_path


@asynccontextmanager
async def db_conn() -> AsyncIterator[aiosqlite.Connection]:
    """上下文管理器 — 返回打开的 aiosqlite 连接。

    用法：
        async with db_conn() as db:
            async with db.execute("SELECT ...") as cur:
                row = await cur.fetchone()
    """
    path = get_db_path()
    conn = await aiosqlite.connect(str(path))
    conn.row_factory = aiosqlite.Row
    try:
        await conn.execute("PRAGMA foreign_keys = ON")
        yield conn
    finally:
        await conn.close()


async def get_db() -> AsyncIterator[aiosqlite.Connection]:
    """FastAPI 依赖：产生一个数据库连接。

    用法：
        @router.get("/foo")
        async def foo(db: aiosqlite.Connection = Depends(get_db)):
            ...
    """
    async with db_conn() as conn:
        yield conn


def row_to_dict(row: aiosqlite.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    return {k: row[k] for k in row.keys()}


def rows_to_list(rows: list[aiosqlite.Row]) -> list[dict[str, Any]]:
    return [{k: r[k] for k in r.keys()} for r in rows]
