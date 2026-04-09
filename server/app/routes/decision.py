"""决策路由 - 调 decision_engine"""
import aiosqlite
from fastapi import APIRouter, Depends

from ..db.connection import get_db
from ..schemas.common import ok
from ..schemas.decision import NextActionRequest
from ..services.decision_engine import MasteryInfo, decide
from ..services.student_model import forgetting_risk
from ._deps import require_api_key

router = APIRouter(dependencies=[Depends(require_api_key)])


@router.post("/decision/next")
async def next_action(
    payload: NextActionRequest, db: aiosqlite.Connection = Depends(get_db)
):
    # 读学生当前状态
    async with db.execute(
        "SELECT * FROM student_states WHERE student_id = ?",
        (payload.student_id,),
    ) as cur:
        state_row = await cur.fetchone()

    fatigue = float(state_row["fatigue"]) if state_row else 0.0
    frustration = float(state_row["frustration"]) if state_row else 0.0
    consecutive_errors = int(state_row["consecutive_errors"]) if state_row else 0

    # 会话时长
    session_minutes = 0
    if payload.session_id:
        async with db.execute(
            """
            SELECT
              CAST((julianday('now') - julianday(started_at)) * 24 * 60 AS INTEGER) AS mins
            FROM learning_sessions WHERE id = ?
            """,
            (payload.session_id,),
        ) as cur:
            row = await cur.fetchone()
            if row:
                session_minutes = int(row["mins"] or 0)

    # 读掌握度
    async with db.execute(
        """
        SELECT km.knowledge_id, k.name, km.mastery_score,
               CAST((julianday('now') - julianday(COALESCE(km.last_practiced_at, 'now'))) * 24 AS REAL) AS hours_ago
        FROM knowledge_mastery km
        JOIN knowledge_nodes k ON k.id = km.knowledge_id
        WHERE km.student_id = ?
        """,
        (payload.student_id,),
    ) as cur:
        rows = await cur.fetchall()

    mastery = [
        MasteryInfo(
            knowledge_id=r["knowledge_id"],
            name=r["name"],
            mastery_score=float(r["mastery_score"]),
            forgetting_risk=forgetting_risk(
                float(r["mastery_score"]), float(r["hours_ago"] or 0)
            ),
            last_practiced_hours_ago=float(r["hours_ago"] or 0),
        )
        for r in rows
    ]

    result = decide(
        fatigue=fatigue,
        frustration=frustration,
        consecutive_errors=consecutive_errors,
        session_minutes=session_minutes,
        max_session_minutes=30,
        mastery_data=mastery,
    )
    return ok(
        {
            "action": result.action,
            "reasoning": result.reasoning,
            "params": result.params,
        }
    )
