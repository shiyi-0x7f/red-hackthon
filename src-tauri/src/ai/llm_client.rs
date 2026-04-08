use serde::{Deserialize, Serialize};
use crate::error::{AppError, AppResult};

/// LLM 消息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub role: String,
    pub content: String,
}

/// LLM 调用选项
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LLMOptions {
    pub temperature: Option<f64>,
    pub max_tokens: Option<i32>,
    pub top_p: Option<f64>,
}

impl Default for LLMOptions {
    fn default() -> Self {
        Self {
            temperature: Some(0.7),
            max_tokens: Some(2048),
            top_p: Some(0.9),
        }
    }
}

/// 硅基流动 LLM 客户端
#[derive(Clone)]
pub struct LLMClient {
    api_base: String,
    api_key: String,
    model: String,
    client: reqwest::Client,
}

/// OpenAI 兼容响应结构
#[derive(Debug, Deserialize)]
struct ChatCompletionResponse {
    choices: Vec<Choice>,
}

#[derive(Debug, Deserialize)]
struct Choice {
    message: ResponseMessage,
}

#[derive(Debug, Deserialize)]
struct ResponseMessage {
    content: String,
}

/// 流式 chunk 结构
#[derive(Debug, Deserialize)]
struct StreamChunk {
    choices: Vec<StreamChoice>,
}

#[derive(Debug, Deserialize)]
struct StreamChoice {
    delta: StreamDelta,
    #[serde(default)]
    finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct StreamDelta {
    #[serde(default)]
    content: Option<String>,
}

impl LLMClient {
    /// 创建新的 LLM 客户端
    pub fn new(api_base: &str, api_key: &str, model: &str) -> Self {
        Self {
            api_base: api_base.to_string(),
            api_key: api_key.to_string(),
            model: model.to_string(),
            client: reqwest::Client::new(),
        }
    }

    /// 普通完成（等待完整响应）
    pub async fn complete(&self, messages: &[Message], opts: &LLMOptions) -> AppResult<String> {
        let url = format!("{}/chat/completions", self.api_base);

        let body = serde_json::json!({
            "model": self.model,
            "messages": messages,
            "temperature": opts.temperature.unwrap_or(0.7),
            "max_tokens": opts.max_tokens.unwrap_or(2048),
            "top_p": opts.top_p.unwrap_or(0.9),
            "stream": false
        });

        let response = self.client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| AppError::LLMError(format!("请求失败: {}", e)))?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Err(AppError::LLMError(format!("API 返回 {}: {}", status, text)));
        }

        let result: ChatCompletionResponse = response.json().await
            .map_err(|e| AppError::LLMError(format!("解析响应失败: {}", e)))?;

        result.choices.first()
            .map(|c| c.message.content.clone())
            .ok_or_else(|| AppError::LLMError("响应中无 choices".to_string()))
    }

    /// 流式完成 — 通过回调函数逐 token 输出
    pub async fn complete_stream<F>(
        &self,
        messages: &[Message],
        opts: &LLMOptions,
        mut on_chunk: F,
    ) -> AppResult<String>
    where
        F: FnMut(&str),
    {
        let url = format!("{}/chat/completions", self.api_base);

        let body = serde_json::json!({
            "model": self.model,
            "messages": messages,
            "temperature": opts.temperature.unwrap_or(0.7),
            "max_tokens": opts.max_tokens.unwrap_or(2048),
            "top_p": opts.top_p.unwrap_or(0.9),
            "stream": true
        });

        let response = self.client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| AppError::LLMError(format!("请求失败: {}", e)))?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Err(AppError::LLMError(format!("API 返回 {}: {}", status, text)));
        }

        let mut full_content = String::new();
        let mut buffer = String::new();

        // 使用 bytes_stream 逐块读取
        use futures::StreamExt;
        let mut stream = response.bytes_stream();

        while let Some(chunk_result) = stream.next().await {
            let chunk = chunk_result
                .map_err(|e| AppError::LLMError(format!("读取流失败: {}", e)))?;

            let text = String::from_utf8_lossy(&chunk);
            buffer.push_str(&text);

            // SSE 格式：每行以 "data: " 开头
            while let Some(line_end) = buffer.find('\n') {
                let line = buffer[..line_end].trim().to_string();
                buffer = buffer[line_end + 1..].to_string();

                if line.is_empty() || line == "data: [DONE]" {
                    continue;
                }

                if let Some(json_str) = line.strip_prefix("data: ") {
                    if let Ok(chunk) = serde_json::from_str::<StreamChunk>(json_str) {
                        for choice in &chunk.choices {
                            if let Some(ref content) = choice.delta.content {
                                full_content.push_str(content);
                                on_chunk(content);
                            }
                        }
                    }
                }
            }
        }

        Ok(full_content)
    }

    /// 切换模型
    pub fn set_model(&mut self, model_id: &str) {
        self.model = model_id.to_string();
        tracing::info!("LLM 模型切换为: {}", model_id);
    }

    /// 获取当前模型
    pub fn current_model(&self) -> &str {
        &self.model
    }
}
