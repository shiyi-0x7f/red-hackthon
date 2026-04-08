/// 教学决策引擎
///
/// 三层决策架构：
/// 1. 硬规则层 - 不可违反（疲劳过高→强制休息）
/// 2. 策略选择层 - 根据画像选教学策略
/// 3. 内容选择层 - 选具体知识点和题目

/// 决策动作
#[derive(Debug, Clone, serde::Serialize)]
pub enum TeachingAction {
    /// 继续练习当前知识点
    ContinuePractice { knowledge_id: String, difficulty: i32 },
    /// 推进新知识点
    IntroduceNew { knowledge_id: String },
    /// 安排复习
    ScheduleReview { knowledge_ids: Vec<String> },
    /// 建议休息
    SuggestBreak { reason: String },
    /// 强制结束
    ForceEnd { reason: String },
}

/// 决策结果
#[derive(Debug, Clone, serde::Serialize)]
pub struct DecisionResult {
    pub action: String,
    pub reasoning: String,
    pub params: serde_json::Value,
}

/// 掌握度信息
pub struct MasteryInfo {
    pub knowledge_id: String,
    pub name: String,
    pub mastery_score: f64,
    pub forgetting_risk: f64,
    pub last_practiced_hours_ago: f64,
}

/// 获取教学决策
pub fn decide(
    fatigue: f64,
    frustration: f64,
    consecutive_errors: i32,
    session_minutes: i64,
    max_session_minutes: i32,
    mastery_data: &[MasteryInfo],
) -> DecisionResult {
    // === 第一层：硬规则 ===

    // 疲劳过高 → 强制结束
    if fatigue > 0.9 {
        return DecisionResult {
            action: "force_end".to_string(),
            reasoning: "疲劳度过高，需要休息了".to_string(),
            params: serde_json::json!({ "reason": "fatigue_critical" }),
        };
    }

    // 超时 → 强制结束
    if session_minutes >= max_session_minutes as i64 {
        return DecisionResult {
            action: "force_end".to_string(),
            reasoning: format!("已学习 {} 分钟，达到时间上限", session_minutes),
            params: serde_json::json!({ "reason": "timeout" }),
        };
    }

    // 连续错误 ≥ 5 → 建议休息
    if consecutive_errors >= 5 {
        return DecisionResult {
            action: "suggest_break".to_string(),
            reasoning: format!("连续做错了 {} 道题，休息一下再来更好", consecutive_errors),
            params: serde_json::json!({ "consecutive_errors": consecutive_errors }),
        };
    }

    // 疲劳较高 → 建议休息
    if fatigue > 0.7 {
        return DecisionResult {
            action: "suggest_break".to_string(),
            reasoning: "学习了一段时间了，适当休息效果更好哦".to_string(),
            params: serde_json::json!({ "fatigue": fatigue }),
        };
    }

    // 即将超时 → 开始收束
    let remaining = max_session_minutes as i64 - session_minutes;
    if remaining <= 5 {
        return DecisionResult {
            action: "winding_down".to_string(),
            reasoning: format!("还剩 {} 分钟，我们来做个小总结吧", remaining),
            params: serde_json::json!({ "remaining_minutes": remaining }),
        };
    }

    // === 第二层：策略选择 ===

    if mastery_data.is_empty() {
        return DecisionResult {
            action: "continue_practice".to_string(),
            reasoning: "继续练习，积累更多学习数据".to_string(),
            params: serde_json::json!({}),
        };
    }

    // 找出遗忘风险高的知识点
    let high_forgetting: Vec<&MasteryInfo> = mastery_data
        .iter()
        .filter(|m| m.forgetting_risk > 0.6)
        .collect();

    // 找出掌握度低的知识点
    let weak_points: Vec<&MasteryInfo> = mastery_data
        .iter()
        .filter(|m| m.mastery_score < 0.4)
        .collect();

    // 找出掌握度较好的知识点
    let strong_points: Vec<&MasteryInfo> = mastery_data
        .iter()
        .filter(|m| m.mastery_score > 0.7)
        .collect();

    // === 第三层：内容选择 ===

    // 策略1: 遗忘高 → 优先安排复习
    if !high_forgetting.is_empty() && consecutive_errors < 3 {
        let review_ids: Vec<String> = high_forgetting
            .iter()
            .take(3)
            .map(|m| m.knowledge_id.clone())
            .collect();
        let names: Vec<String> = high_forgetting
            .iter()
            .take(3)
            .map(|m| m.name.clone())
            .collect();

        return DecisionResult {
            action: "schedule_review".to_string(),
            reasoning: format!(
                "「{}」等知识点有些时间没练了，复习一下加深记忆",
                names.join("、")
            ),
            params: serde_json::json!({
                "knowledge_ids": review_ids,
                "knowledge_names": names,
            }),
        };
    }

    // 策略2: 有薄弱点 → 继续练习薄弱的
    if !weak_points.is_empty() {
        let target = weak_points[0];
        let difficulty = if target.mastery_score < 0.2 { 1 } else { 2 };

        return DecisionResult {
            action: "continue_practice".to_string(),
            reasoning: format!(
                "「{}」还需要多练习，我们再做几道题巩固一下",
                target.name
            ),
            params: serde_json::json!({
                "knowledge_id": target.knowledge_id,
                "knowledge_name": target.name,
                "difficulty": difficulty,
            }),
        };
    }

    // 策略3: 掌握度较好 + 注意力好 → 推进新内容
    if strong_points.len() as f64 / mastery_data.len() as f64 > 0.5 && fatigue < 0.3 {
        return DecisionResult {
            action: "introduce_new".to_string(),
            reasoning: "掌握得不错！可以挑战新的知识点了 🚀".to_string(),
            params: serde_json::json!({
                "suggest": "next_unit",
            }),
        };
    }

    // 默认: 继续当前练习
    DecisionResult {
        action: "continue_practice".to_string(),
        reasoning: "继续加油，保持当前的学习节奏".to_string(),
        params: serde_json::json!({}),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_force_end_on_high_fatigue() {
        let result = decide(0.95, 0.0, 0, 10, 30, &[]);
        assert_eq!(result.action, "force_end");
    }

    #[test]
    fn test_suggest_break_on_errors() {
        let result = decide(0.3, 0.5, 5, 10, 30, &[]);
        assert_eq!(result.action, "suggest_break");
    }

    #[test]
    fn test_timeout_force_end() {
        let result = decide(0.3, 0.0, 0, 30, 30, &[]);
        assert_eq!(result.action, "force_end");
    }

    #[test]
    fn test_review_on_high_forgetting() {
        let mastery = vec![MasteryInfo {
            knowledge_id: "k1".to_string(),
            name: "分数乘法".to_string(),
            mastery_score: 0.5,
            forgetting_risk: 0.8,
            last_practiced_hours_ago: 72.0,
        }];
        let result = decide(0.2, 0.0, 0, 10, 30, &mastery);
        assert_eq!(result.action, "schedule_review");
    }

    #[test]
    fn test_continue_on_weak_points() {
        let mastery = vec![MasteryInfo {
            knowledge_id: "k1".to_string(),
            name: "圆的面积".to_string(),
            mastery_score: 0.2,
            forgetting_risk: 0.1,
            last_practiced_hours_ago: 1.0,
        }];
        let result = decide(0.2, 0.0, 0, 10, 30, &mastery);
        assert_eq!(result.action, "continue_practice");
    }
}
