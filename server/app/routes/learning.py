"""学习会话路由 - start / submit / end / summary"""
import json
import logging
import uuid
from datetime import datetime
from functools import lru_cache
from typing import Any

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException

from ..ai.llm_client import LLMOptions, Message, get_llm_client
from ..ai.prompts import evaluate_answer, session_summary
from ..ai.safety import sanitize_output
from ..config import Settings, get_settings
from ..db.connection import get_db, row_to_dict
from ..schemas.common import ok
from ..schemas.question import EvaluationResult, SubmitAnswerRequest
from ..schemas.session import SessionEnd, SessionStart
from ..services.question_bank import BaseQuestion, QuestionBank
from ..services.student_model import bkt_update_weighted
from ._deps import require_api_key


@lru_cache(maxsize=2)
def _bank_from_path(path: str) -> QuestionBank:
    return QuestionBank.from_file(path)


def _synth_knowledge_id(name: str) -> str:
    """从一个名称生成稳定的 knowledge_id

    命名规则：`kn-{name replace space with _}`，清掉可能引起 SQL / URL 问题的字符。
    输入可以是单元名也可以是具体知识点名。
    """
    return "kn-" + (name or "unknown").replace(" ", "_").replace("/", "_")


async def _ensure_knowledge_and_question(
    db: aiosqlite.Connection,
    question_id: str,
    q: BaseQuestion,
) -> str:
    """Lazy upsert knowledge_nodes + questions (FK 前置条件)

    粒度：
    - 如果题目带 knowledge_point 字段（前几个单元有），按知识点粒度建 knowledge_node
    - 否则退化为单元粒度

    这对前端 Learn 页的知识地图很关键：Learn 页按知识点名查 mastery，如果 server
    只建单元粒度的 knowledge_node，Learn 页永远查不到，星星永远不点亮。

    返回同步后的 knowledge_id（用于后续 BKT 更新）。
    """
    # 优先用知识点名，没有就用单元名
    node_name = q.knowledge_point or q.unit
    knowledge_id = _synth_knowledge_id(node_name)
    source = "ai" if question_id.startswith("ai-") else "bank"

    # knowledge_nodes 的 unit 字段是 INTEGER，用 0 占位
    await db.execute(
        """
        INSERT OR IGNORE INTO knowledge_nodes
          (id, name, grade, semester, unit, sort_order)
        VALUES (?, ?, 6, 1, 0, 0)
        """,
        (knowledge_id, node_name),
    )
    await db.execute(
        """
        INSERT OR IGNORE INTO questions
          (id, knowledge_id, question_type, difficulty, content, answer, source)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            question_id,
            knowledge_id,
            q.question_type,
            q.difficulty,
            q.content_latex,
            q.answer_latex,
            source,
        ),
    )
    return knowledge_id

logger = logging.getLogger(__name__)
router = APIRouter(dependencies=[Depends(require_api_key)])


@router.post("/sessions")
async def start_session(
    payload: SessionStart, db: aiosqlite.Connection = Depends(get_db)
):
    # 确保学生存在（不存在则自动创建，避免前端 ensureStudentExists 还没完成的竞态）
    async with db.execute(
        "SELECT id FROM students WHERE id = ?", (payload.student_id,)
    ) as cur:
        if await cur.fetchone() is None:
            await db.execute(
                """
                INSERT OR IGNORE INTO students (id, name, grade)
                VALUES (?, ?, 6)
                """,
                (payload.student_id, f"同学{payload.student_id[-4:]}"),
            )
            await db.commit()
            logger.info(f"start_session 自动创建学生: {payload.student_id}")

    session_id = f"session-{uuid.uuid4().hex[:8]}"
    await db.execute(
        """
        INSERT INTO learning_sessions (id, student_id)
        VALUES (?, ?)
        """,
        (session_id, payload.student_id),
    )
    await db.commit()
    return ok(
        {
            "session_id": session_id,
            "student_id": payload.student_id,
            "started_at": datetime.utcnow().isoformat(),
            "max_session_minutes": 30,
        }
    )


def _normalize_answer(v: Any) -> str:
    if isinstance(v, (str, int, float)):
        return str(v).strip()
    return json.dumps(v, ensure_ascii=False)


def _rule_judge(correct: str, student: str) -> bool:
    """简单的规则判题 - 纯文字/数字比较"""
    c = correct.strip()
    s = student.strip()
    if c == s:
        return True
    # 尝试数值等价
    try:
        return abs(float(c) - float(s)) < 1e-6
    except (ValueError, TypeError):
        return False


@router.post("/sessions/{session_id}/answers")
async def submit_answer(
    session_id: str,
    payload: SubmitAnswerRequest,
    db: aiosqlite.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    # ---- 会话存在性 + 学生 id ----
    async with db.execute(
        "SELECT student_id FROM learning_sessions WHERE id = ?", (session_id,)
    ) as cur:
        session_row = await cur.fetchone()
    if session_row is None:
        raise HTTPException(status_code=404, detail="会话不存在")
    student_id = session_row["student_id"]

    # ---- 题目查找：先查 DB，没有就去 QuestionBank（JSON）兜底 ----
    async with db.execute(
        "SELECT * FROM questions WHERE id = ?", (payload.question_id,)
    ) as cur:
        question_row = await cur.fetchone()

    correct_answer = ""
    question_content = ""
    question_difficulty = 2
    resolved_knowledge_id: str | None = None

    if question_row:
        question_content = str(question_row["content"])
        correct_answer = str(question_row["answer"])
        question_difficulty = int(question_row["difficulty"] or 2)
        resolved_knowledge_id = (
            str(question_row["knowledge_id"]) if question_row["knowledge_id"] else None
        )
    else:
        # DB 里没有 → 从静态 QuestionBank 找（generate_quiz 返回的 base-xxxx 题都在这里）
        # 然后 lazy upsert 到 questions / knowledge_nodes 表（FK 前置条件）
        try:
            bank = _bank_from_path(str(settings.question_bank_file))
            bq = next(
                (q for q in bank.questions if q.id == payload.question_id), None
            )
        except Exception as e:
            logger.warning(f"题库加载失败：{e}")
            bq = None

        if bq is not None:
            resolved_knowledge_id = await _ensure_knowledge_and_question(
                db, payload.question_id, bq
            )
            await db.commit()
            question_content = bq.content_latex
            correct_answer = bq.answer_latex
            question_difficulty = bq.difficulty
        else:
            # 题目既不在 DB 也不在 JSON 题库 → 很可能是客户端手动构造的 id
            # 为了保持 answer_records 能落盘，插一个 "orphan" 占位 question 行
            logger.warning(
                f"question_id={payload.question_id} 既不在 DB 也不在静态题库，"
                f"创建 orphan 占位 question 行"
            )
            orphan_kid = _synth_knowledge_id("未知")
            await db.execute(
                """
                INSERT OR IGNORE INTO knowledge_nodes
                  (id, name, grade, semester, unit, sort_order)
                VALUES (?, '未知', 6, 1, 0, 0)
                """,
                (orphan_kid,),
            )
            await db.execute(
                """
                INSERT OR IGNORE INTO questions
                  (id, knowledge_id, question_type, difficulty,
                   content, answer, source)
                VALUES (?, ?, '未知', 2, '', '', 'orphan')
                """,
                (payload.question_id, orphan_kid),
            )
            await db.commit()
            resolved_knowledge_id = orphan_kid

    student_answer_str = _normalize_answer(payload.student_answer)

    # ---- 1) 规则判题 ----
    is_correct = (
        _rule_judge(correct_answer, student_answer_str) if correct_answer else False
    )
    error_type: str | None = "none" if is_correct else "unknown"
    feedback = "答对了，继续加油！" if is_correct else ""

    # ---- 2) LLM 兜底判题（规则不匹配 + 有标答 + 已配置 LLM）----
    if correct_answer and not is_correct:
        try:
            client = get_llm_client()
            if client.api_key:
                prompt = evaluate_answer(
                    question=question_content,
                    correct_answer=correct_answer,
                    student_answer=student_answer_str,
                    grade=6,
                )
                text = await client.complete(
                    [Message(role="user", content=prompt)],
                    LLMOptions(temperature=0.2, max_tokens=256),
                )
                cleaned = text.strip().strip("```json").strip("```").strip()
                data = json.loads(cleaned)
                is_correct = bool(data.get("is_correct", False))
                error_type = data.get("error_type", error_type)
                feedback = sanitize_output(data.get("feedback", "")).sanitized
        except Exception as e:
            logger.warning(f"LLM 判题失败，使用规则结果: {e}")

    # ---- 3) 持久化答题记录（此时 question_id 一定在 questions 表里，FK 不再失败）----
    record_id = f"ans-{uuid.uuid4().hex[:8]}"
    await db.execute(
        """
        INSERT INTO answer_records
          (id, session_id, question_id, student_id, student_answer,
           is_correct, time_spent_secs, hint_used, error_type, ai_feedback)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            record_id,
            session_id,
            payload.question_id,
            student_id,
            student_answer_str,
            1 if is_correct else 0,
            payload.time_spent_secs,
            payload.hint_used,
            error_type,
            feedback,
        ),
    )

    # 4) 更新会话计数
    await db.execute(
        """
        UPDATE learning_sessions
        SET total_questions = total_questions + 1,
            correct_count = correct_count + ?
        WHERE id = ?
        """,
        (1 if is_correct else 0, session_id),
    )

    # 5) 更新 BKT 掌握度（此时 resolved_knowledge_id 一定存在）
    mastery_delta = 0.0
    if resolved_knowledge_id:
        kid = resolved_knowledge_id
        async with db.execute(
            "SELECT bkt_p_know FROM knowledge_mastery WHERE student_id=? AND knowledge_id=?",
            (student_id, kid),
        ) as cur:
            mrow = await cur.fetchone()
        prior = float(mrow["bkt_p_know"]) if mrow else 0.3
        new_mastery = bkt_update_weighted(
            prior=prior,
            is_correct=is_correct,
            hint_count=payload.hint_used,
            difficulty=question_difficulty,
        )
        mastery_delta = new_mastery - prior
        if mrow:
            await db.execute(
                """
                UPDATE knowledge_mastery
                SET mastery_score = ?, bkt_p_know = ?,
                    attempt_count = attempt_count + 1,
                    correct_count = correct_count + ?,
                    last_practiced_at = datetime('now'),
                    updated_at = datetime('now')
                WHERE student_id = ? AND knowledge_id = ?
                """,
                (
                    new_mastery,
                    new_mastery,
                    1 if is_correct else 0,
                    student_id,
                    kid,
                ),
            )
        else:
            await db.execute(
                """
                INSERT INTO knowledge_mastery
                  (student_id, knowledge_id, mastery_score, bkt_p_know,
                   attempt_count, correct_count, last_practiced_at)
                VALUES (?, ?, ?, ?, 1, ?, datetime('now'))
                """,
                (
                    student_id,
                    kid,
                    new_mastery,
                    new_mastery,
                    1 if is_correct else 0,
                ),
            )

    await db.commit()

    return ok(
        EvaluationResult(
            is_correct=is_correct,
            error_type=error_type,
            feedback=feedback,
            mastery_delta=mastery_delta,
        ).model_dump()
    )


@router.post("/sessions/{session_id}/end")
async def end_session(
    session_id: str,
    payload: SessionEnd,
    db: aiosqlite.Connection = Depends(get_db),
):
    await db.execute(
        """
        UPDATE learning_sessions
        SET ended_at = datetime('now'), end_reason = ?
        WHERE id = ?
        """,
        (payload.reason, session_id),
    )
    await db.commit()
    async with db.execute(
        "SELECT * FROM learning_sessions WHERE id = ?", (session_id,)
    ) as cur:
        row = await cur.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="会话不存在")
    return ok(row_to_dict(row))


@router.post("/sessions/{session_id}/summary")
async def generate_summary(
    session_id: str, db: aiosqlite.Connection = Depends(get_db)
):
    async with db.execute(
        "SELECT * FROM learning_sessions WHERE id = ?", (session_id,)
    ) as cur:
        srow = await cur.fetchone()
    if srow is None:
        raise HTTPException(status_code=404, detail="会话不存在")

    total = int(srow["total_questions"])
    correct = int(srow["correct_count"])
    accuracy_pct = int(round(correct / total * 100)) if total else 0

    duration_minutes = int((srow["total_duration_secs"] or 0) / 60)
    from_llm = True

    try:
        client = get_llm_client()
        if not client.api_key:
            raise RuntimeError("未配置 SILICONFLOW_API_KEY")
        prompt = session_summary(
            grade=6,
            total=total,
            correct=correct,
            accuracy_pct=accuracy_pct,
            duration_minutes=duration_minutes,
            answers_brief="",
            weak_topics=[],
        )
        text = await client.complete(
            [Message(role="user", content=prompt)],
            LLMOptions(temperature=0.6, max_tokens=512),
        )
        cleaned = text.strip().strip("```json").strip("```").strip()
        data = json.loads(cleaned)
    except Exception as e:
        logger.warning(f"生成总结失败，返回空结构: {e}")
        from_llm = False
        data = {
            "headline": f"做了 {total} 道题，答对 {correct} 道",
            "highlights": [],
            "to_review": [],
            "encouragement": "继续加油，每一题都在成长",
        }

    return ok(
        {
            "session_id": session_id,
            "total_questions": total,
            "correct_count": correct,
            "accuracy_pct": accuracy_pct,
            "accuracy_rate": correct / total if total else 0,
            "duration_minutes": duration_minutes,
            "from_llm": from_llm,
            **data,
        }
    )
