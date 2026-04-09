"""兴趣 / 学生背景路由"""
import json
import uuid

import aiosqlite
from fastapi import APIRouter, Depends

from ..ai.llm_client import LLMOptions, Message, get_llm_client
from ..ai.prompts import extract_interests as extract_prompt
from ..db.connection import get_db, row_to_dict, rows_to_list
from ..schemas.common import ok
from ..schemas.decision import InterestCreate, StudentBackground
from ._deps import require_api_key

router = APIRouter(dependencies=[Depends(require_api_key)])


@router.get("/students/{student_id}/interests")
async def list_interests(
    student_id: str, db: aiosqlite.Connection = Depends(get_db)
):
    async with db.execute(
        "SELECT * FROM interest_profile WHERE student_id = ? ORDER BY created_at DESC",
        (student_id,),
    ) as cur:
        rows = await cur.fetchall()
    return ok(rows_to_list(rows))


@router.post("/students/{student_id}/interests")
async def add_interest(
    student_id: str,
    payload: InterestCreate,
    db: aiosqlite.Connection = Depends(get_db),
):
    await db.execute(
        """
        INSERT OR IGNORE INTO interest_profile
          (student_id, category, name, affinity, notes, source)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            student_id,
            payload.category,
            payload.name,
            payload.affinity,
            payload.notes,
            payload.source,
        ),
    )
    await db.commit()
    # 返回插入的 id（autoincrement）
    async with db.execute("SELECT last_insert_rowid() AS id") as cur:
        row = await cur.fetchone()
    return ok({"id": row["id"] if row else 0})


@router.delete("/interests/{interest_id}")
async def delete_interest(
    interest_id: str, db: aiosqlite.Connection = Depends(get_db)
):
    await db.execute("DELETE FROM interest_profile WHERE id = ?", (interest_id,))
    await db.commit()
    return ok({"deleted": interest_id})


class ExtractRequest(StudentBackground):
    text: str


@router.post("/interests/extract")
async def extract_from_text(payload: dict):
    """从学生对话文本里抽取兴趣"""
    text = payload.get("text", "")
    client = get_llm_client()
    if not client.api_key or not text:
        return ok([])

    prompt = extract_prompt(text)
    try:
        raw = await client.complete(
            [Message(role="user", content=prompt)],
            LLMOptions(temperature=0.4, max_tokens=512),
        )
        cleaned = raw.strip().strip("```json").strip("```").strip()
        items = json.loads(cleaned)
    except Exception:
        items = []
    return ok(items)


@router.get("/students/{student_id}/background")
async def get_background(
    student_id: str, db: aiosqlite.Connection = Depends(get_db)
):
    try:
        async with db.execute(
            "SELECT * FROM student_background WHERE student_id = ?", (student_id,)
        ) as cur:
            row = await cur.fetchone()
    except Exception:
        row = None
    if row is None:
        return ok(
            {
                "student_id": student_id,
                "nickname": "",
                "hobby_summary": "",
                "family_notes": "",
                "dream": "",
            }
        )
    return ok(row_to_dict(row))


@router.put("/students/{student_id}/background")
async def update_background(
    student_id: str,
    payload: StudentBackground,
    db: aiosqlite.Connection = Depends(get_db),
):
    await db.execute(
        """
        INSERT INTO student_background (student_id, hobby_summary, family_notes, dream, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'))
        ON CONFLICT(student_id) DO UPDATE SET
          hobby_summary = excluded.hobby_summary,
          family_notes = excluded.family_notes,
          dream = excluded.dream,
          updated_at = datetime('now')
        """,
        (student_id, payload.hobbies, payload.family, payload.notes),
    )
    await db.commit()
    return ok({"student_id": student_id})

