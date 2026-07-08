use async_trait::async_trait;
use futures_util::StreamExt;
use reqwest::header::{HeaderMap, HeaderValue};
use serde_json::Value;
use aurora_core::AppError;
use aurora_core::types::ai::{TaskTier, AiMessage, AIStreamChunkEvent, ModelInfo};
use crate::providers::AiProvider;
use crate::client::{AiHttpClient, SseLineReader};
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

    /// Fetch available models from Gemini's API.
    /// Filters to models that support content generation (tool calling compatible).
    pub async fn list_models(api_key: &str) -> Result<Vec<ModelInfo>, AppError> {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .map_err(|e| AppError::Ai(format!("Failed to build HTTP client: {}", e)))?;

        let endpoint = format!(
            "https://generativelanguage.googleapis.com/v1beta/models?key={}",
            api_key
        );

        let res = client
            .get(&endpoint)
            .send()
            .await
            .map_err(|e| AppError::Ai(format!("Failed to fetch Gemini models: {}", e)))?;

        if !res.status().is_success() {
            return Err(AppError::Ai(format!("Gemini API error: {}", res.status())));
        }

        let body: Value = res.json().await
            .map_err(|e| AppError::Ai(format!("Failed to parse Gemini models: {}", e)))?;

        let mut models = Vec::new();
        if let Some(models_arr) = body["models"].as_array() {
            for item in models_arr {
                let name = item["name"].as_str().unwrap_or("");
                let id = name.strip_prefix("models/").unwrap_or(name).to_string();
                if id.is_empty() {
                    continue;
                }
                let display_name = item["displayName"].as_str().unwrap_or(&id).to_string();
                let description = item["description"].as_str().unwrap_or("").to_lowercase();
                let methods = item["supportedGenerationMethods"].as_array();
                let has_generate = methods
                    .map(|m| m.iter().any(|v| v.as_str() == Some("generateContent")))
                    .unwrap_or(false);
                if description.contains("deprecated") || description.contains("shut down") {
                    continue;
                }
                let context_window = item["inputTokenLimit"].as_u64().map(|v| v as u32);
                let max_tokens = item["outputTokenLimit"].as_u64().map(|v| v as u32);
                models.push(ModelInfo {
                    id,
                    display_name,
                    supports_tools: has_generate,
                    max_tokens,
                    context_window,
                });
            }
        }

        Ok(models)
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
                if let Some(stripped) = line.strip_prefix("data:") {
                    let data_json = stripped.trim();
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
