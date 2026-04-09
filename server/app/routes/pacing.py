"""节奏控制路由"""
import aiosqlite
from fastapi import APIRouter, Depends, HTTPException

from ..db.connection import get_db
from ..schemas.common import ok
from ..services.pacing_engine import evaluate
from ._deps import require_api_key

router = APIRouter(dependencies=[Depends(require_api_key)])


@router.get("/sessions/{session_id}/pacing")
async def pacing_status(
    session_id: str, db: aiosqlite.Connection = Depends(get_db)
):
    async with db.execute(
        """
        SELECT
          CAST((julianday('now') - julianday(started_at)) * 24 * 60 AS INTEGER) AS mins
        FROM learning_sessions WHERE id = ?
        """,
        (session_id,),
    ) as cur:
        row = await cur.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="会话不存在")

    elapsed = int(row["mins"] or 0)
    result = evaluate(elapsed_minutes=elapsed, max_session_minutes=30)
    return ok(
        {
            "phase": result.phase.value,
            "elapsed_minutes": result.elapsed_minutes,
            "remaining_minutes": result.remaining_minutes,
            "max_session_minutes": result.max_session_minutes,
            "message": result.message,
        }
    )
