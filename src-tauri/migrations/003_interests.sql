-- 003_interests.sql
-- 兴趣画像层：了解学生爱好 / 阅读 / 背景，用于 AI 出题情境化 + RAG 对话

CREATE TABLE IF NOT EXISTS interest_profile (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id TEXT NOT NULL,
    category TEXT NOT NULL,       -- 'hobby' | 'book' | 'movie' | 'music' | 'sport' | 'food' | 'other'
    name TEXT NOT NULL,           -- 具体条目，如 "哆啦A梦" / "足球" / "钢琴"
    affinity REAL NOT NULL DEFAULT 0.8,  -- 0~1 强度（manual 默认 0.8，LLM 抽取后可调整）
    source TEXT NOT NULL,         -- 'manual' 学生输入 | 'extracted' LLM 从对话提取
    notes TEXT,                   -- 可选补充说明
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(student_id, category, name)
);
CREATE INDEX IF NOT EXISTS idx_interest_profile_student ON interest_profile(student_id);
CREATE INDEX IF NOT EXISTS idx_interest_profile_category ON interest_profile(category);

-- 学生背景信息（单行一人，比如家庭成员、学校、兴趣简述等）
CREATE TABLE IF NOT EXISTS student_background (
    student_id TEXT PRIMARY KEY,
    nickname TEXT,                -- 学生希望被叫的名字
    school TEXT,                  -- 学校（非必填）
    hobby_summary TEXT,           -- 兴趣一句话简述
    family_notes TEXT,            -- 家庭背景简述
    dream TEXT,                   -- 长大想做什么
    extra_json TEXT,              -- 预留 JSON 字段
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
