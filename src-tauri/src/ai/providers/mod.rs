pub mod anthropic;
pub mod openai;
pub mod gemini;
pub mod ollama;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use crate::error::AppError;
use crate::ai::router::TaskTier;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiMessage {
    pub role: String, // "user" | "assistant" | "system"
    pub content: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AIStreamChunkEvent {
    pub request_id: String,
    pub chunk: String,
    pub done: bool,
}

#[async_trait]
pub trait AiProvider: Send + Sync {
    /// Return the model string for this tier from the config.
    fn model_for_tier(&self, tier: TaskTier) -> &str;

    /// Stream a completion. Emits "ai_stream_chunk" events on `window`.
    async fn stream_completion(
        &self,
        messages: Vec<AiMessage>,
        tier: TaskTier,
        window: tauri::Window,
        request_id: String,
    ) -> Result<(), AppError>;
}
