"""家长端路由 - 密码 + 学习概览"""
import aiosqlite
import bcrypt
from fastapi import APIRouter, Depends

from ..config import Settings, get_settings
from ..db.connection import get_db
from ..schemas.common import ok
from ..schemas.decision import ParentLoginRequest
from ._deps import require_api_key

router = APIRouter(dependencies=[Depends(require_api_key)])


async def _get_or_init_password(
    db: aiosqlite.Connection, default_password: str
) -> bytes:
    async with db.execute(
        "SELECT value FROM app_settings WHERE key = 'parent_password_hash'"
    ) as cur:
        row = await cur.fetchone()
    if row:
        return row["value"].encode("utf-8")

    # 首次启动，用默认密码初始化
    hashed = bcrypt.hashpw(default_password.encode("utf-8"), bcrypt.gensalt())
    await db.execute(
        "INSERT INTO app_settings (key, value) VALUES ('parent_password_hash', ?)",
        (hashed.decode("utf-8"),),
    )
    await db.commit()
    return hashed


@router.post("/parent/login")
async def verify_parent_password(
    payload: ParentLoginRequest,
    db: aiosqlite.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    stored = await _get_or_init_password(db, settings.default_parent_password)
    try:
        ok_match = bcrypt.checkpw(payload.password.encode("utf-8"), stored)
    except ValueError:
        ok_match = False
    return ok({"ok": ok_match})


@router.get("/parent/students/{student_id}/overview")
async def get_learning_overview(
    student_id: str,
    range: str = "week",
    db: aiosqlite.Connection = Depends(get_db),
):
    # 汇总答题 / 正确率 / 会话数
    if range == "week":
        clause = "AND ar.created_at >= datetime('now', '-7 days')"
    elif range == "month":
        clause = "AND ar.created_at >= datetime('now', '-30 days')"
    else:
        clause = ""

    async with db.execute(
        f"""
        SELECT COUNT(*) AS total,
               COALESCE(SUM(is_correct), 0) AS correct
        FROM answer_records ar
        WHERE ar.student_id = ? {clause}
        """,
        (student_id,),
    ) as cur:
        row = await cur.fetchone()

    total = int(row["total"] or 0)
    correct = int(row["correct"] or 0)
    accuracy = correct / total if total else 0

    async with db.execute(
        """
        SELECT COUNT(*) AS sessions,
               COALESCE(SUM(total_duration_secs), 0) AS total_secs
        FROM learning_sessions
        WHERE student_id = ?
        """,
        (student_id,),
    ) as cur:
        srow = await cur.fetchone()

    return ok(
        {
            "student_id": student_id,
            "range": range,
            "total_sessions": int(srow["sessions"] or 0),
            "total_questions": total,
            "overall_accuracy": accuracy,
            "avg_daily_duration_minutes": float(srow["total_secs"] or 0) / 60 / 7
            if range == "week"
            else 0.0,
            "mastery_snapshot": [],
            "recent_trends": [],
        }
    )
