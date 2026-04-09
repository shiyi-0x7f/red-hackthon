"""教学决策引擎 - 从 src-tauri/src/services/decision_engine.rs 1:1 移植

三层决策架构：
1. 硬规则层 - 不可违反（疲劳过高→强制结束）
2. 策略选择层 - 根据画像选教学策略
3. 内容选择层 - 选具体知识点和题目
"""
from dataclasses import dataclass, field
from typing import Any


@dataclass
class MasteryInfo:
    knowledge_id: str
    name: str
    mastery_score: float
    forgetting_risk: float
    last_practiced_hours_ago: float


@dataclass
class DecisionResult:
    action: str
    reasoning: str
    params: dict[str, Any] = field(default_factory=dict)


def decide(
    *,
    fatigue: float,
    frustration: float,
    consecutive_errors: int,
    session_minutes: int,
    max_session_minutes: int,
    mastery_data: list[MasteryInfo],
) -> DecisionResult:
    """获取教学决策 — 完整对应 Rust 版 decide()"""

    # ====================
    # 第一层：硬规则
    # ====================

    # 疲劳过高 → 强制结束
    if fatigue > 0.9:
        return DecisionResult(
            action="force_end",
            reasoning="疲劳度过高，需要休息了",
            params={"reason": "fatigue_critical"},
        )

    # 超时 → 强制结束
    if session_minutes >= max_session_minutes:
        return DecisionResult(
            action="force_end",
            reasoning=f"已学习 {session_minutes} 分钟，达到时间上限",
            params={"reason": "timeout"},
        )

    # 连续错误 ≥ 5 → 建议休息
    if consecutive_errors >= 5:
        return DecisionResult(
            action="suggest_break",
            reasoning=f"连续做错了 {consecutive_errors} 道题，休息一下再来更好",
            params={"consecutive_errors": consecutive_errors},
        )

    # 疲劳较高 → 建议休息
    if fatigue > 0.7:
        return DecisionResult(
            action="suggest_break",
            reasoning="学习了一段时间了，适当休息效果更好哦",
            params={"fatigue": fatigue},
        )

    # 即将超时 → 开始收束
    remaining = max_session_minutes - session_minutes
    if remaining <= 5:
        return DecisionResult(
            action="winding_down",
            reasoning=f"还剩 {remaining} 分钟，我们来做个小总结吧",
            params={"remaining_minutes": remaining},
        )

    # ====================
    # 第二层：策略选择
    # ====================

    if not mastery_data:
        return DecisionResult(
            action="continue_practice",
            reasoning="继续练习，积累更多学习数据",
            params={},
        )

    high_forgetting = [m for m in mastery_data if m.forgetting_risk > 0.6]
    weak_points = [m for m in mastery_data if m.mastery_score < 0.4]
    strong_points = [m for m in mastery_data if m.mastery_score > 0.7]

    # ====================
    # 第三层：内容选择
    # ====================

    # 策略1: 遗忘高 → 优先安排复习
    if high_forgetting and consecutive_errors < 3:
        review_ids = [m.knowledge_id for m in high_forgetting[:3]]
        names = [m.name for m in high_forgetting[:3]]
        return DecisionResult(
            action="schedule_review",
            reasoning=f"「{'、'.join(names)}」等知识点有些时间没练了，复习一下加深记忆",
            params={"knowledge_ids": review_ids, "knowledge_names": names},
        )

    # 策略2: 有薄弱点 → 继续练习薄弱的
    if weak_points:
        target = weak_points[0]
        difficulty = 1 if target.mastery_score < 0.2 else 2
        return DecisionResult(
            action="continue_practice",
            reasoning=f"「{target.name}」还需要多练习，我们再做几道题巩固一下",
            params={
                "knowledge_id": target.knowledge_id,
                "knowledge_name": target.name,
                "difficulty": difficulty,
            },
        )

    # 策略3: 掌握度较好 + 注意力好 → 推进新内容
    if len(strong_points) / len(mastery_data) > 0.5 and fatigue < 0.3:
        return DecisionResult(
            action="introduce_new",
            reasoning="掌握得不错！可以挑战新的知识点了 🚀",
            params={"suggest": "next_unit"},
        )

    # 默认: 继续当前练习
    return DecisionResult(
        action="continue_practice",
        reasoning="继续加油，保持当前的学习节奏",
        params={},
    )
