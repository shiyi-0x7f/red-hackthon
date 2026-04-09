"""行为特征引擎 - 从 src-tauri/src/services/feature_engine.rs 移植

从答题记录中提取可建模的行为特征。
"""
import math
from dataclasses import dataclass


@dataclass
class AnswerData:
    time_spent_secs: int
    is_correct: bool
    hint_used: int
    was_skipped: bool


@dataclass
class BehaviorFeatures:
    avg_response_time: float
    response_time_std: float
    hint_usage_rate: float
    accuracy_rate: float
    max_consecutive_errors: int
    skip_rate: float


def compute_features(records: list[AnswerData]) -> BehaviorFeatures:
    if not records:
        return BehaviorFeatures(
            avg_response_time=0.0,
            response_time_std=0.0,
            hint_usage_rate=0.0,
            accuracy_rate=0.0,
            max_consecutive_errors=0,
            skip_rate=0.0,
        )

    n = float(len(records))

    total_time = sum(r.time_spent_secs for r in records)
    avg_time = total_time / n

    variance = sum((r.time_spent_secs - avg_time) ** 2 for r in records) / n
    std_dev = math.sqrt(variance)

    accuracy = sum(1 for r in records if r.is_correct) / n
    hint_rate = sum(1 for r in records if r.hint_used > 0) / n
    skip_rate = sum(1 for r in records if r.was_skipped) / n

    max_consecutive = 0
    current_streak = 0
    for r in records:
        if not r.is_correct:
            current_streak += 1
            max_consecutive = max(max_consecutive, current_streak)
        else:
            current_streak = 0

    return BehaviorFeatures(
        avg_response_time=avg_time,
        response_time_std=std_dev,
        hint_usage_rate=hint_rate,
        accuracy_rate=accuracy,
        max_consecutive_errors=max_consecutive,
        skip_rate=skip_rate,
    )
