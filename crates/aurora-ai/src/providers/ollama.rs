use async_trait::async_trait;
use futures_util::StreamExt;
use serde_json::Value;
use aurora_core::AppError;
use aurora_core::types::ai::{TaskTier, AiMessage, AIStreamChunkEvent, ModelInfo};
use crate::providers::AiProvider;
use crate::client::{AiHttpClient, SseLineReader};
use tauri::Emitter;

pub struct OllamaProvider {
    pub client: reqwest::Client,
    pub base_url: String,
    pub fast_model: String,
    pub balanced_model: String,
    pub powerful_model: String,
}

impl OllamaProvider {
    pub fn new(
        base_url: Option<String>,
        fast_model: String,
        balanced_model: String,
        powerful_model: String,
    ) -> Self {
        let http_client = AiHttpClient::new();
        let final_base_url = base_url.unwrap_or_else(|| "http://localhost:11434".to_string());
        Self {
            client: http_client.client,
            base_url: final_base_url,
            fast_model,
            balanced_model,
            powerful_model,
        }
    }

    async fn check_status(&self) -> Result<(), AppError> {
        let status_url = format!("{}/api/tags", self.base_url);
        let res = self.client.get(&status_url).send().await;
        match res {
            Ok(r) if r.status().is_success() => Ok(()),
            _ => Err(AppError::Ai("Ollama local service is not running".to_string())),
        }
    }

    /// Fetch available models from Ollama.
    /// Calls `/api/tags` to list, then `/api/show` per model to detect tool capability.
    pub async fn list_models(base_url: &str) -> Result<Vec<ModelInfo>, AppError> {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .map_err(|e| AppError::Ai(format!("Failed to build HTTP client: {}", e)))?;

        let tags_url = format!("{}/api/tags", base_url.trim_end_matches('/'));
        let res = client
            .get(&tags_url)
            .send()
            .await
            .map_err(|e| AppError::Ai(format!("Failed to connect to Ollama: {}", e)))?;

        if !res.status().is_success() {
            return Err(AppError::Ai("Ollama service is not running".to_string()));
        }

        let body: Value = res.json().await
            .map_err(|e| AppError::Ai(format!("Failed to parse Ollama tags: {}", e)))?;

        let mut models = Vec::new();
        if let Some(list) = body["models"].as_array() {
            for item in list {
                let name = item["name"].as_str().unwrap_or("").to_string();
                if name.is_empty() {
                    continue;
                }
                let parameter_size = item["details"]["parameter_size"].as_str().unwrap_or("").to_string();
                let display_name = if parameter_size.is_empty() {
                    name.clone()
                } else {
                    format!("{} ({})", name, parameter_size)
                };

                // Check capabilities via /api/show
                let supports_tools = {
                    let show_url = format!("{}/api/show", base_url.trim_end_matches('/'));
                    let show_body = serde_json::json!({"model": &name});
                    match client.post(&show_url).json(&show_body).send().await {
                        Ok(resp) => match resp.json::<Value>().await {
                            Ok(show_data) => show_data["capabilities"]
                                .as_array()
                                .map(|caps| caps.iter().any(|c| c.as_str() == Some("tools")))
                                .unwrap_or(false),
                            Err(_) => false,
                        },
                        Err(_) => false,
                    }
                };

                models.push(ModelInfo {
                    id: name.clone(),
                    display_name,
                    supports_tools,
                    max_tokens: None,
                    context_window: None,
                });
            }
        }

        Ok(models)
    }
}

#[async_trait]
impl AiProvider for OllamaProvider {
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
        if let Err(e) = self.check_status().await {
            let _ = window.emit("ollama_not_running", e.to_string());
            return Err(e);
        }

        let mut model = self.model_for_tier(tier).to_string();
        if let Ok(installed) = Self::list_models(&self.base_url).await {
            let installed_ids: Vec<String> = installed.iter().map(|m| m.id.clone()).collect();
            if !installed_ids.is_empty() && !installed_ids.contains(&model) {
                // Try prefix match (e.g., model "llama3.1:8b" -> clean prefix "llama3.1")
                let clean_model = model.split(':').next().unwrap_or("");
                if let Some(matched) = installed_ids.iter().find(|m| {
                    *m == clean_model
                        || m.starts_with(clean_model)
                        || m.split(':').next().unwrap_or("") == clean_model
                }) {
                    model = matched.clone();
                } else {
                    model = installed_ids[0].clone();
                }
            }
        }

        let body = serde_json::json!({
            "model": model,
            "messages": messages,
            "stream": true
        });

        let endpoint = format!("{}/api/chat", self.base_url);
        let res = self.client
            .post(&endpoint)
            .json(&body)
            .send()
            .await
            .map_err(|e| AppError::Ai(format!("Failed to connect to Ollama: {}", e)))?;

        if !res.status().is_success() {
            let error_text = res.text().await.unwrap_or_default();
            return Err(AppError::Ai(format!("Ollama API error: {}", error_text)));
        }

        let mut stream = res.bytes_stream();
        let mut reader = SseLineReader::new();

        while let Some(chunk_result) = stream.next().await {
            let bytes = chunk_result.map_err(|e| AppError::Ai(format!("Stream error: {}", e)))?;
            
            // Ollama returns simple newline-delimited JSON objects
            let lines = reader.feed(&bytes);
            for line in lines {
                if let Ok(parsed) = serde_json::from_str::<Value>(&line) {
                    if let Some(text) = parsed["message"]["content"].as_str() {
                        let _ = window.emit(
                            "ai_stream_chunk",
                            AIStreamChunkEvent {
                                request_id: request_id.clone(),
                                chunk: text.to_string(),
                                done: false,
                            },
                        );
                    }
                    if parsed["done"].as_bool().unwrap_or(false) {
                        break;
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
