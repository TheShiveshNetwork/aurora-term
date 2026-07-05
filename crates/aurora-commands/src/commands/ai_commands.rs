use tauri::{command, State, Window};
use std::collections::HashMap;
use crate::state::AppState;
use aurora_core::AppError;
use aurora_core::config::AppConfig;
use aurora_core::types::ai::{TaskTier, ModelInfo};
use aurora_ai::{AiRouter, AiTask, AiProvider};
use aurora_ai::providers::anthropic::AnthropicProvider;
use aurora_ai::providers::openai::OpenAiCompatProvider;
use aurora_ai::providers::gemini::GeminiProvider;
use aurora_ai::providers::ollama::OllamaProvider;
use aurora_ai::providers::{OPENAI_TOOL_PREFIXES, NIM_TOOL_PREFIXES};
use aurora_config::KeychainManager;

// Helper to construct a provider from AppConfig and credentials
fn build_provider(
    provider_name: &str,
    config: &AppConfig,
) -> Result<Box<dyn AiProvider>, AppError> {
    match provider_name {
        "anthropic" => {
            let key = KeychainManager::get_api_key("anthropic")?;
            Ok(Box::new(AnthropicProvider::new(
                key,
                config.ai.anthropic.fast_model.clone(),
                config.ai.anthropic.balanced_model.clone(),
                config.ai.anthropic.powerful_model.clone(),
            )))
        }
        "openai" => {
            let key = KeychainManager::get_api_key("openai")?;
            Ok(Box::new(OpenAiCompatProvider::new(
                key,
                config.ai.openai.base_url.clone(),
                config.ai.openai.fast_model.clone(),
                config.ai.openai.balanced_model.clone(),
                config.ai.openai.powerful_model.clone(),
            )))
        }
        "gemini" => {
            let key = KeychainManager::get_api_key("gemini")?;
            Ok(Box::new(GeminiProvider::new(
                key,
                config.ai.gemini.fast_model.clone(),
                config.ai.gemini.balanced_model.clone(),
                config.ai.gemini.powerful_model.clone(),
            )))
        }
        "nvidia" => {
            let key = KeychainManager::get_api_key("nvidia")?;
            Ok(Box::new(OpenAiCompatProvider::new(
                key,
                config.ai.nvidia.base_url.clone(),
                config.ai.nvidia.fast_model.clone(),
                config.ai.nvidia.balanced_model.clone(),
                config.ai.nvidia.powerful_model.clone(),
            )))
        }
        "ollama" => {
            Ok(Box::new(OllamaProvider::new(
                config.ai.ollama.base_url.clone(),
                config.ai.ollama.fast_model.clone(),
                config.ai.ollama.balanced_model.clone(),
                config.ai.ollama.powerful_model.clone(),
            )))
        }
        "groq" => {
            let key = KeychainManager::get_api_key("groq")?;
            Ok(Box::new(OpenAiCompatProvider::new(
                key,
                config.ai.groq.base_url.clone(),
                config.ai.groq.fast_model.clone(),
                config.ai.groq.balanced_model.clone(),
                config.ai.groq.powerful_model.clone(),
            )))
        }
        _ => Err(AppError::Ai(format!("Unknown provider: {}", provider_name))),
    }
}

#[command]
pub async fn ai_save_api_key(
    provider: String,
    key: String,
) -> Result<(), AppError> {
    KeychainManager::save_api_key(&provider, &key)
}

#[command]
pub async fn ai_get_api_key(
    provider: String,
) -> Result<String, AppError> {
    KeychainManager::get_api_key(&provider)
}

#[command]
pub async fn ai_delete_api_key(
    provider: String,
) -> Result<(), AppError> {
    KeychainManager::delete_api_key(&provider)
}

#[command]
pub async fn ai_provider_status() -> Result<HashMap<String, bool>, AppError> {
    let mut status = HashMap::new();
    let providers = vec!["anthropic", "openai", "gemini", "nvidia", "groq"];
    for p in providers {
        status.insert(p.to_string(), KeychainManager::has_api_key(p));
    }
    // Ollama does not need key
    status.insert("ollama".to_string(), true);
    Ok(status)
}

#[command]
pub async fn ai_translate_command(
    window: Window,
    state: State<'_, AppState>,
    query: String,
    context: String,
) -> Result<(), AppError> {
    let config = state.config.lock().await;
    let provider = build_provider(&config.ai.active_provider, &config)?;
    let router = AiRouter::new(provider);
    
    let task = AiTask::TranslateCommand { query, context };
    let request_id = uuid::Uuid::new_v4().to_string();

    router.run(task, window, request_id).await?;
    Ok(())
}

#[command]
pub async fn ai_explain_error(
    window: Window,
    state: State<'_, AppState>,
    command: String,
    output: String,
    exit_code: i32,
) -> Result<(), AppError> {
    let config = state.config.lock().await;
    let provider = build_provider(&config.ai.active_provider, &config)?;
    let router = AiRouter::new(provider);
    
    let task = AiTask::ExplainError {
        command,
        output_len: output.len(),
        output,
        exit_code,
    };
    let request_id = uuid::Uuid::new_v4().to_string();

    router.run(task, window, request_id).await?;
    Ok(())
}

#[command]
pub async fn ai_test_provider(
    state: State<'_, AppState>,
    provider: String,
) -> Result<bool, AppError> {
    let config = state.config.lock().await;
    let built = build_provider(&provider, &config)?;
    let model = built.model_for_tier(TaskTier::Fast);
    // A simple status check or quick ping
    if provider == "ollama" {
        // Handled internally in Ollama constructor
        return Ok(true);
    }
    let has_key = KeychainManager::has_api_key(&provider);
    Ok(has_key && !model.is_empty())
}

#[command]
pub async fn ai_fetch_models(
    state: State<'_, AppState>,
    provider: String,
) -> Result<Vec<ModelInfo>, AppError> {
    let config = state.config.lock().await;

    match provider.as_str() {
        "anthropic" => {
            let key = KeychainManager::get_api_key("anthropic")?;
            AnthropicProvider::list_models(&key).await
        }
        "openai" => {
            let key = KeychainManager::get_api_key("openai")?;
            let base_url = config.ai.openai.base_url.clone()
                .unwrap_or_else(|| "https://api.openai.com/v1".to_string());
            OpenAiCompatProvider::list_models(&key, &base_url, OPENAI_TOOL_PREFIXES).await
        }
        "gemini" => {
            let key = KeychainManager::get_api_key("gemini")?;
            GeminiProvider::list_models(&key).await
        }
        "nvidia" => {
            let key = KeychainManager::get_api_key("nvidia")?;
            let base_url = config.ai.nvidia.base_url.clone()
                .unwrap_or_else(|| "https://integrate.api.nvidia.com/v1".to_string());
            OpenAiCompatProvider::list_models(&key, &base_url, NIM_TOOL_PREFIXES).await
        }
        "ollama" => {
            let base_url = config.ai.ollama.base_url.clone()
                .unwrap_or_else(|| "http://localhost:11434".to_string());
            OllamaProvider::list_models(&base_url).await
        }
        "groq" => {
            let key = KeychainManager::get_api_key("groq")?;
            let base_url = config.ai.groq.base_url.clone()
                .unwrap_or_else(|| "https://api.groq.com/openai/v1".to_string());
            OpenAiCompatProvider::list_models(&key, &base_url, OPENAI_TOOL_PREFIXES).await
        }
        _ => Err(AppError::Ai(format!("Unknown provider: {}", provider))),
    }
}
