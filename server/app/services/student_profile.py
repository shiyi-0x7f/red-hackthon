"""学生画像聚合服务 — 插槽模式按需加载

不同业务场景只需要画像的部分维度：
    - 聊天：兴趣 + 背景 + 基础统计（不需要错题分布和认知状态）
    - 出题：薄弱点 + 错题分布 + 认知状态 + 兴趣（用于 prompt 注入）
    - 决策：认知状态 + 掌握度（用于决策引擎）
    - 概览：全量数据（用于 profile 页面）

通过 ProfileSlot 枚举控制加载哪些数据维度，避免不必要的 SQL 查询。

使用方:
    profile = await gather_student_profile(db, sid, slots={
        ProfileSlot.MASTERY, ProfileSlot.INTERESTS, ProfileSlot.ERRORS,
    })
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from enum import Enum, auto

import aiosqlite

logger = logging.getLogger(__name__)


class ProfileSlot(Enum):
    """画像数据维度 — 按需选择加载"""

    BASIC = auto()        # 基础信息：grade, name
    STATS = auto()        # 答题统计：total_questions, correct_count, accuracy
    MASTERY = auto()      # 知识掌握度：weak_topics, strong_topics
    ERRORS = auto()       # 错题分析：error_distribution, dominant_error_type, recent_errors
    INTERESTS = auto()    # 兴趣爱好：interests (interest_profile 表)
    BACKGROUND = auto()   # 学生背景：nickname, hobby_summary, dream
    STATE = auto()        # 认知状态：fatigue, frustration, consecutive_errors
    DURATION = auto()     # 学习历史：learning_days, total_duration_minutes


# ── 预定义插槽组合，方便调用方 ──

SLOTS_FOR_QUIZ: frozenset[ProfileSlot] = frozenset({
    ProfileSlot.BASIC,
    ProfileSlot.STATS,
    ProfileSlot.MASTERY,
    ProfileSlot.ERRORS,
    ProfileSlot.INTERESTS,
    ProfileSlot.BACKGROUND,
    ProfileSlot.STATE,
})
"""出题场景：需要薄弱点、错题分布、兴趣、认知状态"""

SLOTS_FOR_CHAT: frozenset[ProfileSlot] = frozenset({
    ProfileSlot.BASIC,
    ProfileSlot.STATS,
    ProfileSlot.MASTERY,
    ProfileSlot.INTERESTS,
    ProfileSlot.BACKGROUND,
    ProfileSlot.ERRORS,
    ProfileSlot.DURATION,
})
"""聊天场景：需要基础统计、掌握度、兴趣、背景、学习历史"""

SLOTS_FOR_DECISION: frozenset[ProfileSlot] = frozenset({
    ProfileSlot.STATE,
    ProfileSlot.MASTERY,
})
"""决策场景：需要认知状态、掌握度"""

SLOTS_ALL: frozenset[ProfileSlot] = frozenset(ProfileSlot)
"""全量加载"""


@dataclass
class StudentProfile:
    """聚合后的学生画像"""

    student_id: str
    grade: int = 6
    nickname: str = ""

    # 知识层 (MASTERY)
    weak_topics: list[dict] = field(default_factory=list)
    """mastery_score < 0.6 的知识点, 每项: {name, mastery, knowledge_id}"""

    strong_topics: list[dict] = field(default_factory=list)
    """mastery_score >= 0.8 的知识点, 每项: {name, mastery}"""

    # 答题统计 (STATS)
    total_questions: int = 0
    correct_count: int = 0
    accuracy: float = 0.0

    # 错题类型分布 (ERRORS)
    error_distribution: dict[str, int] = field(default_factory=dict)
    """e.g. {"conceptual": 5, "procedural": 3, "careless": 8}"""

    dominant_error_type: str = ""
    """出现最多的错题类型"""

    recent_errors: list[dict] = field(default_factory=list)
    """每项: {content, error_type}"""

    # 兴趣爱好 (INTERESTS)
    interests: list[dict] = field(default_factory=list)
    """每项: {category, name, affinity}"""

    # 学生背景 (BACKGROUND)
    background: dict = field(default_factory=dict)
    """nickname, hobby_summary, dream"""

    # 认知状态 (STATE)
    fatigue: float = 0.0
    frustration: float = 0.0
    consecutive_errors: int = 0

    # 学习历史 (DURATION)
    learning_days: int = 0
    total_duration_minutes: int = 0

    # ── 计算属性 ──

    @property
    def recommended_difficulty(self) -> int:
        """基于画像动态推荐出题难度 (1~5)

        综合考量：
        - 基线：由正确率决定 (50%→2, 70%→3, 85%→4)
        - 疲劳惩罚：fatigue > 0.5 → 降 1 级
        - 连续错误惩罚：consecutive_errors >= 3 → 降 1 级
        - 挫败惩罚：frustration > 0.6 → 降 1 级
        """
        # 基线难度
        if self.total_questions < 5:
            base = 2  # 冷启动默认中等偏低
        elif self.accuracy >= 0.85:
            base = 4
        elif self.accuracy >= 0.7:
            base = 3
        elif self.accuracy >= 0.5:
            base = 2
        else:
            base = 1

        # 负面状态惩罚
        penalty = 0
        if self.fatigue > 0.5:
            penalty += 1
        if self.consecutive_errors >= 3:
            penalty += 1
        if self.frustration > 0.6:
            penalty += 1

        return max(1, min(5, base - penalty))

    @property
    def weak_topic_names(self) -> list[str]:
        """薄弱知识点名称列表 (最多 5 个)"""
        return [t["name"] for t in self.weak_topics[:5]]

    @property
    def interest_context(self) -> str:
        """构建用于 prompt 注入的兴趣描述段落"""
        parts: list[str] = []

        # 兴趣爱好
        if self.interests:
            cat_map = {
                "hobby": "爱好", "book": "读物", "movie": "影视",
                "music": "音乐", "sport": "运动", "food": "美食",
                "family": "家庭", "other": "其他",
            }
            items = [
                f"{cat_map.get(i.get('category', ''), '其他')}:{i['name']}"
                for i in self.interests[:6]
            ]
            parts.append(f"兴趣爱好：{'、'.join(items)}")

        # 背景
        bg = self.background
        if bg.get("hobby_summary"):
            parts.append(f"兴趣简述：{bg['hobby_summary']}")
        if bg.get("dream"):
            parts.append(f"梦想：{bg['dream']}")

        return "\n".join(parts) if parts else ""

    @property
    def error_pattern_hint(self) -> str:
        """基于错题类型分布生成出题指导

        告诉 AI 这个学生容易犯什么错，让出题有针对性。
        """
        if not self.dominant_error_type:
            return ""

        hints = {
            "conceptual": (
                "该学生「概念错误」较多，说明对知识点本质理解不够。"
                "请出一道需要理解概念内涵的题（如判断题或辨析类填空题），"
                "帮助学生厘清易混淆的概念。"
            ),
            "procedural": (
                "该学生「步骤错误」较多，计算过程容易遗漏步骤。"
                "请出一道需要多步骤推理的题，让学生有机会练习完整的解题流程。"
            ),
            "careless": (
                "该学生「粗心错误」较多，经常抄错数字或漏掉符号。"
                "请出一道数值明确、步骤清晰的题，不要设计容易混淆的干扰项。"
                "难度可以适当降低，让学生先养成仔细审题的习惯。"
            ),
            "strategic": (
                "该学生「策略错误」较多，常常选错解法或公式。"
                "请出一道有明确解法方向的题，并在 hint 中暗示应该用哪种方法。"
            ),
        }
        return hints.get(self.dominant_error_type, "")

    def to_chat_context(self) -> dict:
        """转换为 chat.py 的 system_persona_stream_with_context 需要的 ctx 格式"""
        ctx: dict = {}

        if self.total_questions > 0:
            ctx["total_questions"] = self.total_questions
            ctx["correct_count"] = self.correct_count
            ctx["accuracy"] = self.accuracy

        if self.learning_days > 0:
            ctx["learning_days"] = self.learning_days
            ctx["total_duration_minutes"] = self.total_duration_minutes

        if self.weak_topics:
            ctx["weak_topics"] = [
                {"name": t["name"], "mastery": t["mastery"]}
                for t in self.weak_topics[:5]
            ]

        if self.strong_topics:
            ctx["strong_topics"] = self.strong_topics[:3]

        if self.recent_errors:
            ctx["recent_errors"] = self.recent_errors[:3]

        if self.interests:
            ctx["interests"] = self.interests[:6]

        if self.background:
            ctx["background"] = self.background

        return ctx


# ── 插槽加载器 ──

async def _load_basic(db: aiosqlite.Connection, profile: StudentProfile) -> None:
    async with db.execute(
        "SELECT grade, name FROM students WHERE id = ?", (profile.student_id,)
    ) as cur:
        srow = await cur.fetchone()
    if srow:
        profile.grade = int(srow["grade"] or 6)


async def _load_stats(db: aiosqlite.Connection, profile: StudentProfile) -> None:
    async with db.execute(
        """
        SELECT COUNT(*) AS total, SUM(is_correct) AS correct
        FROM answer_records WHERE student_id = ?
        """,
        (profile.student_id,),
    ) as cur:
        agg = await cur.fetchone()
    profile.total_questions = int(agg["total"] or 0)
    profile.correct_count = int(agg["correct"] or 0)
    if profile.total_questions > 0:
        profile.accuracy = profile.correct_count / profile.total_questions


async def _load_mastery(db: aiosqlite.Connection, profile: StudentProfile) -> None:
    async with db.execute(
        """
        SELECT km.knowledge_id, k.name, km.mastery_score
        FROM knowledge_mastery km
        JOIN knowledge_nodes k ON k.id = km.knowledge_id
        WHERE km.student_id = ? AND km.attempt_count > 0
        ORDER BY km.mastery_score ASC
        """,
        (profile.student_id,),
    ) as cur:
        mastery_rows = await cur.fetchall()

    for r in mastery_rows:
        m = float(r["mastery_score"] or 0)
        if m < 0.6:
            profile.weak_topics.append({
                "name": r["name"],
                "mastery": m,
                "knowledge_id": r["knowledge_id"],
            })
        elif m >= 0.8:
            profile.strong_topics.append({
                "name": r["name"],
                "mastery": m,
            })


async def _load_errors(db: aiosqlite.Connection, profile: StudentProfile) -> None:
    # 错题类型分布
    async with db.execute(
        """
        SELECT error_type, COUNT(*) AS cnt
        FROM (
            SELECT error_type FROM answer_records
            WHERE student_id = ? AND is_correct = 0
              AND error_type IS NOT NULL AND error_type NOT IN ('unknown', 'none')
            ORDER BY created_at DESC
            LIMIT 50
        )
        GROUP BY error_type
        ORDER BY cnt DESC
        """,
        (profile.student_id,),
    ) as cur:
        error_rows = await cur.fetchall()

    for r in error_rows:
        etype = r["error_type"]
        if etype:
            profile.error_distribution[etype] = int(r["cnt"])

    if profile.error_distribution:
        profile.dominant_error_type = max(
            profile.error_distribution, key=profile.error_distribution.get  # type: ignore[arg-type]
        )

    # 最近错题内容
    async with db.execute(
        """
        SELECT q.content AS content, ar.error_type
        FROM answer_records ar
        LEFT JOIN questions q ON q.id = ar.question_id
        WHERE ar.student_id = ? AND ar.is_correct = 0
        ORDER BY ar.created_at DESC
        LIMIT 5
        """,
        (profile.student_id,),
    ) as cur:
        recent_err_rows = await cur.fetchall()
    profile.recent_errors = [
        {"content": r["content"], "error_type": r["error_type"]}
        for r in recent_err_rows
    ]


async def _load_interests(db: aiosqlite.Connection, profile: StudentProfile) -> None:
    try:
        async with db.execute(
            """
            SELECT category, name, affinity FROM interest_profile
            WHERE student_id = ?
            ORDER BY affinity DESC
            LIMIT 8
            """,
            (profile.student_id,),
        ) as cur:
            interest_rows = await cur.fetchall()
        profile.interests = [
            {"category": r["category"], "name": r["name"], "affinity": float(r["affinity"] or 0.5)}
            for r in interest_rows
        ]
    except Exception:
        pass  # 表可能不存在


async def _load_background(db: aiosqlite.Connection, profile: StudentProfile) -> None:
    try:
        async with db.execute(
            "SELECT nickname, hobby_summary, dream FROM student_background WHERE student_id = ?",
            (profile.student_id,),
        ) as cur:
            bg_row = await cur.fetchone()
        if bg_row:
            bg: dict = {}
            if bg_row["nickname"]:
                bg["nickname"] = bg_row["nickname"]
                profile.nickname = bg_row["nickname"]
            if bg_row["hobby_summary"]:
                bg["hobby_summary"] = bg_row["hobby_summary"]
            if bg_row["dream"]:
                bg["dream"] = bg_row["dream"]
            if bg:
                profile.background = bg
    except Exception:
        pass  # 表可能不存在


async def _load_state(db: aiosqlite.Connection, profile: StudentProfile) -> None:
    async with db.execute(
        "SELECT * FROM student_states WHERE student_id = ?", (profile.student_id,)
    ) as cur:
        state_row = await cur.fetchone()
    if state_row:
        cols = state_row.keys()
        profile.fatigue = float(
            state_row["fatigue_level"] if "fatigue_level" in cols else state_row.get("fatigue", 0)
        )
        profile.frustration = float(state_row["frustration"]) if "frustration" in cols else 0.0
        profile.consecutive_errors = int(state_row["consecutive_errors"]) if "consecutive_errors" in cols else 0


async def _load_duration(db: aiosqlite.Connection, profile: StudentProfile) -> None:
    async with db.execute(
        """
        SELECT COUNT(DISTINCT stat_date) AS learning_days,
               COALESCE(SUM(total_duration_secs), 0) AS total_secs
        FROM daily_stats WHERE student_id = ?
        """,
        (profile.student_id,),
    ) as cur:
        ds = await cur.fetchone()
    profile.learning_days = int(ds["learning_days"] or 0)
    profile.total_duration_minutes = int((ds["total_secs"] or 0) / 60)


# 插槽 → 加载函数的映射
_SLOT_LOADERS: dict = {
    ProfileSlot.BASIC: _load_basic,
    ProfileSlot.STATS: _load_stats,
    ProfileSlot.MASTERY: _load_mastery,
    ProfileSlot.ERRORS: _load_errors,
    ProfileSlot.INTERESTS: _load_interests,
    ProfileSlot.BACKGROUND: _load_background,
    ProfileSlot.STATE: _load_state,
    ProfileSlot.DURATION: _load_duration,
}


async def gather_student_profile(
    db: aiosqlite.Connection,
    student_id: str,
    *,
    slots: frozenset[ProfileSlot] | set[ProfileSlot] = SLOTS_ALL,
) -> StudentProfile:
    """从数据库按需聚合学生画像

    Args:
        db: 数据库连接
        student_id: 学生 ID
        slots: 要加载的数据维度集合，默认全量加载。
               推荐使用预定义组合：
               - SLOTS_FOR_QUIZ  → 出题
               - SLOTS_FOR_CHAT  → 对话
               - SLOTS_FOR_DECISION → 决策

    Returns:
        StudentProfile 实例，仅填充了 slots 指定的维度

    Example:
        # 出题场景：只加载出题需要的维度
        profile = await gather_student_profile(db, sid, slots=SLOTS_FOR_QUIZ)

        # 聊天场景：只加载聊天需要的维度
        profile = await gather_student_profile(db, sid, slots=SLOTS_FOR_CHAT)

        # 自定义：只要兴趣和背景
        profile = await gather_student_profile(db, sid, slots={
            ProfileSlot.INTERESTS, ProfileSlot.BACKGROUND,
        })
    """
    profile = StudentProfile(student_id=student_id)

    loaded_slots: list[str] = []
    for slot in ProfileSlot:
        if slot in slots:
            loader = _SLOT_LOADERS.get(slot)
            if loader:
                await loader(db, profile)
                loaded_slots.append(slot.name)

    logger.info(
        "StudentProfile[%s] loaded slots=[%s] → "
        "%d questions, %d weak, %d interests, difficulty=%d, error=%s",
        student_id,
        ",".join(loaded_slots),
        profile.total_questions,
        len(profile.weak_topics),
        len(profile.interests),
        profile.recommended_difficulty,
        profile.dominant_error_type or "none",
    )

    return profile
