"""学生模型服务 - BKT 知识追踪 + 艾宾浩斯遗忘曲线

从 src-tauri/src/services/student_model.rs 1:1 移植。
算法细节见原文件注释。
"""
import math
from dataclasses import dataclass


@dataclass
class BKTParams:
    """BKT 参数

    - p_init:    初始掌握概率
    - p_transit: 学习转移概率
    - p_guess:   猜测概率
    - p_slip:    失误概率
    """
    p_init: float = 0.3
    p_transit: float = 0.1
    p_guess: float = 0.2
    p_slip: float = 0.1


DEFAULT_BKT = BKTParams()


def bkt_update(prior: float, is_correct: bool, params: BKTParams = DEFAULT_BKT) -> float:
    """根据答题结果更新 BKT 掌握度"""
    p_correct_given_known = 1.0 - params.p_slip
    p_correct_given_unknown = params.p_guess

    if is_correct:
        posterior = (prior * p_correct_given_known) / (
            prior * p_correct_given_known + (1.0 - prior) * p_correct_given_unknown
        )
    else:
        posterior = (prior * params.p_slip) / (
            prior * params.p_slip + (1.0 - prior) * (1.0 - params.p_guess)
        )

    # 考虑学习转移
    return posterior + (1.0 - posterior) * params.p_transit


def bkt_update_weighted(
    prior: float,
    is_correct: bool,
    hint_count: int,
    difficulty: int,
    params: BKTParams = DEFAULT_BKT,
) -> float:
    """带权 BKT 更新 - calculate_weight(ctx)

    权重影响：
    - hint_count > 0：答对的置信下降（提示越多，作为「独立答对」的证据越弱）
    - difficulty 高：转移概率提升（攻克难题学得更快）

    - 答对且用了提示：mastery 增量按 weight 缩放，weight = 1 / (1 + 0.5 * hint_count)
    - 难度因子：p_transit *= clamp(1 + 0.1 * (difficulty - 2), 0.5, 2.0)
    """
    difficulty_factor = max(0.5, min(2.0, 1.0 + 0.1 * (difficulty - 2)))
    adjusted = BKTParams(
        p_init=params.p_init,
        p_transit=params.p_transit * difficulty_factor,
        p_guess=params.p_guess,
        p_slip=params.p_slip,
    )

    raw_posterior = bkt_update(prior, is_correct, adjusted)

    if is_correct and hint_count > 0:
        weight = 1.0 / (1.0 + 0.5 * hint_count)
        delta = raw_posterior - prior
        return prior + delta * weight

    return raw_posterior


def forgetting_risk(mastery: float, hours_since_last: float) -> float:
    """计算遗忘风险（艾宾浩斯衰减）

    掌握度越高，半衰期越长（1~5 天）。
    decay = exp(-hours * ln(2) / half_life)
    risk  = 1 - mastery * decay
    """
    half_life = 24.0 * (1.0 + mastery * 4.0)  # 1~5 天
    decay = math.exp(-hours_since_last * 0.693 / half_life)
    return 1.0 - (mastery * decay)
