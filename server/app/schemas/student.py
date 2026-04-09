"""学生 / 画像 / 状态相关 schema"""
from pydantic import BaseModel, Field


class StudentCreate(BaseModel):
    name: str
    grade: int = Field(ge=1, le=6)
    avatar: str | None = None
    # 允许客户端指定 id（浏览器端用 web-xxxx 格式）
    # 如果不传，server 自动生成 student-xxxx
    id: str | None = None


class Student(BaseModel):
    id: str
    name: str
    grade: int
    avatar: str | None = None
    created_at: str
    updated_at: str


class StudentState(BaseModel):
    student_id: str
    fatigue: float = 0.0
    frustration: float = 0.0
    consecutive_errors: int = 0
    current_session_id: str | None = None
    session_elapsed_minutes: int = 0
    last_updated: str | None = None


class MasteryItem(BaseModel):
    knowledge_id: str
    knowledge_name: str
    mastery_score: float
    forgetting_risk: float
    attempt_count: int
    correct_count: int
    last_practiced_at: str | None = None


class StudentProfile(BaseModel):
    student_id: str
    name: str
    grade: int
    total_questions_answered: int = 0
    overall_accuracy: float = 0.0
    mastery_items: list[MasteryItem] = []


class WrongAnswer(BaseModel):
    record_id: str
    question_id: str
    question_content: str
    student_answer: str
    correct_answer: str
    error_type: str | None = None
    knowledge_id: str | None = None
    knowledge_name: str | None = None
    session_id: str
    created_at: str


class ReviewRecommendation(BaseModel):
    knowledge_id: str
    knowledge_name: str
    mastery_score: float
    forgetting_risk: float
    last_practiced_hours_ago: float
    priority_score: float
    reason: str
