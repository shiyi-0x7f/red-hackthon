"""教练引擎 - 简化版，供 NLU 路由的 coach.* 意图调用

这个模块是 C/S 化的「副线任务」：小学生通过 IM 平台说
「我想学分数乘法」「今天学了 20 分钟」「太难了」这类话时，
由教练引擎负责维护目标 / 计划 / 打卡 / 模式。

设计上复用 decision_engine 的硬规则，主要用 app_settings 表存学生态。
"""
import json
import logging
from dataclasses import dataclass, field
from datetime import datetime

import aiosqlite

logger = logging.getLogger(__name__)


@dataclass
class CoachState:
    student_id: str
    goal: str = ""
    mode: str = "gentle"  # 'gentle' | 'strict'
    plan: dict = field(default_factory=dict)
    last_checkin: str = ""
    updated_at: str = ""


def _key(student_id: str) -> str:
    return f"coach_state:{student_id}"


async def load_state(db: aiosqlite.Connection, student_id: str) -> CoachState:
    async with db.execute(
        "SELECT value FROM app_settings WHERE key = ?", (_key(student_id),)
    ) as cur:
        row = await cur.fetchone()
    if row is None:
        return CoachState(student_id=student_id)
    try:
        data = json.loads(row["value"])
        return CoachState(
            student_id=student_id,
            goal=data.get("goal", ""),
            mode=data.get("mode", "gentle"),
            plan=data.get("plan", {}),
            last_checkin=data.get("last_checkin", ""),
            updated_at=data.get("updated_at", ""),
        )
    except (json.JSONDecodeError, TypeError):
        return CoachState(student_id=student_id)


async def save_state(db: aiosqlite.Connection, state: CoachState) -> None:
    state.updated_at = datetime.utcnow().isoformat()
    payload = json.dumps(
        {
            "goal": state.goal,
            "mode": state.mode,
            "plan": state.plan,
            "last_checkin": state.last_checkin,
            "updated_at": state.updated_at,
        },
        ensure_ascii=False,
    )
    await db.execute(
        """
        INSERT INTO app_settings (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
        """,
        (_key(state.student_id), payload),
    )
    await db.commit()


async def set_goal(
    db: aiosqlite.Connection, student_id: str, goal_text: str
) -> dict:
    state = await load_state(db, student_id)
    state.goal = goal_text
    await save_state(db, state)
    return {
        "goal": goal_text,
        "reply": f"好的！我们的目标是：{goal_text}。我们一起加油，什么时候想练习都可以告诉我～",
    }


async def generate_plan(
    db: aiosqlite.Connection, student_id: str, days: int = 7
) -> dict:
    """生成简化的 N 天学习计划 - 不调 LLM，先用模板"""
    state = await load_state(db, student_id)
    goal = state.goal or "巩固当前薄弱知识点"
    plan = {
        "goal": goal,
        "days": days,
        "today_tasks": [
            f"做 5 道与「{goal}」相关的练习题",
            "回顾最近一次的错题",
            "总结今天学到的一个要点",
        ],
        "weekly_target": f"在 {days} 天内把「{goal}」从初步掌握推进到熟练",
    }
    state.plan = plan
    await save_state(db, state)
    return plan


async def submit_checkin(
    db: aiosqlite.Connection,
    student_id: str,
    summary: str,
    blockers: str = "",
) -> dict:
    """提交学习打卡

    简化规则：
    - 提到"不会/不懂/卡住/难" → 鼓励 + 建议降低难度
    - 提到"完成/学会/理解" → 肯定 + 建议推进
    - 其他 → 中性鼓励
    """
    state = await load_state(db, student_id)
    state.last_checkin = summary

    feedback = ""
    next_action = ""
    if any(k in summary + blockers for k in ["不会", "不懂", "卡住", "太难", "难"]):
        feedback = "这道题确实有点难，能坚持下来就已经很棒了。我们可以先从更基础的题开始，一步步来。"
        next_action = "suggest_easier"
        if state.mode == "strict":
            feedback += " 要不我们先休息一下，再从简单的题目开始？"
    elif any(k in summary for k in ["完成", "学会", "理解", "搞懂", "会了"]):
        feedback = "做得好！能自己搞懂题目是很大的进步，我们可以试试挑战更难一点的。"
        next_action = "suggest_advance"
    else:
        feedback = f"收到你的反馈「{summary[:20]}」。我们一起继续前进，遇到问题随时告诉我！"
        next_action = "continue"

    await save_state(db, state)
    return {
        "summary": summary,
        "blockers": blockers,
        "coach_feedback": feedback,
        "next_action": next_action,
    }


async def switch_mode(
    db: aiosqlite.Connection, student_id: str, mode: str
) -> dict:
    if mode not in ("gentle", "strict"):
        mode = "gentle"
    state = await load_state(db, student_id)
    state.mode = mode
    await save_state(db, state)
    reply = (
        "好的，我们放轻松一些，一步一步来，不着急。"
        if mode == "gentle"
        else "好的，我会更严格一点，我们一起挑战更难的内容！"
    )
    return {"mode": mode, "reply": reply}
