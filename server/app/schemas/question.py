"""题库 / 出题 / 判题相关 schema"""
from typing import Any

from pydantic import BaseModel, Field


class QuestionContent(BaseModel):
    """题目内容 - content_latex / answer_latex / type / difficulty 等"""
    id: str
    unit: str
    semester: str | None = None
    question_type: str
    content_latex: str
    answer_latex: str
    difficulty: int = Field(ge=1, le=5)
    hint: str | None = None
    knowledge_id: str | None = None


class QuizGenerateRequest(BaseModel):
    student_id: str
    mode: str = "adaptive"  # 'diagnose' | 'unit' | 'adaptive'
    unit: str | None = None
    count: int = 5
    knowledge_ids: list[str] | None = None


class QuizGenerateResponse(BaseModel):
    mode: str
    questions: list[QuestionContent]


class AIQuestionRequest(BaseModel):
    student_id: str
    unit: str
    difficulty: int = 2
    weak_topics: list[str] = []
    use_interest: bool = True


class SubmitAnswerRequest(BaseModel):
    session_id: str
    question_id: str
    student_answer: Any  # 字符串 / 数字 / 对象，统一 JSON
    time_spent_secs: int
    hint_used: int = 0
    was_skipped: bool = False


class EvaluationResult(BaseModel):
    is_correct: bool
    error_type: str | None = None
    error_step: str | None = None
    feedback: str = ""
    mastery_delta: float = 0.0


class HintRequest(BaseModel):
    question_id: str
    level: int = Field(ge=1, le=3)
    student_id: str
