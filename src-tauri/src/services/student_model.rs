/// 学生模型服务
/// 
/// 负责：BKT 知识追踪、遗忘曲线计算、行为特征更新
/// 开发计划：W7-W8

/// BKT 参数
#[derive(Debug, Clone)]
pub struct BKTParams {
    /// 初始掌握概率
    pub p_init: f64,
    /// 学习转移概率
    pub p_transit: f64,
    /// 猜测概率
    pub p_guess: f64,
    /// 失误概率
    pub p_slip: f64,
}

impl Default for BKTParams {
    fn default() -> Self {
        Self {
            p_init: 0.3,
            p_transit: 0.1,
            p_guess: 0.2,
            p_slip: 0.1,
        }
    }
}

/// 根据答题结果更新 BKT 掌握度
pub fn bkt_update(prior: f64, is_correct: bool, params: &BKTParams) -> f64 {
    let p_correct_given_known = 1.0 - params.p_slip;
    let p_correct_given_unknown = params.p_guess;

    let posterior = if is_correct {
        (prior * p_correct_given_known)
            / (prior * p_correct_given_known + (1.0 - prior) * p_correct_given_unknown)
    } else {
        (prior * params.p_slip)
            / (prior * params.p_slip + (1.0 - prior) * (1.0 - params.p_guess))
    };

    // 考虑学习转移
    posterior + (1.0 - posterior) * params.p_transit
}

/// 带权 BKT 更新 — 文档要求的 calculate_weight(ctx)
///
/// 权重影响：
/// - hint_count > 0：答对的置信下降（提示越多，作为「独立答对」的证据越弱）
/// - difficulty 高：答对的转移概率提升（攻克难题学得更快）
///
/// 实现方式：
/// - 答对且用了提示：mastery 增量按 weight 缩放，weight = 1 / (1 + 0.5 * hint_count)
/// - 难度因子：转移概率 transit *= (1 + 0.1 * (difficulty - 2)).clamp(0.5, 2.0)
pub fn bkt_update_weighted(
    prior: f64,
    is_correct: bool,
    hint_count: i32,
    difficulty: i32,
    params: &BKTParams,
) -> f64 {
    let mut p = params.clone();

    let difficulty_factor = (1.0 + 0.1 * (difficulty as f64 - 2.0)).clamp(0.5, 2.0);
    p.p_transit *= difficulty_factor;

    let raw_posterior = bkt_update(prior, is_correct, &p);

    if is_correct && hint_count > 0 {
        // 用了提示 → 增量按权重打折
        let weight = 1.0 / (1.0 + 0.5 * hint_count as f64);
        let delta = raw_posterior - prior;
        prior + delta * weight
    } else {
        raw_posterior
    }
}

/// 计算遗忘风险（艾宾浩斯衰减）
pub fn forgetting_risk(mastery: f64, hours_since_last: f64) -> f64 {
    // 掌握度越高，半衰期越长
    let half_life = 24.0 * (1.0 + mastery * 4.0); // 1~5 天
    let decay = (-hours_since_last * 0.693 / half_life).exp();
    1.0 - (mastery * decay)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bkt_correct_increases_mastery() {
        let params = BKTParams::default();
        let before = 0.5;
        let after = bkt_update(before, true, &params);
        assert!(after > before, "答对后掌握度应上升");
    }

    #[test]
    fn test_bkt_incorrect_decreases_mastery() {
        let params = BKTParams::default();
        let before = 0.5;
        let after = bkt_update(before, false, &params);
        // 加上学习转移后可能不完全下降，但错误应减少置信度
        assert!(after < bkt_update(before, true, &params), "答错后掌握度应低于答对");
    }

    #[test]
    fn test_forgetting_increases_with_time() {
        let r1 = forgetting_risk(0.8, 1.0);
        let r2 = forgetting_risk(0.8, 48.0);
        assert!(r2 > r1, "时间越长遗忘风险越高");
    }
}
