"""学习会话相关 schema"""
from pydantic import BaseModel


class SessionStart(BaseModel):
    student_id: str


class SessionStartResult(BaseModel):
    session_id: str
    student_id: str
    started_at: str
    max_session_minutes: int = 30


class SessionEnd(BaseModel):
    reason: str = "user_quit"  # 'completed' | 'timeout' | 'user_quit' | 'forced'


class SessionSummary(BaseModel):
    session_id: str
    total_questions: int
    correct_count: int
    accuracy_rate: float
    duration_minutes: int
    headline: str = ""
    highlights: list[str] = []
    to_review: list[str] = []
    encouragement: str = ""


class PacingStatusResponse(BaseModel):
    phase: str
    elapsed_minutes: int
    remaining_minutes: int
    max_session_minutes: int
    message: str
