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

    /// Fetch available models from Ollama (HTTP API + CLI output).
    pub async fn list_models(base_url: &str) -> Result<Vec<ModelInfo>, AppError> {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .map_err(|e| AppError::Ai(format!("Failed to build HTTP client: {}", e)))?;

        let mut models = Vec::new();
        let mut model_ids = std::collections::HashSet::new();

        // 1. Fetch from HTTP API /api/tags
        let tags_url = format!("{}/api/tags", base_url.trim_end_matches('/'));
        if let Ok(res) = client.get(&tags_url).send().await {
            if res.status().is_success() {
                if let Ok(body) = res.json::<Value>().await {
                    if let Some(list) = body["models"].as_array() {
                        for item in list {
                            let name = item["name"].as_str().unwrap_or("").to_string();
                            if name.is_empty() || model_ids.contains(&name) {
                                continue;
                            }
                            model_ids.insert(name.clone());
                            let parameter_size = item["details"]["parameter_size"].as_str().unwrap_or("").to_string();
                            let display_name = if parameter_size.is_empty() {
                                name.clone()
                            } else {
                                format!("{} ({})", name, parameter_size)
                            };

                            models.push(ModelInfo {
                                id: name.clone(),
                                display_name,
                                supports_tools: true,
                                max_tokens: None,
                                context_window: None,
                            });
                        }
                    }
                }
            }
        }

        // 2. Also run `ollama list` command if available to include all CLI-listed local and cloud models
        if let Ok(output) = std::process::Command::new("ollama").arg("list").output() {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                for line in stdout.lines().skip(1) {
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if let Some(&name) = parts.first() {
                        if !name.is_empty() && !model_ids.contains(name) {
                            model_ids.insert(name.to_string());
                            models.push(ModelInfo {
                                id: name.to_string(),
                                display_name: name.to_string(),
                                supports_tools: true,
                                max_tokens: None,
                                context_window: None,
                            });
                        }
                    }
                }
            }
        }

        if models.is_empty() {
            return Err(AppError::Ai("No Ollama models found. Please ensure Ollama is running or pull a model.".to_string()));
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
