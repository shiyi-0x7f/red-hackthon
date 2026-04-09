"""讲解与提示路由 - SSE 流式讲解 + 分层提示

可视化 Agent 流程：
1. Agent 1: 纯文字讲解（流式输出）
2. Agent 2: 可视化规划（判断 jsxgraph / manim / fraction-bar / none）
3. Agent 3: 根据规划调用对应渲染器
"""
import json
import logging

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException
from sse_starlette.sse import EventSourceResponse

from ..ai.llm_client import LLMOptions, Message, get_llm_client
from ..ai.prompts import explain_text_only, layered_hint, manim_render, visual_plan, visual_render
from ..db.connection import get_db
from ..schemas.common import ok
from ..schemas.question import HintRequest
from ._deps import require_api_key

logger = logging.getLogger(__name__)
router = APIRouter(dependencies=[Depends(require_api_key)])


def _parse_json_from_llm(text: str) -> dict | None:
    """从 LLM 输出中提取 JSON（容错处理 markdown 包裹）"""
    text = text.strip()
    # 去掉 ```json ... ``` 包裹
    if text.startswith("```"):
        text = text.split("\n", 1)[-1] if "\n" in text else text[3:]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return None


@router.get("/explain/stream")
async def explain_stream(
    question_id: str,
    db: aiosqlite.Connection = Depends(get_db),
):
    """SSE 流式讲解，多层 Agent：
    1. 纯文字讲解（第一个 LLM 调用，流式）
    2. 可视化规划 — AI 从 jsxgraph/manim/fraction-bar/none 中选择最佳方式
    3. 对应的渲染 Agent（JSXGraph JSON / Manim 代码执行）
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
        # ── Agent 1: 纯文字讲解（流式） ──
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

        # ── Agent 2: 可视化规划（所有题目都跑，由 AI 决定用什么） ──
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
            plan = _parse_json_from_llm(plan_text)
            if plan is None:
                logger.warning(f"可视化规划 JSON 解析失败: {plan_text[:200]}")
                plan = {"visual_type": "none", "description": ""}

            visual_type = plan.get("visual_type", "none")
            description = plan.get("description", "")

            logger.info(
                f"可视化规划: type={visual_type}, desc={description[:50]}"
            )

        except Exception as e:
            logger.warning(f"可视化规划失败（忽略）: {e}")
            visual_type = "none"
            description = ""

        # ── Agent 3: 根据规划渲染可视化 ──

        if visual_type == "jsxgraph" and description:
            # JSXGraph 渲染
            try:
                render_text = await client.complete(
                    [
                        Message(
                            role="user",
                            content=visual_render(description),
                        )
                    ],
                    LLMOptions(temperature=0.2, max_tokens=512),
                )
                parsed = _parse_json_from_llm(render_text)
                if parsed and parsed.get("type") != "none":
                    yield {
                        "event": "visual",
                        "data": json.dumps(parsed, ensure_ascii=False),
                    }
            except Exception as e:
                logger.warning(f"JSXGraph 渲染失败（忽略）: {e}")

        elif visual_type == "manim" and description:
            # Manim 动画渲染
            try:
                # 先通知前端 Manim 渲染开始
                yield {
                    "event": "visual_loading",
                    "data": json.dumps(
                        {"type": "manim", "status": "rendering", "title": description[:20]},
                        ensure_ascii=False,
                    ),
                }

                # Agent 3: 生成 Manim 代码
                manim_code = await client.complete(
                    [
                        Message(
                            role="user",
                            content=manim_render(
                                question=question_content,
                                correct_answer=correct_answer,
                                description=description,
                            ),
                        )
                    ],
                    LLMOptions(temperature=0.3, max_tokens=1024),
                )

                # 执行 Manim 渲染
                from ..services.manim_service import ManimRenderError, render_manim

                video_path = await render_manim(manim_code)
                video_url = f"/media/manim/{video_path}"

                yield {
                    "event": "visual",
                    "data": json.dumps(
                        {
                            "type": "manim",
                            "title": description[:20],
                            "video_url": video_url,
                        },
                        ensure_ascii=False,
                    ),
                }
            except ManimRenderError as e:
                logger.warning(f"Manim 渲染失败: {e}")
                yield {
                    "event": "visual_error",
                    "data": json.dumps(
                        {"type": "manim", "error": str(e)},
                        ensure_ascii=False,
                    ),
                }
            except Exception as e:
                logger.warning(f"Manim 流程异常: {e}")

        elif visual_type == "fraction-bar" and description:
            # 分数条 — 简单的类型，由 LLM 直接给 parts
            try:
                fb_prompt = f"""根据下面的描述，生成一个分数/百分比条形图 JSON。

描述：{description}
题目：{question_content}
答案：{correct_answer}

严格 JSON 输出，不要 markdown 代码块包裹：
{{
  "type": "fraction-bar",
  "title": "图示标题",
  "parts": [
    {{"label": "标签", "value": 0.5, "color": "#FF8C42"}}
  ]
}}

颜色：#FF8C42 暖橙 / #00B5C8 湖青 / #F5A623 金黄 / #5BC97F 绿 / #E57373 红"""

                fb_text = await client.complete(
                    [Message(role="user", content=fb_prompt)],
                    LLMOptions(temperature=0.2, max_tokens=256),
                )
                parsed = _parse_json_from_llm(fb_text)
                if parsed and parsed.get("type") == "fraction-bar":
                    yield {
                        "event": "visual",
                        "data": json.dumps(parsed, ensure_ascii=False),
                    }
            except Exception as e:
                logger.warning(f"FractionBar 生成失败（忽略）: {e}")

        # visual_type == "none" → 不做任何可视化

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
