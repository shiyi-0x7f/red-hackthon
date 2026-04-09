"""出题路由 - 静态题库 + LLM 动态出题"""
import json
import logging
import uuid
from functools import lru_cache

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException

from ..ai.llm_client import LLMOptions, Message, get_llm_client
from ..ai.prompts import generate_question
from ..config import Settings, get_settings
from ..db.connection import get_db
from ..schemas.common import ok
from ..schemas.question import (
    AIQuestionRequest,
    QuestionContent,
    QuizGenerateRequest,
)
from ..services.question_bank import QuestionBank
from ._deps import require_api_key

logger = logging.getLogger(__name__)
router = APIRouter(dependencies=[Depends(require_api_key)])


@lru_cache(maxsize=2)
def _load_bank(path: str) -> QuestionBank:
    return QuestionBank.from_file(path)


def _bank_from_settings(settings: Settings) -> QuestionBank:
    return _load_bank(str(settings.question_bank_file))


def _q_to_schema(q) -> dict:
    return {
        "id": q.id,
        "unit": q.unit,
        "semester": q.semester,
        "question_type": q.question_type,
        "content_latex": q.content_latex,
        "answer_latex": q.answer_latex,
        "difficulty": q.difficulty,
        "knowledge_point": getattr(q, "knowledge_point", None),
    }


@router.get("/questions/overview")
async def bank_overview(settings: Settings = Depends(get_settings)):
    try:
        bank = _bank_from_settings(settings)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"题库加载失败: {e}") from e
    units = bank.unit_names()
    return ok(
        {
            "total": len(bank.questions),
            "unit_count": len(units),
            "units": units,
        }
    )


@router.post("/questions/quiz")
async def generate_quiz(
    payload: QuizGenerateRequest,
    db: aiosqlite.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    """生成练习题

    对齐 Rust 版 `commands/question.rs::generate_quiz` 的行为：

    - 客户端显式指定 mode='unit' 且带 unit 名 → 按单元出题
    - 否则按学生答题总数自动切换：
        - 答题 < 5     → diagnose（每单元抽 1）
        - 答题 5~19    → emerging（每单元抽 2）
        - 答题 ≥ 20    → adaptive（按掌握度加权）
    - 若客户端显式指定 mode='diagnose' / 'adaptive' 也会被尊重

    mastery_data 的 key 用 `knowledge_nodes.name`（和 Rust 版保持一致），
    question_bank.adaptive_quiz 内部用题目的 `unit` 字段查找此 dict。
    """
    bank = _bank_from_settings(settings)

    # 1. 统计答题总数（决定自动模式）
    async with db.execute(
        "SELECT COUNT(*) AS cnt FROM answer_records WHERE student_id = ?",
        (payload.student_id,),
    ) as cur:
        row = await cur.fetchone()
    total_answers = int(row["cnt"] or 0) if row else 0

    # 2. 读掌握度（用 knowledge_node.name 作为 key）
    async with db.execute(
        """
        SELECT kn.name AS knowledge_name, km.mastery_score
        FROM knowledge_mastery km
        JOIN knowledge_nodes kn ON kn.id = km.knowledge_id
        WHERE km.student_id = ?
        """,
        (payload.student_id,),
    ) as cur:
        mastery_rows = await cur.fetchall()
    mastery_data: dict[str, float] = {
        r["knowledge_name"]: float(r["mastery_score"]) for r in mastery_rows
    }

    # 3. 确定出题模式
    requested = payload.mode or "auto"
    if requested == "unit" and payload.unit:
        mode, qs = "unit", bank.quiz_for_unit(payload.unit, payload.count)
    elif requested == "diagnose":
        mode, qs = "diagnose", bank.diagnose_quiz(count_per_unit=1)
    elif requested == "adaptive":
        mode, qs = "adaptive", bank.adaptive_quiz(mastery_data, payload.count)
    else:
        # auto: 按学生画像清晰度切换
        if total_answers < 5:
            mode, qs = "diagnose", bank.diagnose_quiz(count_per_unit=1)
        elif total_answers < 20 or not mastery_data:
            mode, qs = "emerging", bank.diagnose_quiz(count_per_unit=2)
        else:
            mode, qs = "adaptive", bank.adaptive_quiz(mastery_data, payload.count)

    logger.info(
        f"student={payload.student_id} total_answers={total_answers} "
        f"mode={mode} questions={len(qs)}"
    )
    return ok(
        {"mode": mode, "questions": [_q_to_schema(q) for q in qs]}
    )


@router.post("/questions/ai")
async def generate_ai_question(
    payload: AIQuestionRequest,
    db: aiosqlite.Connection = Depends(get_db),
):
    """调 LLM 动态生成一道题，并立刻落库到 questions 表

    落库原因：后续 submit_answer 需要引用 question_id，而 answer_records.question_id
    有 FK 约束指向 questions(id)。如果不落库，答题时会触发 FOREIGN KEY constraint
    failed（Bug #1）。
    """
    client = get_llm_client()
    if not client.api_key:
        raise HTTPException(status_code=500, detail="未配置 SILICONFLOW_API_KEY")

    prompt = generate_question(
        grade=6,  # 当前只支持 6 年级
        unit=payload.unit,
        difficulty=payload.difficulty,
        weak_topics=payload.weak_topics,
        interest_context="",
    )

    text = await client.complete(
        messages=[Message(role="user", content=prompt)],
        opts=LLMOptions(temperature=0.9, max_tokens=1024),
    )

    # 尝试提取 JSON
    cleaned = text.strip()
    if cleaned.startswith("```"):
        # 去掉可能的 ```json 包裹
        parts = cleaned.split("```")
        if len(parts) >= 3:
            cleaned = parts[1]
            if cleaned.startswith("json"):
                cleaned = cleaned[4:]
            cleaned = cleaned.strip()

    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError as e:
        logger.error(f"LLM 出题响应解析失败: {text}")
        raise HTTPException(
            status_code=502, detail=f"LLM 响应不是合法 JSON: {e}"
        ) from e

    # ---- 落库：先 upsert knowledge_node，再 insert question ----
    # 用 "ai-<uuid>" 作为 id，和 Rust 版保持一致（submit_answer 里会识别 "ai-" 前缀）
    question_id = f"ai-{uuid.uuid4().hex[:12]}"
    unit_name = str(data.get("unit", payload.unit))
    knowledge_id = "kn-" + unit_name.replace(" ", "_")

    await db.execute(
        """
        INSERT OR IGNORE INTO knowledge_nodes
          (id, name, grade, semester, unit, sort_order)
        VALUES (?, ?, 6, 1, 0, 0)
        """,
        (knowledge_id, unit_name),
    )
    await db.execute(
        """
        INSERT INTO questions
          (id, knowledge_id, question_type, difficulty, content, answer, source)
        VALUES (?, ?, ?, ?, ?, ?, 'ai')
        """,
        (
            question_id,
            knowledge_id,
            str(data.get("question_type", "")),
            int(data.get("difficulty", payload.difficulty)),
            str(data.get("content_latex", "")),
            str(data.get("answer_latex", "")),
        ),
    )
    await db.commit()

    # 把生成的 id 塞回响应给客户端
    data["id"] = question_id
    data["knowledge_id"] = knowledge_id
    data["ai_generated"] = True
    return ok(data)
