use std::path::PathBuf;
use tauri::{command, State, AppHandle, Emitter, Manager};
use crate::state::AppState;
use aurora_core::AppError;
use aurora_config::KeychainManager;
use chrono::Local;
use serde::{Serialize, Deserialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct AgentStepRequest {
    pub task_id: String,
    pub session_id: Option<String>,
    pub goal: Option<String>,
    pub last_output: Option<String>,
    pub exit_code: Option<i32>,
    pub agent_type: Option<String>,
    pub mode: Option<String>,
    pub require_review_for_commands: Option<bool>,
    pub require_review_for_writes: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AgentStepResponse {
    pub status: String,
    pub command: Option<String>,
    pub explanation: Option<String>,
    pub message: Option<String>,
    #[serde(alias = "runId")]
    pub run_id: Option<String>,
    #[serde(alias = "toolCallId")]
    pub tool_call_id: Option<String>,
    #[serde(alias = "toolName")]
    pub tool_name: Option<String>,
    pub args: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AgentApproveRequest {
    pub agent_type: Option<String>,
    pub mode: Option<String>,
    #[serde(rename = "runId")]
    pub run_id: String,
    #[serde(rename = "toolCallId")]
    pub tool_call_id: Option<String>,
    pub resume_data: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AgentDeclineRequest {
    pub agent_type: Option<String>,
    pub mode: Option<String>,
    #[serde(rename = "runId")]
    pub run_id: String,
    #[serde(rename = "toolCallId")]
    pub tool_call_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AgentChatRequest {
    pub session_id: Option<String>,
    pub task_id: Option<String>,
    pub message: String,
    pub agent_type: Option<String>,
    pub mode: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AgentChatResponse {
    pub status: String,
    pub message: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AiEditCodeRequest {
    pub prompt: String,
    pub code_before: String,
    pub code_after: String,
    pub selection: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AiEditCodeResponse {
    pub status: String,
    pub code: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AiInlineCompleteRequest {
    pub context_before: String,
    pub language: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AiInlineCompleteResponse {
    pub status: String,
    pub completion: Option<String>,
}

/// Calls the local aurora-agent sidecar and returns a structured step response.
#[command]
#[allow(clippy::too_many_arguments)]
pub async fn agent_plan_step(
    state: State<'_, AppState>,
    task_id: String,
    session_id: Option<String>,
    goal: Option<String>,
    last_output: Option<String>,
    exit_code: Option<i32>,
    agent_type: Option<String>,
    mode: Option<String>,
    require_review_for_commands: Option<bool>,
    require_review_for_writes: Option<bool>,
) -> Result<AgentStepResponse, AppError> {
    let port = {
        let sidecar = state.sidecar.lock().await;
        sidecar.port().ok_or_else(|| AppError::Sidecar("aurora-agent is not running".to_string()))?
    };

    let client = reqwest::Client::new();
    let url = format!("http://127.0.0.1:{}/api/step", port);

    let request_payload = AgentStepRequest {
        task_id,
        session_id,
        goal,
        last_output,
        exit_code,
        agent_type,
        mode,
        require_review_for_commands,
        require_review_for_writes,
    };

    let response = client.post(&url)
        .json(&request_payload)
        .send()
        .await
        .map_err(|e| AppError::Sidecar(format!("Failed to contact aurora-agent: {}", e)))?;

    if !response.status().is_success() {
        return Err(AppError::Sidecar(format!("aurora-agent API returned error status: {}", response.status())));
    }

    let response_data = response.json::<AgentStepResponse>()
        .await
        .map_err(|e| AppError::Sidecar(format!("Failed to parse aurora-agent response: {}", e)))?;

    Ok(response_data)
}

#[command]
pub async fn agent_approve_tool(
    state: State<'_, AppState>,
    agent_type: Option<String>,
    mode: Option<String>,
    run_id: String,
    tool_call_id: Option<String>,
    resume_data: Option<serde_json::Value>,
) -> Result<AgentStepResponse, AppError> {
    let port = {
        let sidecar = state.sidecar.lock().await;
        sidecar.port().ok_or_else(|| AppError::Sidecar("aurora-agent is not running".to_string()))?
    };

    let client = reqwest::Client::new();
    let url = format!("http://127.0.0.1:{}/api/tool/approve", port);

    let request_payload = AgentApproveRequest {
        agent_type,
        mode,
        run_id,
        tool_call_id,
        resume_data,
    };

    let response = client.post(&url)
        .json(&request_payload)
        .send()
        .await
        .map_err(|e| AppError::Sidecar(format!("Failed to contact aurora-agent: {}", e)))?;

    if !response.status().is_success() {
        return Err(AppError::Sidecar(format!("aurora-agent API returned error status: {}", response.status())));
    }

    let response_data = response.json::<AgentStepResponse>()
        .await
        .map_err(|e| AppError::Sidecar(format!("Failed to parse aurora-agent response: {}", e)))?;

    Ok(response_data)
}

#[command]
pub async fn agent_decline_tool(
    state: State<'_, AppState>,
    agent_type: Option<String>,
    mode: Option<String>,
    run_id: String,
    tool_call_id: Option<String>,
) -> Result<AgentStepResponse, AppError> {
    let port = {
        let sidecar = state.sidecar.lock().await;
        sidecar.port().ok_or_else(|| AppError::Sidecar("aurora-agent is not running".to_string()))?
    };

    let client = reqwest::Client::new();
    let url = format!("http://127.0.0.1:{}/api/tool/decline", port);

    let request_payload = AgentDeclineRequest {
        agent_type,
        mode,
        run_id,
        tool_call_id,
    };

    let response = client.post(&url)
        .json(&request_payload)
        .send()
        .await
        .map_err(|e| AppError::Sidecar(format!("Failed to contact aurora-agent: {}", e)))?;

    if !response.status().is_success() {
        return Err(AppError::Sidecar(format!("aurora-agent API returned error status: {}", response.status())));
    }

    let response_data = response.json::<AgentStepResponse>()
        .await
        .map_err(|e| AppError::Sidecar(format!("Failed to parse aurora-agent response: {}", e)))?;

    Ok(response_data)
}

#[command]
pub async fn agent_get_logs(
    state: State<'_, AppState>,
) -> Result<serde_json::Value, AppError> {
    let port = {
        let sidecar = state.sidecar.lock().await;
        sidecar.port().ok_or_else(|| AppError::Sidecar("aurora-agent is not running".to_string()))?
    };

    let client = reqwest::Client::new();
    let url = format!("http://127.0.0.1:{}/api/logs", port);

    let response = client.get(&url)
        .send()
        .await
        .map_err(|e| AppError::Sidecar(format!("Failed to contact aurora-agent: {}", e)))?;

    if !response.status().is_success() {
        return Err(AppError::Sidecar(format!("aurora-agent API returned error status: {}", response.status())));
    }

    let response_data = response.json::<serde_json::Value>()
        .await
        .map_err(|e| AppError::Sidecar(format!("Failed to parse aurora-agent response: {}", e)))?;

    Ok(response_data)
}

#[command]
pub async fn agent_chat(
    state: State<'_, AppState>,
    session_id: Option<String>,
    task_id: Option<String>,
    message: String,
    agent_type: Option<String>,
    mode: Option<String>,
) -> Result<AgentChatResponse, AppError> {
    let port = {
        let sidecar = state.sidecar.lock().await;
        sidecar.port().ok_or_else(|| AppError::Sidecar("aurora-agent is not running".to_string()))?
    };

    let client = reqwest::Client::new();
    let url = format!("http://127.0.0.1:{}/api/chat", port);

    let request_payload = AgentChatRequest {
        session_id,
        task_id,
        message,
        agent_type,
        mode,
    };

    let response = client.post(&url)
        .json(&request_payload)
        .send()
        .await
        .map_err(|e| AppError::Sidecar(format!("Failed to contact aurora-agent: {}", e)))?;

    if !response.status().is_success() {
        return Err(AppError::Sidecar(format!("aurora-agent API returned error status: {}", response.status())));
    }

    let response_data = response.json::<AgentChatResponse>()
        .await
        .map_err(|e| AppError::Sidecar(format!("Failed to parse aurora-agent response: {}", e)))?;

    Ok(response_data)
}

#[command]
pub async fn ai_edit_code(
    state: State<'_, AppState>,
    prompt: String,
    code_before: String,
    code_after: String,
    selection: String,
) -> Result<AiEditCodeResponse, AppError> {
    let port = {
        let sidecar = state.sidecar.lock().await;
        sidecar.port().ok_or_else(|| AppError::Sidecar("aurora-agent is not running".to_string()))?
    };

    let client = reqwest::Client::new();
    let url = format!("http://127.0.0.1:{}/api/edit-code", port);

    let request_payload = AiEditCodeRequest {
        prompt,
        code_before,
        code_after,
        selection,
    };

    let response = client.post(&url)
        .json(&request_payload)
        .send()
        .await
        .map_err(|e| AppError::Sidecar(format!("Failed to contact aurora-agent: {}", e)))?;

    if !response.status().is_success() {
        return Err(AppError::Sidecar(format!("aurora-agent API returned error status: {}", response.status())));
    }

    let response_data = response.json::<AiEditCodeResponse>()
        .await
        .map_err(|e| AppError::Sidecar(format!("Failed to parse aurora-agent response: {}", e)))?;

    Ok(response_data)
}

#[command]
pub async fn ai_inline_complete(
    state: State<'_, AppState>,
    context_before: String,
    language: String,
) -> Result<AiInlineCompleteResponse, AppError> {
    let port = {
        let sidecar = state.sidecar.lock().await;
        sidecar.port().ok_or_else(|| AppError::Sidecar("aurora-agent is not running".to_string()))?
    };

    let client = reqwest::Client::new();
    let url = format!("http://127.0.0.1:{}/api/inline-complete", port);

    let request_payload = AiInlineCompleteRequest {
        context_before,
        language,
    };

    let response = client.post(&url)
        .json(&request_payload)
        .send()
        .await
        .map_err(|e| AppError::Sidecar(format!("Failed to contact aurora-agent: {}", e)))?;

    if !response.status().is_success() {
        return Err(AppError::Sidecar(format!("aurora-agent API returned error status: {}", response.status())));
    }

    let response_data = response.json::<AiInlineCompleteResponse>()
        .await
        .map_err(|e| AppError::Sidecar(format!("Failed to parse aurora-agent response: {}", e)))?;

    Ok(response_data)
}

pub async fn spawn_sidecar_internal(
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let app_handle_clone = app_handle.clone();
    let (crashed_sender, mut crashed_receiver) = tokio::sync::mpsc::unbounded_channel::<()>();

    tokio::spawn(async move {
        if crashed_receiver.recv().await.is_some() {
            let _ = app_handle_clone.emit("agent_crashed", ());
        }
    });

    let mut envs = Vec::new();
    if let Ok(key) = KeychainManager::get_api_key("groq") {
        envs.push(("GROQ_API_KEY".to_string(), key));
    }
    if let Ok(key) = KeychainManager::get_api_key("openai") {
        envs.push(("OPENAI_API_KEY".to_string(), key.clone()));
        envs.push(("GPT_OSS_API_KEY".to_string(), key));
    }
    if let Ok(key) = KeychainManager::get_api_key("kimi") {
        envs.push(("KIMI_API_KEY".to_string(), key));
    }
    if let Ok(key) = KeychainManager::get_api_key("anthropic") {
        envs.push(("ANTHROPIC_API_KEY".to_string(), key));
    }
    if let Ok(key) = KeychainManager::get_api_key("gemini") {
        envs.push(("GOOGLE_GENERATIVE_AI_API_KEY".to_string(), key));
    }
    if let Ok(key) = KeychainManager::get_api_key("nvidia") {
        envs.push(("NVIDIA_API_KEY".to_string(), key));
    }

    {
        let config = state.config.lock().await;
        if let Some(ref base_url) = config.ai.openai.base_url {
            envs.push(("GPT_OSS_BASE_URL".to_string(), base_url.clone()));
        }
        if let Some(ref base_url) = config.ai.ollama.base_url {
            envs.push(("OLLAMA_BASE_URL".to_string(), base_url.clone()));
        }

        // Pass active provider and its resolved models
        let active = config.ai.active_provider.to_lowercase();
        let provider_config = match active.as_str() {
            "anthropic" => &config.ai.anthropic,
            "openai" => &config.ai.openai,
            "gemini" => &config.ai.gemini,
            "nvidia" => &config.ai.nvidia,
            "ollama" => &config.ai.ollama,
            _ => &config.ai.groq,
        };
        envs.push(("ACTIVE_AI_PROVIDER".to_string(), config.ai.active_provider.clone()));
        envs.push(("ACTIVE_AI_MODEL_FAST".to_string(), provider_config.fast_model.clone()));
        envs.push(("ACTIVE_AI_MODEL_BALANCED".to_string(), provider_config.balanced_model.clone()));
        envs.push(("ACTIVE_AI_MODEL_POWERFUL".to_string(), provider_config.powerful_model.clone()));
    }

    // ── Logging configuration for the sidecar process ──────────────────
    // Resolve log directory from Tauri's standard path API
    let app_data = app_handle.path().app_data_dir()
        .map_err(|e| AppError::Sidecar(format!("Failed to resolve app data dir: {}", e)))?;
    let log_dir = app_data.join("logs");

    // Create dir if missing; clean old logs on best-effort basis
    if let Err(e) = std::fs::create_dir_all(&log_dir) {
        tracing::warn!("Failed to create logs directory {:?}: {}", log_dir, e);
    } else {
        cleanup_old_logs(&log_dir, 7);
    }

    // Date-based rotation: aurora-agent.YYYY-MM-DD.log (rotates per app restart)
    let today = Local::now().format("%Y-%m-%d").to_string();
    let log_file = log_dir.join(format!("aurora-agent.{}.log", today));

    // Forward logging env vars so the sidecar's Logger can configure itself
    envs.push(("LOG_PRETTY".to_string(), if cfg!(debug_assertions) { "1".to_string() } else { "0".to_string() }));
    envs.push(("LOG_LEVEL".to_string(), std::env::var("LOG_LEVEL").unwrap_or_else(|_| "debug".to_string())));
    envs.push(("LOG_FILE_PATH".to_string(), log_file.to_string_lossy().to_string()));

    let mut sidecar = state.sidecar.lock().await;
    sidecar.spawn(crashed_sender, envs).await?;

    Ok(())
}

/// Remove log files older than `max_days` in the given directory.
/// Matches files matching `aurora-agent.*.log` (date-rotated scheme).
fn cleanup_old_logs(dir: &PathBuf, max_days: i64) {
    let cutoff = Local::now() - chrono::Duration::days(max_days);

    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };

        // Match aurora-agent.YYYY-MM-DD.log
        if !name.starts_with("aurora-agent.") || !name.ends_with(".log") {
            continue;
        }

        // Extract date portion: "aurora-agent.2026-07-04.log" → "2026-07-04"
        let date_str = match name.strip_prefix("aurora-agent.").and_then(|s| s.strip_suffix(".log")) {
            Some(d) => d,
            None => continue,
        };

        let file_date = match chrono::NaiveDate::parse_from_str(date_str, "%Y-%m-%d") {
            Ok(d) => d,
            Err(_) => continue,
        };

        if file_date < cutoff.date_naive() {
            tracing::info!("Removing old log file: {}", path.display());
            let _ = std::fs::remove_file(&path);
        }
    }
}
