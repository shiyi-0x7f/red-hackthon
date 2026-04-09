"""讲解与提示路由 - SSE 流式讲解 + 分层提示"""
import json
import logging

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException
from sse_starlette.sse import EventSourceResponse

from ..ai.llm_client import LLMOptions, Message, get_llm_client
from ..ai.prompts import explain_text_only, layered_hint, visual_plan, visual_render
from ..db.connection import get_db
from ..schemas.common import ok
from ..schemas.question import HintRequest
from ._deps import require_api_key

logger = logging.getLogger(__name__)
router = APIRouter(dependencies=[Depends(require_api_key)])


_GEOMETRY_KEYWORDS = (
    "圆",
    "三角形",
    "多边形",
    "角",
    "平行",
    "垂直",
    "面积",
    "周长",
    "体积",
    "立方",
    "圆柱",
    "圆锥",
    "坐标",
    "几何",
)


def _has_geometry_hint(text: str) -> bool:
    return any(k in text for k in _GEOMETRY_KEYWORDS)


@router.get("/explain/stream")
async def explain_stream(
    question_id: str,
    db: aiosqlite.Connection = Depends(get_db),
):
    """SSE 流式讲解，两层 agent：
    1. 纯文字讲解（第一个 LLM 调用）
    2. （可选）视觉规划 + JSXGraph 渲染（第二个 LLM 调用，仅当命中几何关键词）
    """
    async with db.execute(
        "SELECT * FROM questions WHERE id = ?", (question_id,)
    ) as cur:
        row = await cur.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="题目不存在")

    question_content = str(row["content"])
    correct_answer = str(row["answer"])
    unit = "基础"  # TODO: 从 knowledge_nodes 查
    grade = 6

    client = get_llm_client()
    if not client.api_key:
        raise HTTPException(status_code=500, detail="未配置 SILICONFLOW_API_KEY")

    async def event_generator():
        # Agent 1: 纯文字讲解
        try:
            prompt = explain_text_only(
                question=question_content,
                correct_answer=correct_answer,
                grade=grade,
                unit=unit,
            )
            async for chunk in client.complete_stream(
                [Message(role="user", content=prompt)],
                LLMOptions(temperature=0.5, max_tokens=1024),
            ):
                yield {"event": "text", "data": chunk}
        except Exception as e:
            logger.exception("讲解流式失败")
            yield {"event": "error", "data": str(e)}
            return

        # Agent 2: 几何可视化（仅命中关键词时才跑，节省 token）
        if _has_geometry_hint(question_content):
            try:
                plan_text = await client.complete(
                    [
                        Message(
                            role="user",
                            content=visual_plan(
                                question=question_content,
                                correct_answer=correct_answer,
                                unit=unit,
                            ),
                        )
                    ],
                    LLMOptions(temperature=0.2, max_tokens=256),
                )
                plan = json.loads(plan_text.strip().strip("```json").strip("```").strip())
                if plan.get("needs_visual") and plan.get("description"):
                    render_text = await client.complete(
                        [
                            Message(
                                role="user",
                                content=visual_render(plan["description"]),
                            )
                        ],
                        LLMOptions(temperature=0.2, max_tokens=512),
                    )
                    yield {"event": "visual", "data": render_text}
            except Exception as e:
                logger.warning(f"可视化生成失败（忽略）: {e}")

        yield {"event": "done", "data": "[DONE]"}

    return EventSourceResponse(event_generator())


@router.post("/hints")
async def get_hint(
    payload: HintRequest, db: aiosqlite.Connection = Depends(get_db)
):
    """分层提示 - 1/2/3 三级"""
    async with db.execute(
        "SELECT * FROM questions WHERE id = ?", (payload.question_id,)
    ) as cur:
        row = await cur.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="题目不存在")

    client = get_llm_client()
    if not client.api_key:
        return ok({"hint": "提示不可用，请先配置 API Key"})

    prompt = layered_hint(
        question=str(row["content"]),
        correct_answer=str(row["answer"]),
        level=payload.level,
        grade=6,
    )
    try:
        text = await client.complete(
            [Message(role="user", content=prompt)],
            LLMOptions(temperature=0.5, max_tokens=256),
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"生成提示失败: {e}") from e
    return ok({"text": text.strip(), "level": payload.level})
