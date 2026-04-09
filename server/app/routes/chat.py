"""对话路由 - 流式聊天 + 历史查询"""
import logging
import uuid

import aiosqlite
from fastapi import APIRouter, Depends
from sse_starlette.sse import EventSourceResponse

from ..ai.llm_client import LLMOptions, Message, get_llm_client
from ..ai.prompts import system_persona_stream
from ..ai.safety import sanitize_output
from ..db.connection import db_conn, get_db, rows_to_list
from ..schemas.common import ok
from ..schemas.decision import ChatMessageRequest
from ._deps import require_api_key

logger = logging.getLogger(__name__)
router = APIRouter(dependencies=[Depends(require_api_key)])


async def _persist_chat_message(
    *,
    msg_id: str,
    student_id: str,
    session_id: str | None,
    role: str,
    content: str,
    context_type: str,
) -> None:
    """用独立短连接写一条对话记录

    **为什么不复用 FastAPI 注入的 db**：
    SSE EventSourceResponse 里的 `event_generator` 是一个 async generator，
    FastAPI 的 `get_db` 依赖会在路由函数 return 时就结束上下文（把连接关掉）。
    之后 starlette 迭代 generator 产出 chunk 时，那个被关闭的连接已不可用，
    `db.execute` 会抛 "Cannot operate on a closed database" 或产生竞态。

    解决方法：generator 内部写 DB 时用 `db_conn()` 开一个新的短连接，
    写完即释放，不依赖外层生命周期。
    """
    async with db_conn() as conn:
        await conn.execute(
            """
            INSERT INTO chat_records
              (id, student_id, session_id, role, content, context_type)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (msg_id, student_id, session_id, role, content, context_type),
        )
        await conn.commit()


@router.post("/chat/stream")
async def chat_stream(
    payload: ChatMessageRequest,
    db: aiosqlite.Connection = Depends(get_db),
):
    """流式对话 - 保存 user 消息 + 流返回 assistant + 持久化 assistant

    时序：
    1. 路由函数内（依赖注入 db 仍活着）：写 user 消息、读历史、读学生年级
    2. 返回 EventSourceResponse，starlette 开始迭代 event_generator
    3. generator 内部不再使用外层 db，写 assistant 消息时用 db_conn() 新开连接
    """
    # 1. 持久化 user 消息
    user_msg_id = f"msg-{uuid.uuid4().hex[:8]}"
    await db.execute(
        """
        INSERT INTO chat_records (id, student_id, session_id, role, content, context_type)
        VALUES (?, ?, ?, 'user', ?, ?)
        """,
        (
            user_msg_id,
            payload.student_id,
            payload.session_id,
            payload.content,
            payload.context_type,
        ),
    )
    await db.commit()

    # 2. 读最近历史（最多 10 条，按时间倒序取后再翻回来）
    async with db.execute(
        """
        SELECT role, content FROM chat_records
        WHERE student_id = ?
        ORDER BY created_at DESC
        LIMIT 10
        """,
        (payload.student_id,),
    ) as cur:
        history_rows = await cur.fetchall()
    history = list(
        reversed([{"role": r["role"], "content": r["content"]} for r in history_rows])
    )

    # 3. 读学生年级
    async with db.execute(
        "SELECT grade FROM students WHERE id = ?", (payload.student_id,)
    ) as cur:
        srow = await cur.fetchone()
    grade = int(srow["grade"]) if srow else 6

    # 构造 system + history 消息
    messages: list[Message] = [
        Message(role="system", content=system_persona_stream(grade))
    ]
    for h in history:
        messages.append(Message(role=h["role"], content=h["content"]))

    client = get_llm_client()

    # 把必要的参数 copy 到闭包里，避免 generator 迭代时依赖外层状态
    student_id_snap = payload.student_id
    session_id_snap = payload.session_id
    context_type_snap = payload.context_type

    async def event_generator():
        if not client.api_key:
            yield {"event": "error", "data": "未配置 SILICONFLOW_API_KEY"}
            return

        full_text = ""
        try:
            async for chunk in client.complete_stream(
                messages, LLMOptions(temperature=0.7, max_tokens=512)
            ):
                safe = sanitize_output(chunk)
                out = safe.sanitized
                full_text += out
                yield {"event": "chunk", "data": out}
        except Exception as e:
            logger.exception("对话流失败")
            yield {"event": "error", "data": str(e)}
            return

        # 持久化 assistant 消息 — 用新开的短连接（见 _persist_chat_message 注释）
        try:
            await _persist_chat_message(
                msg_id=f"msg-{uuid.uuid4().hex[:8]}",
                student_id=student_id_snap,
                session_id=session_id_snap,
                role="assistant",
                content=full_text,
                context_type=context_type_snap,
            )
        except Exception as e:
            logger.warning(f"assistant 消息持久化失败: {e}")

        yield {"event": "done", "data": "[DONE]"}

    return EventSourceResponse(event_generator())


@router.get("/chat/history")
async def get_chat_history(
    student_id: str,
    limit: int = 50,
    db: aiosqlite.Connection = Depends(get_db),
):
    async with db.execute(
        """
        SELECT id, role, content, created_at
        FROM chat_records
        WHERE student_id = ?
        ORDER BY created_at DESC
        LIMIT ?
        """,
        (student_id, limit),
    ) as cur:
        rows = await cur.fetchall()
    return ok(list(reversed(rows_to_list(rows))))
