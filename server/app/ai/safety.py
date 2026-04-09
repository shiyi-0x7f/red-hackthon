"""LLM 输出安全过滤 - 从 src-tauri/src/ai/safety.rs 移植

文档 09_Prompt工程与安全规范.md 要求：
1. 禁用词扫描（人格判断 / 心理诊断 / 能力定性）
2. 情感绑定模式检测
3. 敏感内容检测（自伤 / 自杀 / 家暴 → 升级提示）
"""
import logging
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class Violation:
    category: str
    matched: str


@dataclass
class SafetyResult:
    is_safe: bool
    violations: list[Violation] = field(default_factory=list)
    sanitized: str = ""
    needs_escalation: bool = False


# 禁用词清单 — (词, 类别)
BLOCKED_WORDS: list[tuple[str, str]] = [
    # 人格判断
    ("内向", "personality"),
    ("外向", "personality"),
    ("冲动", "personality"),
    ("懒惰", "personality"),
    ("多动", "personality"),
    ("自卑", "personality"),
    # 心理诊断
    ("焦虑症", "psych"),
    ("抑郁", "psych"),
    ("自闭", "psych"),
    ("自闭症", "psych"),
    ("多动症", "psych"),
    ("注意力缺陷", "psych"),
    ("ADHD", "psych"),
    # 能力定性
    ("你不行", "ability"),
    ("你太差", "ability"),
    ("没救了", "ability"),
    ("智商低", "ability"),
    ("脑子笨", "ability"),
    ("学不会", "ability"),
]

# 情感绑定模式
BINDING_PATTERNS: list[str] = [
    "我永远",
    "我会一直陪",
    "我永远陪",
    "永远不会离开你",
    "你只能依靠我",
    "我是你唯一",
]

# 敏感内容关键词（需要升级到家长）
SENSITIVE_PATTERNS: list[str] = [
    "自杀",
    "自残",
    "想死",
    "活着没意思",
    "活不下去",
    "家暴",
    "被打",
    "爸爸打我",
    "妈妈打我",
]


def sanitize_output(text: str) -> SafetyResult:
    """对 LLM 输出做安全清洗"""
    violations: list[Violation] = []
    sanitized = text

    # 1. 禁用词
    for word, category in BLOCKED_WORDS:
        if word in sanitized:
            violations.append(Violation(category=category, matched=word))
            sanitized = sanitized.replace(word, "***")

    # 2. 情感绑定
    for pattern in BINDING_PATTERNS:
        if pattern in sanitized:
            violations.append(Violation(category="emotional_binding", matched=pattern))
            sanitized = sanitized.replace(pattern, "我们")

    # 3. 敏感内容（不替换原文，触发升级）
    needs_escalation = False
    for pattern in SENSITIVE_PATTERNS:
        if pattern in text:
            violations.append(Violation(category="sensitive", matched=pattern))
            needs_escalation = True

    is_safe = len(violations) == 0

    if not is_safe:
        logger.warning(
            f"[safety] LLM 输出违反 {len(violations)} 项规则: "
            f"{[f'{v.category}({v.matched})' for v in violations]}"
        )

    return SafetyResult(
        is_safe=is_safe,
        violations=violations,
        sanitized=sanitized,
        needs_escalation=needs_escalation,
    )
