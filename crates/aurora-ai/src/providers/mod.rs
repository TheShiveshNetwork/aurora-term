pub mod anthropic;
pub mod openai;
pub mod gemini;
pub mod ollama;

use async_trait::async_trait;
use aurora_core::AppError;
use aurora_core::types::ai::{TaskTier, AiMessage};

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
