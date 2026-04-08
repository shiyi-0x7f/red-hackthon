use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 基题 — 从 JSON 题库加载
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BaseQuestion {
    pub id: String,
    pub unit: String,
    pub semester: String,
    pub question_type: String,
    pub content_latex: String,
    pub answer_latex: String,
    pub difficulty: i32,
}

/// JSON 根结构
#[derive(Debug, Deserialize)]
struct QuestionBankJson {
    #[serde(rename = "学期")]
    semesters: HashMap<String, Vec<UnitJson>>,
}

#[derive(Debug, Deserialize)]
struct UnitJson {
    #[serde(rename = "单元")]
    unit: String,
    #[serde(rename = "题目")]
    questions: Vec<QuestionJson>,
}

#[derive(Debug, Deserialize)]
struct QuestionJson {
    #[serde(rename = "题型")]
    question_type: String,
    #[serde(rename = "题目_latex")]
    content_latex: String,
    #[serde(rename = "答案_latex")]
    answer_latex: String,
}

/// 题库管理器
#[derive(Debug, Clone)]
pub struct QuestionBank {
    pub questions: Vec<BaseQuestion>,
}

/// 推断题目难度（基于题型和内容长度启发式）
fn infer_difficulty(qtype: &str, content: &str) -> i32 {
    let base = match qtype {
        "填空题" => 1,
        "判断题" => 1,
        "计算题" => 2,
        "比较题" => 2,
        "找规律" => 3,
        "简答题" => 3,
        "应用题" => 3,
        "综合计算" => 3,
        "综合应用" => 4,
        _ => 2,
    };
    // 内容较长的题目稍难
    let length_bonus = if content.len() > 120 { 1 } else { 0 };
    (base + length_bonus).min(5)
}

impl QuestionBank {
    /// 从 JSON 文件内容加载题库
    pub fn from_json(json_str: &str) -> Result<Self, String> {
        let raw: QuestionBankJson =
            serde_json::from_str(json_str).map_err(|e| format!("解析题库 JSON 失败: {}", e))?;

        let mut questions = Vec::new();
        let mut idx = 0u32;

        // 按固定顺序处理学期
        for semester_name in &["上册", "下册"] {
            if let Some(units) = raw.semesters.get(*semester_name) {
                for unit in units {
                    for q in &unit.questions {
                        idx += 1;
                        let difficulty = infer_difficulty(&q.question_type, &q.content_latex);
                        questions.push(BaseQuestion {
                            id: format!("base-{:04}", idx),
                            unit: unit.unit.clone(),
                            semester: semester_name.to_string(),
                            question_type: q.question_type.clone(),
                            content_latex: q.content_latex.clone(),
                            answer_latex: q.answer_latex.clone(),
                            difficulty,
                        });
                    }
                }
            }
        }

        tracing::info!("题库加载完成: {} 道基题", questions.len());
        Ok(Self { questions })
    }

    /// 获取所有单元名称（保持顺序）
    pub fn unit_names(&self) -> Vec<String> {
        let mut names = Vec::new();
        for q in &self.questions {
            if !names.contains(&q.unit) {
                names.push(q.unit.clone());
            }
        }
        names
    }

    /// 按单元筛选题目
    pub fn questions_for_unit(&self, unit: &str) -> Vec<&BaseQuestion> {
        self.questions.iter().filter(|q| q.unit == unit).collect()
    }

    /// 冷启动诊断模式 — 每个单元抽 1~2 道题
    pub fn diagnose_quiz(&self, count_per_unit: usize) -> Vec<BaseQuestion> {
        let mut result = Vec::new();
        for unit_name in self.unit_names() {
            let unit_qs = self.questions_for_unit(&unit_name);
            for q in unit_qs.iter().take(count_per_unit) {
                result.push((*q).clone());
            }
        }
        result
    }

    /// 按指定单元出题
    pub fn quiz_for_unit(&self, unit: &str, count: usize) -> Vec<BaseQuestion> {
        self.questions_for_unit(unit)
            .into_iter()
            .take(count)
            .cloned()
            .collect()
    }

    /// 自适应选题 — 根据掌握度数据选择题目
    ///
    /// mastery_data: unit_name -> mastery_score (0~1)
    /// 策略：
    /// - 掌握度 < 0.4 → 出该单元基础题
    /// - 掌握度 0.4~0.7 → 出该单元中等题
    /// - 掌握度 > 0.7 → 跳过或出难题
    pub fn adaptive_quiz(
        &self,
        mastery_data: &HashMap<String, f64>,
        count: usize,
    ) -> Vec<BaseQuestion> {
        let mut candidates: Vec<(f64, &BaseQuestion)> = Vec::new();

        for q in &self.questions {
            let mastery = mastery_data.get(&q.unit).copied().unwrap_or(0.0);

            // 优先级计算：掌握度越低、优先级越高
            let priority = if mastery < 0.4 {
                // 薄弱 → 高优先级，偏好简单题
                if q.difficulty <= 2 {
                    1.0 - mastery + 0.3
                } else {
                    1.0 - mastery
                }
            } else if mastery < 0.7 {
                // 中等 → 中优先级，偏好中等题
                if q.difficulty >= 2 && q.difficulty <= 3 {
                    0.7 - mastery + 0.2
                } else {
                    0.7 - mastery
                }
            } else {
                // 较好 → 低优先级，偏好难题
                if q.difficulty >= 3 {
                    0.3 - mastery * 0.2
                } else {
                    0.1
                }
            };

            candidates.push((priority, q));
        }

        // 按优先级排序（降序）
        candidates.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

        candidates
            .into_iter()
            .take(count)
            .map(|(_, q)| q.clone())
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_infer_difficulty() {
        assert_eq!(infer_difficulty("填空题", "短题"), 1);
        assert_eq!(infer_difficulty("应用题", "短题"), 3);
        assert!(infer_difficulty("应用题", &"很长".repeat(100)) >= 3);
    }
}
