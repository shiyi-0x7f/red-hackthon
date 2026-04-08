use thiserror::Error;

/// 应用统一错误类型
#[derive(Error, Debug)]
pub enum AppError {
    #[error("数据库错误: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("序列化错误: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("网络请求错误: {0}")]
    Network(#[from] reqwest::Error),

    #[error("IO 错误: {0}")]
    Io(#[from] std::io::Error),

    #[error("未找到: {0}")]
    NotFound(String),

    #[error("参数无效: {0}")]
    InvalidInput(String),

    #[error("LLM 调用失败: {0}")]
    LLMError(String),

    #[error("内部错误: {0}")]
    Internal(String),
}

/// 为 Tauri Command 实现 Serialize（返回错误信息给前端）
impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::ser::Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}

/// 应用 Result 类型别名
pub type AppResult<T> = Result<T, AppError>;
