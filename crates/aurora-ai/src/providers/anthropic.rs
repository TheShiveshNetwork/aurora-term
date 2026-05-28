use async_trait::async_trait;
use futures_util::StreamExt;
use reqwest::header::{HeaderMap, HeaderValue};
use serde::Deserialize;
use serde_json::Value;
use aurora_core::AppError;
use aurora_core::types::ai::{TaskTier, AiMessage, AIStreamChunkEvent};
use crate::providers::AiProvider;
use crate::client::{AiHttpClient, SseLineReader};
use tauri::Emitter;

pub struct AnthropicProvider {
    pub client: reqwest::Client,
    pub api_key: String,
    pub fast_model: String,
    pub balanced_model: String,
    pub powerful_model: String,
}

impl AnthropicProvider {
    pub fn new(
        api_key: String,
        fast_model: String,
        balanced_model: String,
        powerful_model: String,
    ) -> Self {
        let http_client = AiHttpClient::new();
        Self {
            client: http_client.client,
            api_key,
            fast_model,
            balanced_model,
            powerful_model,
        }
    }
}

#[async_trait]
impl AiProvider for AnthropicProvider {
    fn model_for_tier(&self, tier: TaskTier) -> &str {
        match tier {
            TaskTier::Fast => &self.fast_model,
            TaskTier::Balanced => &self.balanced_model,
            TaskTier::Powerful => &self.powerful_model,
        }
    }

    async fn stream_completion(
        &self,
        messages: Vec<AiMessage>,
        tier: TaskTier,
        window: tauri::Window,
        request_id: String,
    ) -> Result<(), AppError> {
        let model = self.model_for_tier(tier);
        let mut headers = HeaderMap::new();
        
        headers.insert("x-api-key", HeaderValue::from_str(&self.api_key)
            .map_err(|_| AppError::Ai("Invalid Anthropic API Key".to_string()))?);
        headers.insert("anthropic-version", HeaderValue::from_static("2023-06-01"));
        headers.insert("content-type", HeaderValue::from_static("application/json"));

        // Extract system prompt if present
        let mut system_prompt = String::new();
        let mut api_messages = Vec::new();

        for msg in messages {
            if msg.role == "system" {
                system_prompt = msg.content;
            } else {
                api_messages.push(serde_json::json!({
                    "role": msg.role,
                    "content": msg.content
                }));
            }
        }

        let mut body = serde_json::json!({
            "model": model,
            "max_tokens": match tier {
                TaskTier::Fast => 200,
                TaskTier::Balanced => 800,
                TaskTier::Powerful => 3000,
            },
            "messages": api_messages,
            "stream": true
        });

        if !system_prompt.is_empty() {
            body.as_object_mut().unwrap().insert("system".to_string(), Value::String(system_prompt));
        }

        let res = self.client
            .post("https://api.anthropic.com/v1/messages")
            .headers(headers)
            .json(&body)
            .send()
            .await
            .map_err(|e| AppError::Ai(format!("Failed to send request to Anthropic: {}", e)))?;

        if !res.status().is_success() {
            let error_text = res.text().await.unwrap_or_default();
            return Err(AppError::Ai(format!("Anthropic API error: {}", error_text)));
        }

        let mut stream = res.bytes_stream();
        let mut reader = SseLineReader::new();

        while let Some(chunk_result) = stream.next().await {
            let bytes = chunk_result.map_err(|e| AppError::Ai(format!("Stream error: {}", e)))?;
            let lines = reader.feed(&bytes);

            for line in lines {
                if line.starts_with("data:") {
                    let data_json = line["data:".len()..].trim();
                    if data_json == "[DONE]" {
                        break;
                    }
                    if let Ok(parsed) = serde_json::from_str::<Value>(data_json) {
                        if parsed["type"] == "content_block_delta" {
                            if let Some(text) = parsed["delta"]["text"].as_str() {
                                let _ = window.emit(
                                    "ai_stream_chunk",
                                    AIStreamChunkEvent {
                                        request_id: request_id.clone(),
                                        chunk: text.to_string(),
                                        done: false,
                                    },
                                );
                            }
                        }
                    }
                }
            }
        }

        // Emit standard final done event
        let _ = window.emit(
            "ai_stream_chunk",
            AIStreamChunkEvent {
                request_id: request_id.clone(),
                chunk: "".to_string(),
                done: true,
            },
        );

        Ok(())
    }
}
