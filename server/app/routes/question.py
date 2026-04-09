"""出题路由 - 静态题库 + LLM 动态出题（融合学生画像）"""
import json
import logging
import uuid
from functools import lru_cache

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException

from ..ai.llm_client import LLMOptions, Message, get_llm_client
from ..ai.prompts import generate_question as generate_question_prompt
from ..config import Settings, get_settings
from ..db.connection import get_db
from ..schemas.common import ok
from ..schemas.question import (
    AIQuestionRequest,
    QuestionContent,
    QuizGenerateRequest,
)
from ..services.question_bank import QuestionBank
from ..services.student_profile import (
    SLOTS_FOR_QUIZ,
    StudentProfile,
    gather_student_profile,
)
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
    """生成练习题 — 基于学生画像个性化出题

    对齐 Rust 版 `commands/question.rs::generate_quiz` 的行为：

    - 客户端显式指定 mode='unit' 且带 unit 名 → 按单元出题
    - 否则按学生答题总数自动切换：
        - 答题 < 5     → diagnose（每单元抽 1）
        - 答题 5~19    → emerging（每单元抽 2）
        - 答题 ≥ 20    → adaptive（按掌握度加权）
    - 若客户端显式指定 mode='diagnose' / 'adaptive' 也会被尊重

    个性化增强：
    - adaptive 模式注入 recommended_difficulty + error_types + fatigue
    - LLM 兜底出题注入 weak_topics + interest_context + error_pattern
    """
    bank = _bank_from_settings(settings)

    # ── 加载学生画像（出题专用插槽组合）──
    profile = await gather_student_profile(db, payload.student_id, slots=SLOTS_FOR_QUIZ)

    # 1. 用画像中的答题总数决定自动模式（优先用画像数据，不再单独查 SQL）
    total_answers = profile.total_questions

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
        mode, qs = "adaptive", bank.adaptive_quiz(
            mastery_data,
            payload.count,
            recommended_difficulty=profile.recommended_difficulty,
            error_types=profile.error_distribution or None,
            fatigue=profile.fatigue,
        )
    else:
        # auto: 按学生画像清晰度切换
        if total_answers < 5:
            mode, qs = "diagnose", bank.diagnose_quiz(count_per_unit=1)
        elif total_answers < 20 or not mastery_data:
            mode, qs = "emerging", bank.diagnose_quiz(count_per_unit=2)
        else:
            mode, qs = "adaptive", bank.adaptive_quiz(
                mastery_data,
                payload.count,
                recommended_difficulty=profile.recommended_difficulty,
                error_types=profile.error_distribution or None,
                fatigue=profile.fatigue,
            )

    # 4. unit 模式兜底：静态题库找不到 → 用 LLM 动态出题 (注入画像)
    if mode == "unit" and len(qs) == 0 and payload.unit:
        logger.warning(
            f"quiz_for_unit 返回空题，尝试 LLM 出题: unit={payload.unit}"
        )
        try:
            client = get_llm_client()
            if client.api_key:
                ai_questions = []
                for i in range(min(payload.count, 3)):
                    prompt = generate_question_prompt(
                        grade=profile.grade,
                        unit=payload.unit,
                        difficulty=profile.recommended_difficulty,
                        weak_topics=profile.weak_topic_names,
                        interest_context=profile.interest_context,
                        error_pattern=profile.error_pattern_hint,
                    )
                    text = await client.complete(
                        messages=[Message(role="user", content=prompt)],
                        opts=LLMOptions(temperature=0.9, max_tokens=1024),
                    )
                    cleaned = text.strip()
                    if cleaned.startswith("```"):
                        parts = cleaned.split("```")
                        if len(parts) >= 3:
                            cleaned = parts[1]
                            if cleaned.startswith("json"):
                                cleaned = cleaned[4:]
                            cleaned = cleaned.strip()
                    try:
                        data = json.loads(cleaned)
                    except json.JSONDecodeError:
                        continue

                    q_id = f"ai-{uuid.uuid4().hex[:12]}"
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
                            q_id,
                            knowledge_id,
                            str(data.get("question_type", "")),
                            int(data.get("difficulty", 2)),
                            str(data.get("content_latex", "")),
                            str(data.get("answer_latex", "")),
                        ),
                    )
                    await db.commit()

                    ai_questions.append({
                        "id": q_id,
                        "unit": unit_name,
                        "semester": "上册",
                        "question_type": str(data.get("question_type", "计算题")),
                        "content_latex": str(data.get("content_latex", "")),
                        "answer_latex": str(data.get("answer_latex", "")),
                        "difficulty": int(data.get("difficulty", 2)),
                        "knowledge_point": None,
                    })
                if ai_questions:
                    logger.info(f"LLM 兜底出题成功: {len(ai_questions)} 道")
                    return ok({"mode": "unit", "questions": ai_questions})
        except Exception as e:
            logger.warning(f"LLM 兜底出题失败: {e}")

    logger.info(
        f"student={payload.student_id} total_answers={total_answers} "
        f"mode={mode} questions={len(qs)} "
        f"difficulty={profile.recommended_difficulty} "
        f"weak_topics={profile.weak_topic_names[:3]} "
        f"interests={len(profile.interests)} "
        f"error_type={profile.dominant_error_type or 'none'}"
    )
    return ok(
        {"mode": mode, "questions": [_q_to_schema(q) for q in qs]}
    )


@router.post("/questions/ai")
async def generate_ai_question(
    payload: AIQuestionRequest,
    db: aiosqlite.Connection = Depends(get_db),
):
    """调 LLM 动态生成一道题 — 融合学生画像个性化出题

    落库原因：后续 submit_answer 需要引用 question_id，而 answer_records.question_id
    有 FK 约束指向 questions(id)。如果不落库，答题时会触发 FOREIGN KEY constraint
    failed（Bug #1）。

    个性化增强：
    - 注入学生薄弱知识点 → AI 出题贴合学生弱项
    - 注入兴趣爱好 → 题目情境融入学生喜欢的话题
    - 注入错题类型 → 针对性出题（概念错多出判断题等）
    - 根据认知状态动态调整难度
    """
    # ── 加载学生画像（出题插槽）──
    profile = await gather_student_profile(db, payload.student_id, slots=SLOTS_FOR_QUIZ)

    client = get_llm_client()
    if not client.api_key:
        raise HTTPException(status_code=500, detail="未配置 SILICONFLOW_API_KEY")

    # 动态调整难度：请求的难度 vs 画像推荐难度，取中间值
    effective_difficulty = payload.difficulty
    if profile.total_questions >= 5:
        # 已有足够数据时，让画像参与难度决策
        effective_difficulty = round((payload.difficulty + profile.recommended_difficulty) / 2)
        effective_difficulty = max(1, min(5, effective_difficulty))

    # 合并薄弱知识点：请求的 + 画像的（去重）
    all_weak_topics = list(set(payload.weak_topics + profile.weak_topic_names))

    prompt = generate_question_prompt(
        grade=profile.grade,
        unit=payload.unit,
        difficulty=effective_difficulty,
        weak_topics=all_weak_topics,
        interest_context=profile.interest_context if payload.use_interest else "",
        error_pattern=profile.error_pattern_hint,
    )

    logger.info(
        "AI question for %s: unit=%s difficulty=%d→%d weak=%s interest=%s error=%s",
        payload.student_id,
        payload.unit,
        payload.difficulty,
        effective_difficulty,
        all_weak_topics[:3],
        bool(profile.interest_context),
        profile.dominant_error_type or "none",
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
            int(data.get("difficulty", effective_difficulty)),
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
