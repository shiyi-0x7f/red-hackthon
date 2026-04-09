"""节奏控制引擎 - 从 src-tauri/src/services/pacing_engine.rs 移植

四段节奏：
- Normal      - 正常学习
- Warning     - 还剩 ≤ 5 分钟，开始暗示
- WindingDown - 还剩 ≤ 2 分钟，收束总结
- Overtime    - 超时，降级模式
"""
from dataclasses import dataclass
from enum import Enum


class PacingPhase(str, Enum):
    NORMAL = "normal"
    WARNING = "warning"
    WINDING_DOWN = "winding_down"
    OVERTIME = "overtime"


@dataclass
class PacingStatus:
    phase: PacingPhase
    elapsed_minutes: int
    remaining_minutes: int
    max_session_minutes: int
    message: str


def evaluate(elapsed_minutes: int, max_session_minutes: int) -> PacingStatus:
    """根据已用时长和上限判定当前节奏阶段"""
    remaining = max_session_minutes - elapsed_minutes

    if remaining <= 0:
        return PacingStatus(
            phase=PacingPhase.OVERTIME,
            elapsed_minutes=elapsed_minutes,
            remaining_minutes=0,
            max_session_minutes=max_session_minutes,
            message="时间到啦！今天先到这里吧，我们保持好节奏",
        )
    if remaining <= 2:
        return PacingStatus(
            phase=PacingPhase.WINDING_DOWN,
            elapsed_minutes=elapsed_minutes,
            remaining_minutes=remaining,
            max_session_minutes=max_session_minutes,
            message=f"还剩 {remaining} 分钟，我们来做个小总结",
        )
    if remaining <= 5:
        return PacingStatus(
            phase=PacingPhase.WARNING,
            elapsed_minutes=elapsed_minutes,
            remaining_minutes=remaining,
            max_session_minutes=max_session_minutes,
            message=f"还剩 {remaining} 分钟，抓紧最后一题吧",
        )

    return PacingStatus(
        phase=PacingPhase.NORMAL,
        elapsed_minutes=elapsed_minutes,
        remaining_minutes=remaining,
        max_session_minutes=max_session_minutes,
        message="保持节奏，继续加油",
    )
