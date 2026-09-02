use std::collections::HashMap;
use std::path::PathBuf;
use tauri::{command, State, AppHandle, Emitter, Manager};
use crate::state::AppState;
use aurora_core::AppError;
use aurora_core::config::AppConfig;
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
    pub model: Option<String>,
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
    #[serde(rename = "resumeData", alias = "resume_data")]
    pub resume_data: Option<serde_json::Value>,
    #[serde(rename = "sessionId")]
    pub session_id: Option<String>,
    #[serde(rename = "toolName", alias = "tool_name")]
    pub tool_name: Option<String>,
    pub args: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AgentDeclineRequest {
    pub agent_type: Option<String>,
    pub mode: Option<String>,
    #[serde(rename = "runId")]
    pub run_id: String,
    #[serde(rename = "toolCallId")]
    pub tool_call_id: Option<String>,
    #[serde(rename = "sessionId")]
    pub session_id: Option<String>,
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
pub struct AiInlineCompleteRequest {
    pub context_before: String,
    pub language: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AiInlineCompleteResponse {
    pub status: String,
    pub completion: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AgentBtwRequest {
    pub session_id: Option<String>,
    pub message: String,
    pub model: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AgentBtwResponse {
    pub status: String,
    pub message: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SkillInfo {
    pub name: String,
    pub path: String,
    pub source: String,
    pub description: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct McpInfo {
    pub name: String,
    #[serde(rename = "type")]
    pub entry_type: String,
    pub command: Option<String>,
    pub args: Option<Vec<String>>,
    pub url: Option<String>,
    pub description: Option<String>,
    pub source: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AgentSkillsResponse {
    pub status: String,
    pub project: Vec<SkillInfo>,
    pub global: Vec<SkillInfo>,
    pub total: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AgentMcpResponse {
    pub status: String,
    pub project: Vec<McpInfo>,
    pub global: Vec<McpInfo>,
    pub total: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AgentFileSelection {
    pub path: String,
    #[serde(rename = "startLine")]
    pub start_line: i64,
    #[serde(rename = "endLine")]
    pub end_line: i64,
    pub text: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AgentFileContextRequest {
    pub paths: Vec<String>,
    pub cwd: Option<String>,
    #[serde(rename = "preview_chars")]
    pub preview_chars: Option<u64>,
    pub selection: Option<AgentFileSelection>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AgentFileContextResponse {
    pub status: String,
    pub context: Option<String>,
    pub message: Option<String>,
}

/// Quick pre-flight health check against the running sidecar. Returns Ok(true)
/// when the sidecar responds within the timeout, Ok(false) on any failure.
/// Used before longer agent calls so the user gets a clear "sidecar unreachable"
/// error instead of waiting for a 130-second HTTP timeout.
async fn sidecar_preflight_health(port: u16) -> bool {
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build() {
            Ok(c) => c,
            Err(_) => return false,
        };
    let url = format!("http://127.0.0.1:{}/global/health", port);
    match client.get(&url).send().await {
        Ok(resp) => resp.status().is_success(),
        Err(_) => false,
    }
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
    model: Option<String>,
) -> Result<AgentStepResponse, AppError> {
    let port = {
        let sidecar = state.sidecar.lock().await;
        sidecar.port().ok_or_else(|| AppError::Sidecar("aurora-agent is not running".to_string()))?
    };

    // Pre-flight health check: catch a dead/unreachable sidecar in 3 seconds
    // instead of letting the 130-second request timeout.
    if !sidecar_preflight_health(port).await {
        return Err(AppError::Sidecar(
            "Unable to connect to the AI agent. The aurora-agent sidecar is not responding. \
             Please restart the application or check Settings → AI for provider configuration."
                .to_string(),
        ));
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(130))
        .build()
        .map_err(|e| AppError::Sidecar(format!("Failed to create HTTP client: {}", e)))?;
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
        model,
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

/// Asks the aurora-agent sidecar to abort the in-flight generation (LLM step or
/// tool resume) for a thread. Used by the frontend "stop AI run" action so a
/// running tool call and the agent's generation halt immediately. This only
/// signals the sidecar — it never touches any terminal session.
#[command]
pub async fn agent_stop_run(
    state: State<'_, AppState>,
    thread_id: String,
) -> Result<(), AppError> {
    let port = {
        let sidecar = state.sidecar.lock().await;
        sidecar
            .port()
            .ok_or_else(|| AppError::Sidecar("aurora-agent is not running".to_string()))?
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| AppError::Sidecar(format!("Failed to create HTTP client: {}", e)))?;
    let url = format!("http://127.0.0.1:{}/api/run/stop", port);

    let _ = client
        .post(&url)
        .json(&serde_json::json!({ "thread_id": thread_id }))
        .send()
        .await;

    Ok(())
}

#[command]
pub async fn agent_approve_tool(
    state: State<'_, AppState>,
    agent_type: Option<String>,
    mode: Option<String>,
    run_id: String,
    tool_call_id: Option<String>,
    resume_data: Option<serde_json::Value>,
    session_id: Option<String>,
    tool_name: Option<String>,
    args: Option<serde_json::Value>,
) -> Result<AgentStepResponse, AppError> {
    let port = {
        let sidecar = state.sidecar.lock().await;
        sidecar.port().ok_or_else(|| AppError::Sidecar("aurora-agent is not running".to_string()))?
    };

    // Pre-flight health check before the long-running approval resume.
    if !sidecar_preflight_health(port).await {
        return Err(AppError::Sidecar(
            "Unable to connect to the AI agent. The aurora-agent sidecar is not responding. \
             Please restart the application or check Settings → AI for provider configuration."
                .to_string(),
        ));
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(130))
        .build()
        .map_err(|e| AppError::Sidecar(format!("Failed to create HTTP client: {}", e)))?;
    let url = format!("http://127.0.0.1:{}/api/tool/approve", port);

    let request_payload = AgentApproveRequest {
        agent_type,
        mode,
        run_id,
        tool_call_id,
        resume_data,
        session_id,
        tool_name,
        args,
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
    session_id: Option<String>,
) -> Result<AgentStepResponse, AppError> {
    let port = {
        let sidecar = state.sidecar.lock().await;
        sidecar.port().ok_or_else(|| AppError::Sidecar("aurora-agent is not running".to_string()))?
    };

    // Pre-flight health check before the long-running decline resume.
    if !sidecar_preflight_health(port).await {
        return Err(AppError::Sidecar(
            "Unable to connect to the AI agent. The aurora-agent sidecar is not responding. \
             Please restart the application or check Settings → AI for provider configuration."
                .to_string(),
        ));
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(130))
        .build()
        .map_err(|e| AppError::Sidecar(format!("Failed to create HTTP client: {}", e)))?;
    let url = format!("http://127.0.0.1:{}/api/tool/decline", port);

    let request_payload = AgentDeclineRequest {
        agent_type,
        mode,
        run_id,
        tool_call_id,
        session_id,
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

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(130))
        .build()
        .map_err(|e| AppError::Sidecar(format!("Failed to create HTTP client: {}", e)))?;
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
pub async fn agent_get_thinking(
    state: State<'_, AppState>,
    thread: String,
) -> Result<serde_json::Value, AppError> {
    let port = {
        let sidecar = state.sidecar.lock().await;
        sidecar.port().ok_or_else(|| AppError::Sidecar("aurora-agent is not running".to_string()))?
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| AppError::Sidecar(format!("Failed to create HTTP client: {}", e)))?;
    let url = format!("http://127.0.0.1:{}/api/thinking?thread={}", port, thread);

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

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(130))
        .build()
        .map_err(|e| AppError::Sidecar(format!("Failed to create HTTP client: {}", e)))?;
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
pub async fn agent_btw(
    state: State<'_, AppState>,
    session_id: Option<String>,
    message: String,
    model: Option<String>,
) -> Result<AgentBtwResponse, AppError> {
    let port = {
        let sidecar = state.sidecar.lock().await;
        sidecar.port().ok_or_else(|| AppError::Sidecar("aurora-agent is not running".to_string()))?
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| AppError::Sidecar(format!("Failed to create HTTP client: {}", e)))?;
    let url = format!("http://127.0.0.1:{}/api/btw", port);

    let request_payload = AgentBtwRequest {
        session_id,
        message,
        model,
    };

    let response = client.post(&url)
        .json(&request_payload)
        .send()
        .await
        .map_err(|e| AppError::Sidecar(format!("Failed to contact aurora-agent: {}", e)))?;

    if !response.status().is_success() {
        return Err(AppError::Sidecar(format!("aurora-agent API returned error status: {}", response.status())));
    }

    let response_data = response.json::<AgentBtwResponse>()
        .await
        .map_err(|e| AppError::Sidecar(format!("Failed to parse aurora-agent response: {}", e)))?;

    Ok(response_data)
}

#[command]
pub async fn agent_skills(
    state: State<'_, AppState>,
    cwd: Option<String>,
) -> Result<AgentSkillsResponse, AppError> {
    let port = {
        let sidecar = state.sidecar.lock().await;
        sidecar.port().ok_or_else(|| AppError::Sidecar("aurora-agent is not running".to_string()))?
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| AppError::Sidecar(format!("Failed to create HTTP client: {}", e)))?;
    let base = format!("http://127.0.0.1:{}/api/skills", port);
    let url = match cwd {
        Some(cwd) if !cwd.trim().is_empty() => {
            reqwest::Url::parse_with_params(&base, &[("cwd", cwd.trim())])
                .map_err(|e| AppError::Sidecar(format!("Failed to build skills URL: {}", e)))?
                .to_string()
        }
        _ => base,
    };

    let response = client.get(&url)
        .send()
        .await
        .map_err(|e| AppError::Sidecar(format!("Failed to contact aurora-agent: {}", e)))?;

    if !response.status().is_success() {
        return Err(AppError::Sidecar(format!("aurora-agent API returned error status: {}", response.status())));
    }

    let response_data = response.json::<AgentSkillsResponse>()
        .await
        .map_err(|e| AppError::Sidecar(format!("Failed to parse aurora-agent response: {}", e)))?;

    Ok(response_data)
}

#[command]
pub async fn agent_mcp(
    state: State<'_, AppState>,
    cwd: Option<String>,
) -> Result<AgentMcpResponse, AppError> {
    let port = {
        let sidecar = state.sidecar.lock().await;
        sidecar.port().ok_or_else(|| AppError::Sidecar("aurora-agent is not running".to_string()))?
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| AppError::Sidecar(format!("Failed to create HTTP client: {}", e)))?;
    let base = format!("http://127.0.0.1:{}/api/mcp", port);
    let url = match cwd {
        Some(cwd) if !cwd.trim().is_empty() => {
            reqwest::Url::parse_with_params(&base, &[("cwd", cwd.trim())])
                .map_err(|e| AppError::Sidecar(format!("Failed to build mcp URL: {}", e)))?
                .to_string()
        }
        _ => base,
    };

    let response = client.get(&url)
        .send()
        .await
        .map_err(|e| AppError::Sidecar(format!("Failed to contact aurora-agent: {}", e)))?;

    if !response.status().is_success() {
        return Err(AppError::Sidecar(format!("aurora-agent API returned error status: {}", response.status())));
    }

    let response_data = response.json::<AgentMcpResponse>()
        .await
        .map_err(|e| AppError::Sidecar(format!("Failed to parse aurora-agent response: {}", e)))?;

    Ok(response_data)
}

#[command]
pub async fn agent_file_context(
    state: State<'_, AppState>,
    paths: Vec<String>,
    cwd: Option<String>,
    preview_chars: Option<u64>,
    selection: Option<AgentFileSelection>,
) -> Result<AgentFileContextResponse, AppError> {
    let port = {
        let sidecar = state.sidecar.lock().await;
        sidecar.port().ok_or_else(|| AppError::Sidecar("aurora-agent is not running".to_string()))?
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| AppError::Sidecar(format!("Failed to create HTTP client: {}", e)))?;
    let url = format!("http://127.0.0.1:{}/api/file/context", port);

    let request_payload = AgentFileContextRequest {
        paths,
        cwd,
        preview_chars,
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

    let response_data = response.json::<AgentFileContextResponse>()
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

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(130))
        .build()
        .map_err(|e| AppError::Sidecar(format!("Failed to create HTTP client: {}", e)))?;
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

/// Kill any orphaned aurora-agent processes (wrapper + real bun binary) by image
/// name. This cleans up processes left behind by previous sessions — e.g. when the
/// app was force-closed before its exit handler ran — which would otherwise keep
/// `binaries/aurora-agent-real-*.exe` locked and make an NSIS reinstall fail with
/// "error opening file for writing". Safe to call even when none are running.
#[cfg(target_os = "windows")]
fn kill_orphan_agents() {
    for name in ["aurora-agent.exe", "aurora-agent-real-x86_64-pc-windows-msvc.exe"] {
        let mut cmd = std::process::Command::new("taskkill");
        cmd.args(["/F", "/IM", name])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000 | 0x00000008); // CREATE_NO_WINDOW | DETACHED_PROCESS
        let _ = cmd.status();
    }
}

#[cfg(not(target_os = "windows"))]
fn kill_orphan_agents() {}

/// Build the AI-provider environment variables (API keys, active provider,
/// per-tier models, and custom base URLs) from the current config + OS keychain.
///
/// Shared by `spawn_sidecar_internal` (injected into the agent at process start)
/// and `agent_update_settings` (pushed to a running agent). Keeping both paths in
/// one place guarantees the live runtime settings can never drift from what the
/// agent was originally spawned with. See issue #50.
fn build_ai_env(config: &AppConfig) -> Result<Vec<(String, String)>, AppError> {
    let mut envs: Vec<(String, String)> = Vec::new();

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

    if let Some(ref base_url) = config.ai.openai.base_url {
        envs.push(("GPT_OSS_BASE_URL".to_string(), base_url.clone()));
    }
    if let Some(ref base_url) = config.ai.ollama.base_url {
        envs.push(("OLLAMA_BASE_URL".to_string(), base_url.clone()));
    }
    if let Some(ref base_url) = config.ai.anthropic.base_url {
        envs.push(("ANTHROPIC_BASE_URL".to_string(), base_url.clone()));
    }
    if let Some(ref base_url) = config.ai.gemini.base_url {
        envs.push(("GEMINI_BASE_URL".to_string(), base_url.clone()));
    }
    if let Some(ref base_url) = config.ai.nvidia.base_url {
        envs.push(("NVIDIA_BASE_URL".to_string(), base_url.clone()));
    }

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
    let (fast, balanced, powerful) = provider_config.effective_models();
    envs.push(("ACTIVE_AI_MODEL_FAST".to_string(), fast));
    envs.push(("ACTIVE_AI_MODEL_BALANCED".to_string(), balanced));
    envs.push(("ACTIVE_AI_MODEL_POWERFUL".to_string(), powerful));

    Ok(envs)
}

#[derive(Serialize)]
struct AgentSettingsPush {
    env: HashMap<String, String>,
}

/// Push the current AI settings (active provider, per-tier models, API keys, base
/// URLs) to a running aurora-agent process so that changes made in Settings → AI
/// apply on the next generation — no agent restart required. See issue #50.
#[command]
pub async fn agent_update_settings(
    state: State<'_, AppState>,
    config: AppConfig,
) -> Result<(), AppError> {
    let port = {
        let sidecar = state.sidecar.lock().await;
        sidecar
            .port()
            .ok_or_else(|| AppError::Sidecar("aurora-agent is not running".to_string()))?
    };

    let env = build_ai_env(&config)?;
    let env_map: HashMap<String, String> = env.into_iter().collect();

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| AppError::Sidecar(format!("Failed to create HTTP client: {}", e)))?;
    let url = format!("http://127.0.0.1:{}/api/settings", port);

    let response = client
        .post(&url)
        .json(&AgentSettingsPush { env: env_map })
        .send()
        .await
        .map_err(|e| AppError::Sidecar(format!("Failed to contact aurora-agent: {}", e)))?;

    if !response.status().is_success() {
        return Err(AppError::Sidecar(format!(
            "aurora-agent /api/settings returned error status: {}",
            response.status()
        )));
    }

    Ok(())
}

pub async fn spawn_sidecar_internal(
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let app_handle_clone = app_handle.clone();
    // Clear any orphaned agent processes from previous sessions so they don't keep
    // the installed binary locked (which would block an NSIS reinstall).
    #[cfg(target_os = "windows")]
    kill_orphan_agents();
    let (crashed_sender, mut crashed_receiver) = tokio::sync::mpsc::unbounded_channel::<()>();

    tokio::spawn(async move {
        if crashed_receiver.recv().await.is_some() {
            let _ = app_handle_clone.emit("agent_crashed", ());
        }
    });

    let mut envs = Vec::new();
    {
        let config = state.config.lock().await;
        envs.extend(build_ai_env(&config)?);
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
    // Singleton guard: the whole app (all windows) shares a single aurora-agent
    // binary. Never spawn a second one — duplicate sessions would needlessly
    // multiply memory/CPU usage and fight over the port.
    if sidecar.is_running() {
        return Ok(());
    }
    match sidecar.spawn(crashed_sender, envs).await {
        Ok(_port) => Ok(()),
        Err(e) => {
            // Surface the failure to the frontend so the status bar's network
            // icon can turn red ("aurora-agent is not running").
            let _ = app_handle.emit("agent_crashed", ());
            Err(e)
        }
    }
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
