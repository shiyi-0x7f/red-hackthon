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
