"""迁移运行器

扫描 migrations_dir 下的 *.sql 文件，按文件名排序依次应用。
用 `schema_migrations` 表记录已应用的迁移，避免重复。

直接复用 src-tauri/migrations/ 里的 SQL 文件，server 启动时指向那里即可。
"""
import logging
from pathlib import Path

import aiosqlite

from ..config import get_settings
from .connection import get_db_path

logger = logging.getLogger(__name__)


async def _ensure_migration_table(db: aiosqlite.Connection) -> None:
    await db.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_migrations (
            filename TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
        """
    )
    await db.commit()


async def _applied_set(db: aiosqlite.Connection) -> set[str]:
    async with db.execute("SELECT filename FROM schema_migrations") as cur:
        rows = await cur.fetchall()
    return {r[0] for r in rows}


def _discover_migrations() -> list[Path]:
    settings = get_settings()
    root = Path(settings.migrations_dir).resolve()
    if not root.exists():
        logger.warning(f"迁移目录不存在: {root}")
        return []
    files = sorted([p for p in root.glob("*.sql") if p.is_file()])
    return files


async def run_migrations() -> None:
    """启动时调用一次。幂等。"""
    path = get_db_path()
    files = _discover_migrations()
    logger.info(f"发现 {len(files)} 个迁移文件，DB={path}")

    async with aiosqlite.connect(str(path)) as db:
        await _ensure_migration_table(db)
        applied = await _applied_set(db)

        for f in files:
            if f.name in applied:
                logger.debug(f"跳过已应用: {f.name}")
                continue
            logger.info(f"应用迁移: {f.name}")
            sql = f.read_text(encoding="utf-8")
            # aiosqlite 的 executescript 会自动开事务
            await db.executescript(sql)
            await db.execute(
                "INSERT INTO schema_migrations (filename) VALUES (?)", (f.name,)
            )
            await db.commit()

    logger.info("迁移完成")
