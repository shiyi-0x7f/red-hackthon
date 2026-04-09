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
        # 新用户可能还没被 ensureStudentExists 创建，自动创建兜底
        await db.execute(
            "INSERT OR IGNORE INTO students (id, name, grade) VALUES (?, ?, 6)",
            (student_id, f"同学{student_id[-4:]}"),
        )
        await db.commit()
        async with db.execute(
            "SELECT * FROM students WHERE id = ?", (student_id,)
        ) as cur2:
            srow = await cur2.fetchone()

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
        SELECT ar.id AS record_id,
               ar.question_id,
               ar.student_answer,
               ar.error_type,
               ar.created_at,
               q.content       AS content_latex,
               q.answer        AS answer_latex,
               q.question_type AS question_type,
               k.name          AS unit
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
    """返回前端 ProfileOverview 结构：聚合统计 + 每日明细 + 掌握度数据"""
    # 1) 聚合：总答题数、正确数、正确率
    async with db.execute(
        "SELECT COUNT(*) AS total, SUM(is_correct) AS correct FROM answer_records WHERE student_id = ?",
        (student_id,),
    ) as cur:
        agg = await cur.fetchone()
    total_questions = int(agg["total"] or 0)
    correct_count = int(agg["correct"] or 0)
    accuracy = (correct_count / total_questions) if total_questions else 0.0

    # 2) 学习天数 + 总时长 — 优先从 daily_stats，若无记录则从 answer_records / sessions 推算
    async with db.execute(
        """
        SELECT COUNT(DISTINCT stat_date) AS learning_days,
               COALESCE(SUM(total_duration_secs), 0) AS total_secs
        FROM daily_stats WHERE student_id = ?
        """,
        (student_id,),
    ) as cur:
        ds = await cur.fetchone()
    learning_days = int(ds["learning_days"] or 0)
    total_duration_minutes = int((ds["total_secs"] or 0) / 60)

    # 若 daily_stats 为空，从 answer_records 推算学习天数
    if learning_days == 0 and total_questions > 0:
        async with db.execute(
            "SELECT COUNT(DISTINCT DATE(created_at)) AS days FROM answer_records WHERE student_id = ?",
            (student_id,),
        ) as cur:
            row = await cur.fetchone()
            learning_days = int(row["days"] or 0)

    # 若 total_duration 为空，从 learning_sessions 推算总时长
    if total_duration_minutes == 0:
        async with db.execute(
            """
            SELECT COALESCE(SUM(total_duration_secs), 0) AS total_secs
            FROM learning_sessions WHERE student_id = ?
            """,
            (student_id,),
        ) as cur:
            sess_dur = await cur.fetchone()
            total_duration_minutes = int((sess_dur["total_secs"] or 0) / 60)

    # 若仍为 0，从 answer_records 的 time_spent_secs 推算
    if total_duration_minutes == 0 and total_questions > 0:
        async with db.execute(
            "SELECT COALESCE(SUM(time_spent_secs), 0) AS total_secs FROM answer_records WHERE student_id = ?",
            (student_id,),
        ) as cur:
            ar_dur = await cur.fetchone()
            total_duration_minutes = int((ar_dur["total_secs"] or 0) / 60)

    # 3) 近 7 天每日明细 — 优先 daily_stats，若无则从 answer_records 推算
    async with db.execute(
        """
        SELECT stat_date            AS date,
               CAST(total_duration_secs / 60.0 AS INTEGER) AS duration_minutes,
               question_count,
               correct_count
        FROM daily_stats
        WHERE student_id = ?
        ORDER BY stat_date DESC
        LIMIT 7
        """,
        (student_id,),
    ) as cur:
        daily_rows = await cur.fetchall()

    # 若 daily_stats 无数据，从 answer_records 聚合每日答题情况
    if len(daily_rows) == 0 and total_questions > 0:
        async with db.execute(
            """
            SELECT DATE(created_at) AS date,
                   CAST(COALESCE(SUM(time_spent_secs), 0) / 60.0 AS INTEGER) AS duration_minutes,
                   COUNT(*) AS question_count,
                   SUM(is_correct) AS correct_count
            FROM answer_records
            WHERE student_id = ?
            GROUP BY DATE(created_at)
            ORDER BY date DESC
            LIMIT 7
            """,
            (student_id,),
        ) as cur:
            daily_rows = await cur.fetchall()

    # 4) 知识掌握度
    async with db.execute(
        """
        SELECT km.knowledge_id,
               k.name,
               km.mastery_score,
               km.attempt_count,
               km.last_practiced_at
        FROM knowledge_mastery km
        JOIN knowledge_nodes k ON k.id = km.knowledge_id
        WHERE km.student_id = ?
        ORDER BY km.mastery_score ASC
        """,
        (student_id,),
    ) as cur:
        mastery_rows = await cur.fetchall()

    mastery_data = []
    for m in mastery_rows:
        mastery_score = float(m["mastery_score"] or 0)
        # 简单估算遗忘风险
        hours = 0.0
        if m["last_practiced_at"]:
            try:
                async with db.execute(
                    "SELECT (julianday('now') - julianday(?)) * 24.0 AS h",
                    (m["last_practiced_at"],),
                ) as hcur:
                    hrow = await hcur.fetchone()
                    hours = max(0.0, float(hrow["h"] or 0))
            except Exception:
                pass
        risk = forgetting_risk(mastery_score, hours)
        mastery_data.append({
            "knowledge_id": m["knowledge_id"],
            "name": m["name"],
            "mastery_score": mastery_score,
            "attempt_count": int(m["attempt_count"] or 0),
            "forgetting_risk": risk,
        })

    return ok({
        "student_id": student_id,
        "total_questions": total_questions,
        "correct_count": correct_count,
        "accuracy": accuracy,
        "total_duration_minutes": total_duration_minutes,
        "learning_days": learning_days,
        "daily_stats": rows_to_list(daily_rows),
        "mastery_data": mastery_data,
    })


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

        # 艾宾浩斯理想间隔（小时）：基于掌握度估算
        # mastery 0.3 → ~2h, 0.5 → ~12h, 0.7 → ~48h, 0.9 → ~168h
        ideal_interval = max(1.0, (mastery ** 2) * 200.0)
        overdue_ratio = hours_since / ideal_interval if ideal_interval > 0 else 1.0

        recommendations.append(
            {
                "knowledge_id": r["knowledge_id"],
                "name": r["knowledge_name"],
                "mastery_score": mastery,
                "forgetting_risk": risk,
                "attempt_count": int(r["attempt_count"] or 0),
                "hours_since_last": hours_since,
                "ideal_interval_hours": round(ideal_interval, 1),
                "overdue_ratio": round(overdue_ratio, 2),
                "priority_score": round(priority, 4),
            }
        )
    recommendations.sort(key=lambda x: x["priority_score"], reverse=True)
    return ok(recommendations[:10])


@router.get("/students/{student_id}/realtime")
async def get_realtime(student_id: str, db: aiosqlite.Connection = Depends(get_db)):
    """聚合实时画像 — 返回前端 RealtimeProfile 的 4 层结构"""

    # ── knowledge_layer ──
    async with db.execute(
        """
        SELECT km.mastery_score, km.attempt_count, km.last_practiced_at,
               k.name
        FROM knowledge_mastery km
        JOIN knowledge_nodes k ON k.id = km.knowledge_id
        WHERE km.student_id = ?
        """,
        (student_id,),
    ) as cur:
        km_rows = await cur.fetchall()

    topic_count = len(km_rows)
    avg_mastery = (
        sum(float(r["mastery_score"] or 0) for r in km_rows) / topic_count
        if topic_count else 0.0
    )
    # 薄弱点：掌握度 < 0.6，按掌握度升序取前 5
    weak_topics = []
    for r in sorted(km_rows, key=lambda x: float(x["mastery_score"] or 0)):
        m = float(r["mastery_score"] or 0)
        if m >= 0.6:
            break
        hours = 0.0
        if r["last_practiced_at"]:
            try:
                async with db.execute(
                    "SELECT (julianday('now') - julianday(?)) * 24.0 AS h",
                    (r["last_practiced_at"],),
                ) as hcur:
                    hrow = await hcur.fetchone()
                    hours = max(0.0, float(hrow["h"] or 0))
            except Exception:
                pass
        weak_topics.append({
            "name": r["name"],
            "mastery": m,
            "forgetting_risk": forgetting_risk(m, hours),
            "attempts": int(r["attempt_count"] or 0),
        })
        if len(weak_topics) >= 5:
            break

    # ── behavior_layer ──
    async with db.execute(
        """
        SELECT COUNT(*)            AS sample_count,
               AVG(time_spent_secs) AS avg_response_time,
               AVG(is_correct)      AS accuracy_rate,
               AVG(CASE WHEN hint_used > 0 THEN 1.0 ELSE 0.0 END) AS hint_usage_rate,
               0 AS max_consecutive_errors
        FROM answer_records
        WHERE student_id = ?
        """,
        (student_id,),
    ) as cur:
        brow = await cur.fetchone()

    behavior = {
        "avg_response_time": float(brow["avg_response_time"] or 0),
        "accuracy_rate": float(brow["accuracy_rate"] or 0),
        "hint_usage_rate": float(brow["hint_usage_rate"] or 0),
        "impulsivity": 0.0,
        "hint_dependency": 0.0,
        "max_consecutive_errors": int(brow["max_consecutive_errors"] or 0),
        "sample_count": int(brow["sample_count"] or 0),
    }

    # ── state_layer ──
    async with db.execute(
        "SELECT * FROM student_states WHERE student_id = ?", (student_id,)
    ) as cur:
        srow = await cur.fetchone()

    state = {
        "fatigue": float(srow["fatigue_level"] if srow else 0),
        "attention": float(srow["attention_level"] if srow else 1.0),
        "frustration": float(srow["frustration"] if srow else 0),
        "cognitive_load": float(srow["cognitive_load"] if srow else 0.5),
        "consecutive_errors": int(srow["consecutive_errors"] if srow else 0),
    }

    # ── session_layer ──
    async with db.execute(
        """
        SELECT id, total_questions, correct_count, total_duration_secs, ended_at
        FROM learning_sessions
        WHERE student_id = ?
        ORDER BY started_at DESC
        LIMIT 1
        """,
        (student_id,),
    ) as cur:
        sess = await cur.fetchone()

    session = {
        "active": bool(sess and sess["ended_at"] is None),
        "duration_secs": int(sess["total_duration_secs"] or 0) if sess else 0,
        "total_questions": int(sess["total_questions"] or 0) if sess else 0,
        "correct_count": int(sess["correct_count"] or 0) if sess else 0,
    }

    return ok({
        "student_id": student_id,
        "knowledge_layer": {
            "avg_mastery": round(avg_mastery, 3),
            "topic_count": topic_count,
            "weak_topics": weak_topics,
        },
        "behavior_layer": behavior,
        "state_layer": state,
        "session_layer": session,
    })
