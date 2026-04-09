"""学生模型查询路由 - profile / state / wrong / review / realtime"""
import aiosqlite
from fastapi import APIRouter, Depends, HTTPException

from ..db.connection import get_db, row_to_dict, rows_to_list
from ..schemas.common import ok
from ..services.student_model import forgetting_risk
from ._deps import require_api_key

router = APIRouter(dependencies=[Depends(require_api_key)])


@router.get("/students/{student_id}/profile")
async def get_profile(student_id: str, db: aiosqlite.Connection = Depends(get_db)):
    async with db.execute(
        "SELECT * FROM students WHERE id = ?", (student_id,)
    ) as cur:
        srow = await cur.fetchone()
    if srow is None:
        raise HTTPException(status_code=404, detail="学生不存在")

    async with db.execute(
        """
        SELECT km.*, k.name AS knowledge_name
        FROM knowledge_mastery km
        JOIN knowledge_nodes k ON k.id = km.knowledge_id
        WHERE km.student_id = ?
        ORDER BY km.mastery_score DESC
        """,
        (student_id,),
    ) as cur:
        mastery_rows = await cur.fetchall()

    async with db.execute(
        """
        SELECT COUNT(*) AS total,
               SUM(is_correct) AS correct
        FROM answer_records WHERE student_id = ?
        """,
        (student_id,),
    ) as cur:
        agg = await cur.fetchone()
    total = int(agg["total"] or 0)
    correct = int(agg["correct"] or 0)
    accuracy = (correct / total) if total else 0

    return ok(
        {
            "student_id": student_id,
            "name": srow["name"],
            "grade": srow["grade"],
            "total_questions_answered": total,
            "overall_accuracy": accuracy,
            "mastery_items": rows_to_list(mastery_rows),
        }
    )


@router.get("/students/{student_id}/state")
async def get_state(student_id: str, db: aiosqlite.Connection = Depends(get_db)):
    async with db.execute(
        "SELECT * FROM student_states WHERE student_id = ?", (student_id,)
    ) as cur:
        row = await cur.fetchone()
    if row is None:
        return ok(
            {
                "student_id": student_id,
                "fatigue": 0.0,
                "frustration": 0.0,
                "consecutive_errors": 0,
                "current_session_id": None,
                "session_elapsed_minutes": 0,
            }
        )
    return ok(row_to_dict(row))


@router.get("/students/{student_id}/wrong-answers")
async def get_wrong_answers(
    student_id: str,
    limit: int = 50,
    db: aiosqlite.Connection = Depends(get_db),
):
    async with db.execute(
        """
        SELECT ar.*, q.content AS question_content, q.answer AS correct_answer,
               q.knowledge_id, k.name AS knowledge_name
        FROM answer_records ar
        LEFT JOIN questions q ON q.id = ar.question_id
        LEFT JOIN knowledge_nodes k ON k.id = q.knowledge_id
        WHERE ar.student_id = ? AND ar.is_correct = 0
        ORDER BY ar.created_at DESC
        LIMIT ?
        """,
        (student_id, limit),
    ) as cur:
        rows = await cur.fetchall()
    return ok(rows_to_list(rows))


@router.get("/students/{student_id}/overview")
async def get_profile_overview(
    student_id: str, db: aiosqlite.Connection = Depends(get_db)
):
    async with db.execute(
        """
        SELECT stat_date, session_count, question_count, correct_count,
               total_duration_secs
        FROM daily_stats
        WHERE student_id = ?
        ORDER BY stat_date DESC
        LIMIT 7
        """,
        (student_id,),
    ) as cur:
        rows = await cur.fetchall()
    return ok({"recent_7_days": rows_to_list(rows)})


@router.get("/students/{student_id}/review")
async def get_review_recs(
    student_id: str, db: aiosqlite.Connection = Depends(get_db)
):
    """艾宾浩斯驱动的复习推荐

    用 SQLite `julianday('now') - julianday(last_practiced_at)` 算真实的小时差。
    对每个已练习过的知识点计算遗忘风险，再按 risk*(1-mastery) 打分排序。
    """
    async with db.execute(
        """
        SELECT
            km.knowledge_id,
            k.name AS knowledge_name,
            km.mastery_score,
            km.last_practiced_at,
            km.attempt_count,
            km.correct_count,
            CAST(
                (julianday('now') - julianday(km.last_practiced_at)) * 24.0 AS REAL
            ) AS hours_since_last
        FROM knowledge_mastery km
        JOIN knowledge_nodes k ON k.id = km.knowledge_id
        WHERE km.student_id = ?
          AND km.attempt_count > 0
          AND km.last_practiced_at IS NOT NULL
        """,
        (student_id,),
    ) as cur:
        rows = await cur.fetchall()

    recommendations = []
    for r in rows:
        raw_hours = r["hours_since_last"]
        # julianday 解析失败或记录为未来时间 → 兜底为 0
        hours_since = max(0.0, float(raw_hours)) if raw_hours is not None else 0.0
        mastery = float(r["mastery_score"])
        risk = forgetting_risk(mastery, hours_since)
        # 优先级：既遗忘又没学好的知识点优先复习
        priority = risk * (1.0 - mastery)

        if risk > 0.7:
            reason = "遗忘风险很高，建议优先复习"
        elif risk > 0.5:
            reason = "遗忘风险较高"
        elif mastery < 0.4:
            reason = "掌握度偏低，多练几遍"
        else:
            reason = "常规复习"

        recommendations.append(
            {
                "knowledge_id": r["knowledge_id"],
                "knowledge_name": r["knowledge_name"],
                "mastery_score": mastery,
                "forgetting_risk": risk,
                "attempt_count": int(r["attempt_count"] or 0),
                "correct_count": int(r["correct_count"] or 0),
                "last_practiced_hours_ago": hours_since,
                "priority_score": priority,
                "reason": reason,
            }
        )
    recommendations.sort(key=lambda x: x["priority_score"], reverse=True)
    return ok(recommendations[:10])


@router.get("/students/{student_id}/realtime")
async def get_realtime(student_id: str, db: aiosqlite.Connection = Depends(get_db)):
    """聚合 6 层实时画像（简化版）"""
    profile = await get_profile(student_id, db)
    state = await get_state(student_id, db)
    return ok(
        {
            "profile": profile["data"],
            "state": state["data"],
        }
    )
