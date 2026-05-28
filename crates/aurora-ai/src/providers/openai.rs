use async_trait::async_trait;
use futures_util::StreamExt;
use reqwest::header::{HeaderMap, HeaderValue};
use serde_json::Value;
use aurora_core::AppError;
use aurora_core::types::ai::{TaskTier, AiMessage, AIStreamChunkEvent};
use crate::providers::AiProvider;
use crate::client::{AiHttpClient, SseLineReader};
use tauri::Emitter;

pub struct OpenAiCompatProvider {
    pub client: reqwest::Client,
    pub api_key: String,
    pub base_url: String,
    pub fast_model: String,
    pub balanced_model: String,
    pub powerful_model: String,
}

impl OpenAiCompatProvider {
    pub fn new(
        api_key: String,
        base_url: Option<String>,
        fast_model: String,
        balanced_model: String,
        powerful_model: String,
    ) -> Self {
        let http_client = AiHttpClient::new();
        let final_base_url = base_url.unwrap_or_else(|| "https://api.openai.com/v1".to_string());
        Self {
            client: http_client.client,
            api_key,
            base_url: final_base_url,
            fast_model,
            balanced_model,
            powerful_model,
        }
    }
}

#[async_trait]
impl AiProvider for OpenAiCompatProvider {
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
        
        headers.insert(
            "Authorization",
            HeaderValue::from_str(&format!("Bearer {}", self.api_key))
                .map_err(|_| AppError::Ai("Invalid API Key format".to_string()))?,
        );
        headers.insert("content-type", HeaderValue::from_static("application/json"));

        let body = serde_json::json!({
            "model": model,
            "messages": messages,
            "stream": true,
            "max_tokens": match tier {
                TaskTier::Fast => 200,
                TaskTier::Balanced => 800,
                TaskTier::Powerful => 3000,
            }
        });

        let endpoint = format!("{}/chat/completions", self.base_url);
        let res = self.client
            .post(&endpoint)
            .headers(headers)
            .json(&body)
            .send()
            .await
            .map_err(|e| AppError::Ai(format!("Failed to send request to OpenAI compat provider: {}", e)))?;

        if !res.status().is_success() {
            let error_text = res.text().await.unwrap_or_default();
            return Err(AppError::Ai(format!("OpenAI compat API error: {}", error_text)));
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
                        if let Some(text) = parsed["choices"][0]["delta"]["content"].as_str() {
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

        // Emit final done event
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
