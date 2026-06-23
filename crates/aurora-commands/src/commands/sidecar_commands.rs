use tauri::{command, State, AppHandle, Emitter};
use crate::state::AppState;
use aurora_core::AppError;
use aurora_config::KeychainManager;
use serde::{Serialize, Deserialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct AgentStepRequest {
    pub task_id: String,
    /// Terminal session (tab) UUID — used as the Mastra memory thread ID.
    /// All tasks within the same tab share conversation history via this ID.
    pub session_id: Option<String>,
    pub goal: Option<String>,
    pub last_output: Option<String>,
    pub exit_code: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AgentStepResponse {
    pub status: String,
    pub command: Option<String>,
    pub explanation: Option<String>,
    pub message: Option<String>,
}

/// Calls the local aurora-agent sidecar and returns a structured step response.
#[command]
pub async fn agent_plan_step(
    state: State<'_, AppState>,
    task_id: String,
    session_id: Option<String>,
    goal: Option<String>,
    last_output: Option<String>,
    exit_code: Option<i32>,
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

    {
        let config = state.config.lock().await;
        if let Some(ref base_url) = config.ai.openai.base_url {
            envs.push(("GPT_OSS_BASE_URL".to_string(), base_url.clone()));
        }
    }

    let mut sidecar = state.sidecar.lock().await;
    sidecar.spawn(crashed_sender, envs).await?;

    Ok(())
}
