"""决策 / 对话 / 家长 / 兴趣 / 设置 schema"""
from typing import Any

from pydantic import BaseModel


# --- Decision ---
class NextActionRequest(BaseModel):
    student_id: str
    session_id: str | None = None


class NextActionResult(BaseModel):
    action: str
    reasoning: str
    params: dict[str, Any] = {}


# --- Chat ---
class ChatMessageRequest(BaseModel):
    student_id: str
    content: str
    session_id: str | None = None
    context_type: str = "casual"  # 'learning' | 'casual' | 'encouragement'


class ChatHistoryItem(BaseModel):
    id: str
    role: str  # 'user' | 'assistant'
    content: str
    created_at: str


# --- Parent ---
class ParentLoginRequest(BaseModel):
    password: str


class ParentLoginResult(BaseModel):
    ok: bool


class ParentOverview(BaseModel):
    student_id: str
    range: str  # 'week' | 'month' | 'all'
    total_sessions: int
    total_questions: int
    overall_accuracy: float
    avg_daily_duration_minutes: float
    mastery_snapshot: list[dict[str, Any]] = []
    recent_trends: list[dict[str, Any]] = []


# --- Interests ---
class Interest(BaseModel):
    id: str
    category: str
    name: str
    affinity: float
    notes: str | None = None
    source: str = "manual"


class InterestCreate(BaseModel):
    category: str
    name: str
    affinity: float = 0.7
    notes: str | None = None
    source: str = "manual"


class StudentBackground(BaseModel):
    student_id: str
    hobbies: str = ""
    family: str = ""
    notes: str = ""
    updated_at: str | None = None


# --- Settings ---
class ApiSettings(BaseModel):
    provider: str = "siliconflow"
    api_base: str
    api_key: str = ""
    default_model: str
    available_models: list[dict[str, Any]] = []


class ApiSettingsUpdate(BaseModel):
    api_key: str | None = None
    default_model: str | None = None
