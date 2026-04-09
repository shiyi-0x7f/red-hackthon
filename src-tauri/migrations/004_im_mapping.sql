-- AstrBot / IM 平台集成专用表
-- 把 IM 平台 user id 映射为内部 student_id，实现多平台共享学习数据

CREATE TABLE IF NOT EXISTS im_user_mappings (
    platform TEXT NOT NULL,           -- 'qq' | 'wechat' | 'feishu' | 'telegram' | 'im'
    platform_user_id TEXT NOT NULL,
    student_id TEXT NOT NULL REFERENCES students(id),
    display_name TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (platform, platform_user_id)
);

CREATE INDEX IF NOT EXISTS idx_im_user_mappings_student
    ON im_user_mappings(student_id);
