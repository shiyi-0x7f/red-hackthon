/// LLM 输出安全过滤 — 文档 09_Prompt工程与安全规范.md 要求
///
/// 检查项：
/// 1. 禁用词扫描（人格判断 / 心理诊断 / 能力定性）
/// 2. 情感绑定模式检测（"我永远..." "我会一直陪..."）
/// 3. 敏感内容检测（自伤 / 自杀 / 家暴 → 升级提示）

/// 安全检查结果
#[derive(Debug, Clone)]
pub struct SafetyResult {
    /// 是否安全（false 表示有违规）
    pub is_safe: bool,
    /// 触发的违规类别
    pub violations: Vec<Violation>,
    /// 清洗后的文本（替换违规词）
    pub sanitized: String,
    /// 是否需要升级提示家长
    pub needs_escalation: bool,
}

#[derive(Debug, Clone)]
pub struct Violation {
    pub category: &'static str,
    pub matched: String,
}

/// 禁用词清单 — 人格判断 / 心理诊断 / 能力定性
const BLOCKED_WORDS: &[(&str, &str)] = &[
    // 人格判断
    ("category", "personality"),
    ("内向", "personality"),
    ("外向", "personality"),
    ("冲动", "personality"),
    ("懒惰", "personality"),
    ("多动", "personality"),
    ("自卑", "personality"),
    // 心理诊断
    ("焦虑症", "psych"),
    ("抑郁", "psych"),
    ("自闭", "psych"),
    ("自闭症", "psych"),
    ("多动症", "psych"),
    ("注意力缺陷", "psych"),
    ("ADHD", "psych"),
    // 能力定性
    ("你不行", "ability"),
    ("你太差", "ability"),
    ("没救了", "ability"),
    ("智商低", "ability"),
    ("脑子笨", "ability"),
    ("学不会", "ability"),
];

/// 情感绑定模式（正则风格的字符串包含匹配，避免引入 regex crate）
const BINDING_PATTERNS: &[&str] = &[
    "我永远",
    "我会一直陪",
    "我永远陪",
    "永远不会离开你",
    "你只能依靠我",
    "我是你唯一",
];

/// 敏感内容关键词（需要升级到家长）
const SENSITIVE_PATTERNS: &[&str] = &[
    "自杀",
    "自残",
    "想死",
    "活着没意思",
    "活不下去",
    "家暴",
    "被打",
    "爸爸打我",
    "妈妈打我",
];

/// 对 LLM 输出做安全清洗
pub fn sanitize_output(text: &str) -> SafetyResult {
    let mut violations = Vec::new();
    let mut sanitized = text.to_string();

    // 1. 禁用词
    for (word, category) in BLOCKED_WORDS {
        // 第一项是 marker，跳过
        if *category == "personality" && *word == "category" {
            continue;
        }
        if sanitized.contains(*word) {
            violations.push(Violation {
                category,
                matched: word.to_string(),
            });
            sanitized = sanitized.replace(*word, "***");
        }
    }

    // 2. 情感绑定
    for pattern in BINDING_PATTERNS {
        if sanitized.contains(*pattern) {
            violations.push(Violation {
                category: "emotional_binding",
                matched: pattern.to_string(),
            });
            sanitized = sanitized.replace(*pattern, "我们");
        }
    }

    // 3. 敏感内容（不替换，触发升级）
    let mut needs_escalation = false;
    for pattern in SENSITIVE_PATTERNS {
        if text.contains(*pattern) {
            violations.push(Violation {
                category: "sensitive",
                matched: pattern.to_string(),
            });
            needs_escalation = true;
        }
    }

    let is_safe = violations.is_empty();

    if !is_safe {
        tracing::warn!(
            "[safety] LLM 输出违反 {} 项规则: {:?}",
            violations.len(),
            violations.iter().map(|v| format!("{}({})", v.category, v.matched)).collect::<Vec<_>>()
        );
    }

    SafetyResult {
        is_safe,
        violations,
        sanitized,
        needs_escalation,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_clean_text_passes() {
        let r = sanitize_output("做得好！我们一起来看看下一题吧。");
        assert!(r.is_safe);
        assert!(!r.needs_escalation);
    }

    #[test]
    fn test_personality_word_blocked() {
        let r = sanitize_output("你比较内向，所以...");
        assert!(!r.is_safe);
        assert!(r.sanitized.contains("***"));
    }

    #[test]
    fn test_emotional_binding() {
        let r = sanitize_output("没事，我永远陪着你。");
        assert!(!r.is_safe);
        assert_eq!(r.violations[0].category, "emotional_binding");
    }

    #[test]
    fn test_sensitive_escalates() {
        let r = sanitize_output("我有时候想死...");
        assert!(r.needs_escalation);
        assert!(!r.is_safe);
    }
}
