use std::sync::Mutex;
use dashmap::DashMap;
use rusqlite::Connection;
use tauri::{AppHandle, Manager};

use crate::db;
use crate::ai::llm_client::LLMClient;
use crate::services::question_bank::{QuestionBank, BaseQuestion};

/// 学生实时状态（内存缓存）
#[derive(Debug, Clone, serde::Serialize)]
pub struct StudentRuntimeState {
    pub student_id: String,
    pub current_session_id: Option<String>,
    pub fatigue_level: f64,
    pub consecutive_errors: i32,
    pub session_duration_secs: i64,
    pub last_activity_at: chrono::DateTime<chrono::Utc>,
    /// 会话开始时间
    pub session_start_at: chrono::DateTime<chrono::Utc>,
    /// 本次会话总答题数
    pub total_questions: i32,
    /// 本次会话正确数
    pub correct_count: i32,
}

/// 全局应用状态
pub struct AppState {
    /// SQLite 数据库连接
    pub db: Mutex<Connection>,
    /// 学生实时状态缓存
    pub student_states: DashMap<String, StudentRuntimeState>,
    /// 应用数据目录
    pub data_dir: std::path::PathBuf,
    /// 基础题库
    pub question_bank: QuestionBank,
    /// LLM 客户端（可选，有 API Key 时可用）
    pub llm_client: Mutex<Option<LLMClient>>,
    /// AI 动态生成的题目缓存（key=question_id），让 submit_answer 能找到
    pub ai_questions: DashMap<String, BaseQuestion>,
    /// 对话节奏跟踪（key=student_id）
    pub chat_pacing: DashMap<String, ChatPacingState>,
}

/// 对话节奏状态
#[derive(Debug, Clone)]
pub struct ChatPacingState {
    /// 当前对话开始时间（None 表示无活跃对话）
    pub session_started_at: Option<chrono::DateTime<chrono::Utc>>,
    /// 当前对话累计秒数
    pub accumulated_secs: i64,
    /// 冷却开始时间（None 表示不在冷却中）
    pub cooldown_started_at: Option<chrono::DateTime<chrono::Utc>>,
}

impl Default for ChatPacingState {
    fn default() -> Self {
        Self {
            session_started_at: None,
            accumulated_secs: 0,
            cooldown_started_at: None,
        }
    }
}

impl AppState {
    /// 创建新的应用状态
    pub fn new(app_handle: &AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        // Tauri 2: 使用 Manager trait 的 path() 方法
        let data_dir = app_handle
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| std::path::PathBuf::from("."));

        // 确保目录存在
        std::fs::create_dir_all(&data_dir)?;

        let db_path = data_dir.join("ai_learning.db");
        tracing::info!("数据库路径: {:?}", db_path);

        let conn = Connection::open(&db_path)?;
        // 启用 WAL 模式提高并发性能
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;

        // 加载基础题库
        let question_bank = Self::load_question_bank(app_handle)?;

        // 尝试初始化 LLM 客户端
        let llm_client = Self::init_llm_client(&conn);

        Ok(Self {
            db: Mutex::new(conn),
            student_states: DashMap::new(),
            data_dir,
            question_bank,
            llm_client: Mutex::new(llm_client),
            ai_questions: DashMap::new(),
            chat_pacing: DashMap::new(),
        })
    }

    /// 初始化 LLM 客户端（从数据库读取 API Key）
    fn init_llm_client(conn: &Connection) -> Option<LLMClient> {
        let api_key: Option<String> = conn.query_row(
            "SELECT value FROM app_settings WHERE key = 'api_key'",
            [],
            |row| row.get(0),
        ).ok();

        if let Some(key) = api_key {
            if !key.is_empty() {
                tracing::info!("LLM 客户端已初始化");
                return Some(LLMClient::new(
                    "https://api.siliconflow.cn/v1",
                    &key,
                    "deepseek-ai/DeepSeek-V3",
                ));
            }
        }

        tracing::warn!("未配置 API Key，LLM 功能不可用");
        None
    }

    /// 加载基础题库
    fn load_question_bank(app_handle: &AppHandle) -> Result<QuestionBank, Box<dyn std::error::Error>> {
        // 尝试从 Tauri 资源目录加载
        let resource_path = app_handle
            .path()
            .resolve("data/grade6_math_practice_questions_latex.json", tauri::path::BaseDirectory::Resource);

        let json_str = if let Ok(path) = resource_path {
            if path.exists() {
                tracing::info!("从资源目录加载题库: {:?}", path);
                std::fs::read_to_string(&path)?
            } else {
                Self::load_fallback_question_bank()?
            }
        } else {
            Self::load_fallback_question_bank()?
        };

        QuestionBank::from_json(&json_str).map_err(|e| e.into())
    }

    /// 回退加载 — 从项目目录中查找题库
    fn load_fallback_question_bank() -> Result<String, Box<dyn std::error::Error>> {
        // 开发环境：从项目 data 目录加载
        let dev_paths = [
            "data/grade6_math_practice_questions_latex.json",
            "../data/grade6_math_practice_questions_latex.json",
            "../../data/grade6_math_practice_questions_latex.json",
        ];
        for path in &dev_paths {
            let p = std::path::Path::new(path);
            if p.exists() {
                tracing::info!("从开发目录加载题库: {:?}", p);
                return Ok(std::fs::read_to_string(p)?);
            }
        }

        // 最终回退：使用内嵌的最小题库
        tracing::warn!("未找到题库文件，使用内嵌空题库");
        Ok(r#"{"学期":{}}"#.to_string())
    }

    /// 运行数据库迁移
    pub fn run_migrations(&self) -> Result<(), Box<dyn std::error::Error>> {
        let conn = self.db.lock().map_err(|e| format!("锁定数据库失败: {}", e))?;
        db::migrations::run_all(&conn)?;
        tracing::info!("数据库迁移完成");
        Ok(())
    }
}
