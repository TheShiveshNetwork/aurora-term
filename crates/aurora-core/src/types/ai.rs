use serde::{Deserialize, Serialize};

/// model tier - determines which model is selected from
/// the active provider's tier mapping.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub enum TaskTier {
    Fast,
    Balanced,
    Powerful,
}

/// Provider name identifier.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ProviderName {
    Anthropic,
    OpenAi,
    Gemini,
    Nvidia,
    Ollama,
    Groq,
}

/// A single message in an AI conversation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiMessage {
    pub role: String, // "user" | "assistant" | "system"
    pub content: String,
}

/// Event payload emitted during AI streaming.
#[derive(Debug, Clone, Serialize)]
pub struct AIStreamChunkEvent {
    pub request_id: String,
    pub chunk: String,
    pub done: bool,
}

/// Model metadata returned by provider model-listing APIs.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub id: String,
    pub display_name: String,
    pub supports_tools: bool,
    pub max_tokens: Option<u32>,
    pub context_window: Option<u32>,
}
