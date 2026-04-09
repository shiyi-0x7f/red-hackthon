"""学生 CRUD 路由"""
import uuid

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException

from ..db.connection import get_db, row_to_dict, rows_to_list
from ..schemas.common import ok
from ..schemas.student import Student, StudentCreate
from ._deps import require_api_key

router = APIRouter(dependencies=[Depends(require_api_key)])


@router.post("/students")
async def create_student(
    payload: StudentCreate, db: aiosqlite.Connection = Depends(get_db)
):
    # 支持客户端指定 id（浏览器端 web-xxxx），否则 server 生成
    student_id = payload.id or f"student-{uuid.uuid4().hex[:8]}"

    # INSERT OR IGNORE：幂等——同一 id 重复创建不报错
    await db.execute(
        """
        INSERT OR IGNORE INTO students (id, name, grade, avatar)
        VALUES (?, ?, ?, ?)
        """,
        (student_id, payload.name, payload.grade, payload.avatar),
    )
    await db.commit()
    async with db.execute(
        "SELECT * FROM students WHERE id = ?", (student_id,)
    ) as cur:
        row = await cur.fetchone()
    return ok(row_to_dict(row))


@router.get("/students")
async def list_students(db: aiosqlite.Connection = Depends(get_db)):
    async with db.execute(
        "SELECT * FROM students ORDER BY created_at DESC"
    ) as cur:
        rows = await cur.fetchall()
    return ok(rows_to_list(rows))


@router.get("/students/{student_id}")
async def get_student(student_id: str, db: aiosqlite.Connection = Depends(get_db)):
    async with db.execute(
        "SELECT * FROM students WHERE id = ?", (student_id,)
    ) as cur:
        row = await cur.fetchone()
    if row is None:
        # 新用户自动创建兜底（避免 ensureStudentExists 竞态窗口内 404）
        await db.execute(
            "INSERT OR IGNORE INTO students (id, name, grade) VALUES (?, ?, 6)",
            (student_id, f"同学{student_id[-4:]}"),
        )
        await db.commit()
        async with db.execute(
            "SELECT * FROM students WHERE id = ?", (student_id,)
        ) as cur2:
            row = await cur2.fetchone()
    return ok(row_to_dict(row))


@router.delete("/students/{student_id}/data")
async def clear_student_data(
    student_id: str, db: aiosqlite.Connection = Depends(get_db)
):
    """清空学生的学习数据（测试/重置用，不删学生本身）"""
    tables = [
        "answer_records",
        "knowledge_mastery",
        "chat_records",
        "daily_stats",
        "learning_sessions",
        "behavior_features",
        "student_states",
        "event_logs",
        "hint_records",
    ]
    for t in tables:
        await db.execute(f"DELETE FROM {t} WHERE student_id = ?", (student_id,))
    await db.commit()
    return ok({"cleared_tables": tables})
