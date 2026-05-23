use async_trait::async_trait;
use futures_util::StreamExt;
use reqwest::header::{HeaderMap, HeaderValue};
use serde_json::Value;
use crate::error::AppError;
use crate::ai::router::TaskTier;
use crate::ai::providers::{AiProvider, AiMessage, AIStreamChunkEvent};
use crate::ai::client::{AiHttpClient, SseLineReader};
use tauri::Emitter;

pub struct GeminiProvider {
    pub client: reqwest::Client,
    pub api_key: String,
    pub fast_model: String,
    pub balanced_model: String,
    pub powerful_model: String,
}

impl GeminiProvider {
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
impl AiProvider for GeminiProvider {
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
        headers.insert("x-goog-api-key", HeaderValue::from_str(&self.api_key)
            .map_err(|_| AppError::Ai("Invalid Gemini API Key format".to_string()))?);
        headers.insert("content-type", HeaderValue::from_static("application/json"));

        let mut system_instruction = String::new();
        let mut contents = Vec::new();

        for msg in messages {
            if msg.role == "system" {
                system_instruction = msg.content;
            } else {
                let role = if msg.role == "assistant" {
                    "model"
                } else {
                    "user"
                };
                contents.push(serde_json::json!({
                    "role": role,
                    "parts": [{"text": msg.content}]
                }));
            }
        }

        let mut body = serde_json::json!({
            "contents": contents,
            "generationConfig": {
                "maxOutputTokens": match tier {
                    TaskTier::Fast => 200,
                    TaskTier::Balanced => 800,
                    TaskTier::Powerful => 3000,
                }
            }
        });

        if !system_instruction.is_empty() {
            body.as_object_mut().unwrap().insert(
                "systemInstruction".to_string(),
                serde_json::json!({
                    "parts": [{"text": system_instruction}]
                }),
            );
        }

        let endpoint = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{}:streamGenerateContent?alt=sse",
            model
        );

        let res = self.client
            .post(&endpoint)
            .headers(headers)
            .json(&body)
            .send()
            .await
            .map_err(|e| AppError::Ai(format!("Failed to send request to Gemini: {}", e)))?;

        if !res.status().is_success() {
            let error_text = res.text().await.unwrap_or_default();
            return Err(AppError::Ai(format!("Gemini API error: {}", error_text)));
        }

        let mut stream = res.bytes_stream();
        let mut reader = SseLineReader::new();

        while let Some(chunk_result) = stream.next().await {
            let bytes = chunk_result.map_err(|e| AppError::Ai(format!("Stream error: {}", e)))?;
            let lines = reader.feed(&bytes);

            for line in lines {
                if line.starts_with("data:") {
                    let data_json = line["data:".len()..].trim();
                    if let Ok(parsed) = serde_json::from_str::<Value>(data_json) {
                        if let Some(text) = parsed["candidates"][0]["content"]["parts"][0]["text"].as_str() {
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
