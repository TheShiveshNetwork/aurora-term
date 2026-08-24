use async_trait::async_trait;
use aurora_core::AppError;
use aurora_core::types::ai::{TaskTier, AiMessage, ModelInfo};
use super::openai::OpenAiCompatProvider;
use super::{AiProvider, OPENAI_TOOL_PREFIXES};

/// Default OpenAI-compatible endpoint exposed by Groq.
pub const GROQ_DEFAULT_BASE_URL: &str = "https://api.groq.com/openai/v1";

/// Groq provider.
///
/// Groq speaks the OpenAI wire protocol (Bearer auth, `/chat/completions`,
/// SSE streaming, `/models`), so this is a configured facade over the shared
/// [`OpenAiCompatProvider`] rather than a protocol reimplementation. Keeping it
/// as a first-class type mirrors the other providers at every call site
/// (`build_provider`, model listing) and gives Groq-specific behavior a home:
/// models Groq has sunset still arrive in `/models` responses flagged
/// `active: false`, which the shared lister drops.
pub struct GroqProvider {
    inner: OpenAiCompatProvider,
}

impl GroqProvider {
    pub fn new(
        api_key: String,
        base_url: Option<String>,
        fast_model: String,
        balanced_model: String,
        powerful_model: String,
    ) -> Self {
        Self {
            inner: OpenAiCompatProvider::new(
                api_key,
                Some(base_url.unwrap_or_else(|| GROQ_DEFAULT_BASE_URL.to_string())),
                fast_model,
                balanced_model,
                powerful_model,
            ),
        }
    }

    /// Fetch the models Groq currently offers. Retired models are filtered out,
    /// so deprecated IDs never reach the settings picker or runtime.
    pub async fn list_models(api_key: &str, base_url: &str) -> Result<Vec<ModelInfo>, AppError> {
        OpenAiCompatProvider::list_models(api_key, base_url, OPENAI_TOOL_PREFIXES).await
    }
}

#[async_trait]
impl AiProvider for GroqProvider {
    fn model_for_tier(&self, tier: TaskTier) -> &str {
        self.inner.model_for_tier(tier)
    }

    async fn stream_completion(
        &self,
        messages: Vec<AiMessage>,
        tier: TaskTier,
        window: tauri::Window,
        request_id: String,
    ) -> Result<(), AppError> {
        self.inner
            .stream_completion(messages, tier, window, request_id)
            .await
    }
}
