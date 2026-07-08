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

/// Hardcoded allowlist of OpenAI model ID prefixes known to support tool calling.
pub const OPENAI_TOOL_PREFIXES: &[&str] = &[
    "gpt-5", "gpt-4o", "gpt-4",
    "o3", "o4-mini", "o4", "o1",
];

/// Hardcoded allowlist of NVIDIA NIM model family prefixes known to support tool calling.
pub const NIM_TOOL_PREFIXES: &[&str] = &[
    "meta/llama-3.1", "meta/llama-3.2", "meta/llama-3.3", "meta/llama-4",
    "nvidia/nemotron-4", "nvidia/llama",
    "deepseek/deepseek", "deepseek-ai/DeepSeek",
    "qwen/qwen2", "qwen/qwen3",
    "mistralai/mistral", "mistralai/mixtral", "mistralai/Mistral",
    "ibm/granite",
];
