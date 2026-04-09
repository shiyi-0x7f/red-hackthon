"""题库管理 - 从 src-tauri/src/services/question_bank.rs 移植

从 JSON 题库加载题目，支持三种出题模式：
- 诊断模式 (diagnose_quiz) - 每单元抽几道
- 单元模式 (quiz_for_unit) - 按单元
- 自适应模式 (adaptive_quiz) - 基于掌握度
"""
import json
import logging
from dataclasses import dataclass, field
from pathlib import Path

logger = logging.getLogger(__name__)


@dataclass
class BaseQuestion:
    id: str
    unit: str
    semester: str
    question_type: str
    content_latex: str
    answer_latex: str
    difficulty: int
    # 知识点名称（题目级，不是单元级）— 用作 knowledge_nodes.name 的细粒度追踪 key
    # 前 N 个单元的题目在 JSON 里带 `知识点` 字段；旧单元可能缺失
    knowledge_point: str | None = None


def infer_difficulty(qtype: str, content: str) -> int:
    """根据题型和内容长度启发式推断难度（1~5）"""
    base_map = {
        "填空题": 1,
        "判断题": 1,
        "计算题": 2,
        "比较题": 2,
        "找规律": 3,
        "简答题": 3,
        "应用题": 3,
        "综合计算": 3,
        "综合应用": 4,
    }
    base = base_map.get(qtype, 2)
    length_bonus = 1 if len(content) > 120 else 0
    return min(base + length_bonus, 5)


@dataclass
class QuestionBank:
    questions: list[BaseQuestion] = field(default_factory=list)

    @classmethod
    def from_json_str(cls, json_str: str) -> "QuestionBank":
        raw = json.loads(json_str)
        semesters = raw.get("学期", {})

        questions: list[BaseQuestion] = []
        idx = 0
        for semester_name in ("上册", "下册"):
            units = semesters.get(semester_name, [])
            for unit in units:
                unit_name = unit.get("单元", "")
                for q in unit.get("题目", []):
                    idx += 1
                    qtype = q.get("题型", "")
                    content = q.get("题目_latex", "")
                    answer = q.get("答案_latex", "")
                    # 优先使用 JSON 里提供的稳定 id（如 q-u1-kp1-001），退回自动编号
                    stable_id = q.get("id") or f"base-{idx:04d}"
                    # 题目级的知识点标签（前几个单元有，其他单元没有）
                    knowledge_point = q.get("知识点")
                    if isinstance(knowledge_point, list):
                        knowledge_point = knowledge_point[0] if knowledge_point else None
                    if knowledge_point is not None and not isinstance(knowledge_point, str):
                        knowledge_point = str(knowledge_point)

                    questions.append(
                        BaseQuestion(
                            id=str(stable_id),
                            unit=unit_name,
                            semester=semester_name,
                            question_type=qtype,
                            content_latex=content,
                            answer_latex=answer,
                            difficulty=infer_difficulty(qtype, content),
                            knowledge_point=knowledge_point,
                        )
                    )

        with_kp = sum(1 for q in questions if q.knowledge_point)
        logger.info(
            f"题库加载完成: {len(questions)} 道基题（其中 {with_kp} 道带知识点标签）"
        )
        return cls(questions=questions)

    @classmethod
    def from_file(cls, path: str | Path) -> "QuestionBank":
        text = Path(path).read_text(encoding="utf-8")
        return cls.from_json_str(text)

    def unit_names(self) -> list[str]:
        seen: list[str] = []
        for q in self.questions:
            if q.unit not in seen:
                seen.append(q.unit)
        return seen

    def questions_for_unit(self, unit: str) -> list[BaseQuestion]:
        return [q for q in self.questions if q.unit == unit]

    def diagnose_quiz(self, count_per_unit: int = 1) -> list[BaseQuestion]:
        """冷启动诊断 — 每单元取前 N 题"""
        result: list[BaseQuestion] = []
        for unit_name in self.unit_names():
            result.extend(self.questions_for_unit(unit_name)[:count_per_unit])
        return result

    def quiz_for_unit(self, unit: str, count: int) -> list[BaseQuestion]:
        qs = self.questions_for_unit(unit)
        if qs:
            return qs[:count]
        # 模糊匹配：从复习页跳转时，knowledge_nodes.name 可能和 bank unit 不完全一致
        for bank_unit in self.unit_names():
            if unit in bank_unit or bank_unit in unit:
                qs = self.questions_for_unit(bank_unit)
                if qs:
                    logger.info(f"quiz_for_unit 模糊匹配: '{unit}' → '{bank_unit}'")
                    return qs[:count]
        return []

    def adaptive_quiz(
        self,
        mastery_data: dict[str, float],
        count: int,
        *,
        recommended_difficulty: int = 2,
        error_types: dict[str, int] | None = None,
        fatigue: float = 0.0,
    ) -> list[BaseQuestion]:
        """自适应选题 - 按掌握度 + 学生状态决定选题偏好

        - mastery < 0.4 → 薄弱，偏好简单题
        - 0.4 ~ 0.7     → 中等，偏好中等题
        - > 0.7         → 较好，偏好难题

        增强：
        - fatigue > 0.5 → 整体偏好低难度题（让学生找回信心）
        - error_types 中 conceptual 多 → 偏好概念辨析题（判断/填空）
        - recommended_difficulty → 作为选题中心难度
        """
        # 难度偏好中心：综合 recommended_difficulty 和 fatigue
        center_diff = recommended_difficulty
        if fatigue > 0.5:
            center_diff = max(1, center_diff - 1)

        # 是否偏好概念辨析题型
        prefer_concept_types = False
        if error_types:
            conceptual_count = error_types.get("conceptual", 0)
            total_errors = sum(error_types.values())
            if total_errors > 0 and conceptual_count / total_errors > 0.4:
                prefer_concept_types = True

        candidates: list[tuple[float, BaseQuestion]] = []
        for q in self.questions:
            mastery = mastery_data.get(q.unit, 0.0)

            # 基础优先级：薄弱知识点优先
            if mastery < 0.4:
                priority = (1.0 - mastery) + (0.3 if q.difficulty <= 2 else 0.0)
            elif mastery < 0.7:
                priority = (0.7 - mastery) + (
                    0.2 if 2 <= q.difficulty <= 3 else 0.0
                )
            else:
                priority = (0.3 - mastery * 0.2) if q.difficulty >= 3 else 0.1

            # 难度对齐奖励：难度越接近推荐中心，优先级越高
            diff_distance = abs(q.difficulty - center_diff)
            priority += max(0, 0.3 - diff_distance * 0.15)

            # 概念辨析题型奖励：当学生概念错误多时偏好判断/填空
            if prefer_concept_types and q.question_type in ("判断题", "填空题"):
                priority += 0.2

            candidates.append((priority, q))

        candidates.sort(key=lambda pair: pair[0], reverse=True)
        return [q for _, q in candidates[:count]]

