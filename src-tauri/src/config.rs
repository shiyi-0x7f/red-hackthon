/// 应用配置
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct AppConfig {
    pub llm: LLMConfig,
    pub pacing: PacingConfig,
}

/// LLM 配置
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct LLMConfig {
    pub provider: String,
    pub api_base: String,
    pub default_model: String,
    pub available_models: Vec<ModelInfo>,
}

/// 模型信息
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    pub tag: String,
}

/// 节奏控制配置
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct PacingConfig {
    /// 单次学习最大时长（分钟）
    pub max_session_duration: i32,
    /// 每日聊天上限（分钟）
    pub max_chat_per_day: i32,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            llm: LLMConfig {
                provider: "siliconflow".to_string(),
                api_base: "https://api.siliconflow.cn/v1".to_string(),
                default_model: "deepseek-ai/DeepSeek-V3".to_string(),
                available_models: vec![
                    ModelInfo {
                        id: "deepseek-ai/DeepSeek-V3".to_string(),
                        name: "DeepSeek V3".to_string(),
                        tag: "推荐".to_string(),
                    },
                    ModelInfo {
                        id: "Qwen/Qwen2.5-72B-Instruct".to_string(),
                        name: "通义千问 72B".to_string(),
                        tag: "通用".to_string(),
                    },
                    ModelInfo {
                        id: "THUDM/glm-4-9b-chat".to_string(),
                        name: "GLM-4 9B".to_string(),
                        tag: "轻量".to_string(),
                    },
                ],
            },
            pacing: PacingConfig {
                max_session_duration: 30,
                max_chat_per_day: 20,
            },
        }
    }
}
