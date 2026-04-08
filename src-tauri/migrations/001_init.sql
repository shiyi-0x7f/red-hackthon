-- AI 学习系统初始化迁移
-- 001_init.sql

-- 学生表
CREATE TABLE IF NOT EXISTS students (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    grade INTEGER NOT NULL CHECK(grade BETWEEN 1 AND 6),
    avatar TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 知识点表
CREATE TABLE IF NOT EXISTS knowledge_nodes (
    id TEXT PRIMARY KEY,
    parent_id TEXT REFERENCES knowledge_nodes(id),
    name TEXT NOT NULL,
    grade INTEGER NOT NULL,
    semester INTEGER NOT NULL DEFAULT 1,
    unit INTEGER NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    description TEXT,
    prerequisites TEXT -- JSON 数组: 前置知识点 ID
);

-- 题目表
CREATE TABLE IF NOT EXISTS questions (
    id TEXT PRIMARY KEY,
    knowledge_id TEXT NOT NULL REFERENCES knowledge_nodes(id),
    question_type TEXT NOT NULL, -- 'choice', 'fill', 'calculation', 'word_problem'
    difficulty INTEGER NOT NULL CHECK(difficulty BETWEEN 1 AND 5),
    content TEXT NOT NULL, -- JSON: 题目内容
    answer TEXT NOT NULL,  -- JSON: 标准答案
    explanation TEXT,      -- 解题思路
    hints TEXT,            -- JSON 数组: 分层提示
    source TEXT,           -- 来源（教材/自编等）
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 学习会话表
CREATE TABLE IF NOT EXISTS learning_sessions (
    id TEXT PRIMARY KEY,
    student_id TEXT NOT NULL REFERENCES students(id),
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    ended_at TEXT,
    end_reason TEXT, -- 'completed', 'timeout', 'user_quit', 'forced'
    total_questions INTEGER NOT NULL DEFAULT 0,
    correct_count INTEGER NOT NULL DEFAULT 0,
    total_duration_secs INTEGER
);

-- 答题记录表
CREATE TABLE IF NOT EXISTS answer_records (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES learning_sessions(id),
    question_id TEXT NOT NULL REFERENCES questions(id),
    student_id TEXT NOT NULL REFERENCES students(id),
    student_answer TEXT NOT NULL, -- JSON
    is_correct INTEGER NOT NULL DEFAULT 0,
    time_spent_secs INTEGER NOT NULL DEFAULT 0,
    hint_used INTEGER NOT NULL DEFAULT 0, -- 使用了几层提示
    error_type TEXT, -- 'calculation', 'concept', 'reading', 'careless'
    ai_feedback TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 知识掌握度表
CREATE TABLE IF NOT EXISTS knowledge_mastery (
    student_id TEXT NOT NULL REFERENCES students(id),
    knowledge_id TEXT NOT NULL REFERENCES knowledge_nodes(id),
    mastery_score REAL NOT NULL DEFAULT 0.3,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    correct_count INTEGER NOT NULL DEFAULT 0,
    last_practiced_at TEXT,
    forgetting_risk REAL NOT NULL DEFAULT 0.0,
    bkt_p_know REAL NOT NULL DEFAULT 0.3,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (student_id, knowledge_id)
);

-- 对话记录表
CREATE TABLE IF NOT EXISTS chat_records (
    id TEXT PRIMARY KEY,
    student_id TEXT NOT NULL REFERENCES students(id),
    session_id TEXT REFERENCES learning_sessions(id),
    role TEXT NOT NULL, -- 'user', 'assistant'
    content TEXT NOT NULL,
    context_type TEXT, -- 'learning', 'casual', 'encouragement'
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 每日统计表
CREATE TABLE IF NOT EXISTS daily_stats (
    student_id TEXT NOT NULL REFERENCES students(id),
    stat_date TEXT NOT NULL,
    total_duration_secs INTEGER NOT NULL DEFAULT 0,
    chat_duration_secs INTEGER NOT NULL DEFAULT 0,
    session_count INTEGER NOT NULL DEFAULT 0,
    question_count INTEGER NOT NULL DEFAULT 0,
    correct_count INTEGER NOT NULL DEFAULT 0,
    new_knowledge_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (student_id, stat_date)
);

-- 系统设置表
CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_answer_records_student ON answer_records(student_id);
CREATE INDEX IF NOT EXISTS idx_answer_records_session ON answer_records(session_id);
CREATE INDEX IF NOT EXISTS idx_learning_sessions_student ON learning_sessions(student_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_mastery_student ON knowledge_mastery(student_id);
CREATE INDEX IF NOT EXISTS idx_chat_records_student ON chat_records(student_id);
CREATE INDEX IF NOT EXISTS idx_daily_stats_date ON daily_stats(stat_date);
CREATE INDEX IF NOT EXISTS idx_questions_knowledge ON questions(knowledge_id);
