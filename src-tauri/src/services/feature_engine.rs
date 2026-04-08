/// 特征计算引擎
///
/// 负责：从原始行为数据提取可建模特征

/// 行为特征
#[derive(Debug, Clone, serde::Serialize)]
pub struct BehaviorFeatures {
    /// 平均答题时间（秒）
    pub avg_response_time: f64,
    /// 答题时间稳定性（标准差）
    pub response_time_std: f64,
    /// 提示使用率
    pub hint_usage_rate: f64,
    /// 正确率
    pub accuracy_rate: f64,
    /// 连续错误最大次数
    pub max_consecutive_errors: i32,
    /// 放弃率（跳过题目）
    pub skip_rate: f64,
}

/// 答题记录结构
pub struct AnswerData {
    pub time_spent_secs: i64,
    pub is_correct: bool,
    pub hint_used: i32,
    pub was_skipped: bool,
}

/// 从答题记录计算行为特征
pub fn compute_features(records: &[AnswerData]) -> BehaviorFeatures {
    if records.is_empty() {
        return BehaviorFeatures {
            avg_response_time: 0.0,
            response_time_std: 0.0,
            hint_usage_rate: 0.0,
            accuracy_rate: 0.0,
            max_consecutive_errors: 0,
            skip_rate: 0.0,
        };
    }

    let n = records.len() as f64;

    // 平均答题时间
    let total_time: f64 = records.iter().map(|r| r.time_spent_secs as f64).sum();
    let avg_time = total_time / n;

    // 答题时间标准差
    let variance: f64 = records
        .iter()
        .map(|r| {
            let diff = r.time_spent_secs as f64 - avg_time;
            diff * diff
        })
        .sum::<f64>()
        / n;
    let std_dev = variance.sqrt();

    // 正确率
    let correct_count = records.iter().filter(|r| r.is_correct).count() as f64;
    let accuracy = correct_count / n;

    // 提示使用率
    let hint_count = records.iter().filter(|r| r.hint_used > 0).count() as f64;
    let hint_rate = hint_count / n;

    // 连续错误最大次数
    let mut max_consecutive = 0;
    let mut current_streak = 0;
    for r in records {
        if !r.is_correct {
            current_streak += 1;
            max_consecutive = max_consecutive.max(current_streak);
        } else {
            current_streak = 0;
        }
    }

    // 放弃率
    let skip_count = records.iter().filter(|r| r.was_skipped).count() as f64;
    let skip_rate = skip_count / n;

    BehaviorFeatures {
        avg_response_time: avg_time,
        response_time_std: std_dev,
        hint_usage_rate: hint_rate,
        accuracy_rate: accuracy,
        max_consecutive_errors: max_consecutive,
        skip_rate,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_empty_records() {
        let features = compute_features(&[]);
        assert_eq!(features.accuracy_rate, 0.0);
        assert_eq!(features.max_consecutive_errors, 0);
    }

    #[test]
    fn test_all_correct() {
        let records = vec![
            AnswerData { time_spent_secs: 10, is_correct: true, hint_used: 0, was_skipped: false },
            AnswerData { time_spent_secs: 15, is_correct: true, hint_used: 0, was_skipped: false },
            AnswerData { time_spent_secs: 20, is_correct: true, hint_used: 0, was_skipped: false },
        ];
        let features = compute_features(&records);
        assert_eq!(features.accuracy_rate, 1.0);
        assert_eq!(features.max_consecutive_errors, 0);
        assert!((features.avg_response_time - 15.0).abs() < 0.01);
    }

    #[test]
    fn test_consecutive_errors() {
        let records = vec![
            AnswerData { time_spent_secs: 10, is_correct: true, hint_used: 0, was_skipped: false },
            AnswerData { time_spent_secs: 10, is_correct: false, hint_used: 0, was_skipped: false },
            AnswerData { time_spent_secs: 10, is_correct: false, hint_used: 1, was_skipped: false },
            AnswerData { time_spent_secs: 10, is_correct: false, hint_used: 0, was_skipped: false },
            AnswerData { time_spent_secs: 10, is_correct: true, hint_used: 0, was_skipped: false },
        ];
        let features = compute_features(&records);
        assert_eq!(features.max_consecutive_errors, 3);
        assert!((features.accuracy_rate - 0.4).abs() < 0.01);
        assert!((features.hint_usage_rate - 0.2).abs() < 0.01);
    }
}
