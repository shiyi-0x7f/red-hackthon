-- 002_p0_features.sql
-- 黑客松 P0 补全：行为层 / 状态层持久化 / 事件日志 / 提示记录

-- 行为特征快照（每次提交答案后写入一行，供决策引擎和家长端用）
CREATE TABLE IF NOT EXISTS behavior_features (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id TEXT NOT NULL REFERENCES students(id),
    session_id TEXT REFERENCES learning_sessions(id),
    -- 滑动窗口指标
    avg_response_time REAL NOT NULL DEFAULT 0.0,
    response_time_std REAL NOT NULL DEFAULT 0.0,
    accuracy_rate REAL NOT NULL DEFAULT 0.0,
    hint_usage_rate REAL NOT NULL DEFAULT 0.0,
    max_consecutive_errors INTEGER NOT NULL DEFAULT 0,
    -- 衍生评分（决策引擎用）
    impulsivity REAL NOT NULL DEFAULT 0.0,    -- 冲动答题倾向（响应时间过短的占比）
    hint_dependency REAL NOT NULL DEFAULT 0.0, -- 提示依赖度（>= hint_usage_rate 的平滑值）
    sample_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_behavior_features_student ON behavior_features(student_id);
CREATE INDEX IF NOT EXISTS idx_behavior_features_session ON behavior_features(session_id);

-- 学生状态快照（替代纯内存的 DashMap，提供持久化历史）
CREATE TABLE IF NOT EXISTS student_states (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id TEXT NOT NULL REFERENCES students(id),
    session_id TEXT REFERENCES learning_sessions(id),
    fatigue_level REAL NOT NULL DEFAULT 0.0,
    attention_level REAL NOT NULL DEFAULT 1.0,
    frustration REAL NOT NULL DEFAULT 0.0,
    cognitive_load REAL NOT NULL DEFAULT 0.0,
    consecutive_errors INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_student_states_student ON student_states(student_id);

-- 事件日志（行为流，覆盖：答题/提示/讲解/会话切换）
CREATE TABLE IF NOT EXISTS event_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id TEXT NOT NULL,
    session_id TEXT,
    event_type TEXT NOT NULL,  -- 'answer_submit' | 'hint_request' | 'explanation_request' | 'session_start' | 'session_end' | 'next_action'
    payload TEXT,              -- JSON 字符串（事件相关数据）
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_event_logs_student ON event_logs(student_id);
CREATE INDEX IF NOT EXISTS idx_event_logs_type ON event_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_event_logs_created ON event_logs(created_at);

-- 提示记录（每个题每个学生用了哪几层提示）
CREATE TABLE IF NOT EXISTS hint_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id TEXT NOT NULL,
    session_id TEXT,
    question_id TEXT NOT NULL,
    hint_level INTEGER NOT NULL,  -- 1=light, 2=guided, 3=step
    hint_text TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_hint_records_student ON hint_records(student_id);
CREATE INDEX IF NOT EXISTS idx_hint_records_question ON hint_records(question_id);

-- 讲解缓存（同一题目的 LLM 讲解 + 可视化 spec 缓存，节省 token）
CREATE TABLE IF NOT EXISTS explanations (
    question_id TEXT PRIMARY KEY,
    explanation_text TEXT NOT NULL,
    visual_spec TEXT,  -- JSON: JSXGraph or fraction-bar spec
    model TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
