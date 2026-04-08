use super::llm_client::Message;
use super::prompts;

/// Prompt 构建器
/// 
/// 负责将学生画像、记忆、上下文动态注入 Prompt
pub struct PromptBuilder {
    grade: i32,
    messages: Vec<Message>,
}

impl PromptBuilder {
    /// 创建新的构建器
    pub fn new(grade: i32) -> Self {
        Self {
            grade,
            messages: vec![
                Message {
                    role: "system".to_string(),
                    content: prompts::system_persona(grade),
                },
            ],
        }
    }

    /// 添加用户消息
    pub fn add_user_message(mut self, content: &str) -> Self {
        self.messages.push(Message {
            role: "user".to_string(),
            content: content.to_string(),
        });
        self
    }

    /// 添加助手消息
    pub fn add_assistant_message(mut self, content: &str) -> Self {
        self.messages.push(Message {
            role: "assistant".to_string(),
            content: content.to_string(),
        });
        self
    }

    /// 构建消息列表
    pub fn build(self) -> Vec<Message> {
        self.messages
    }
}
