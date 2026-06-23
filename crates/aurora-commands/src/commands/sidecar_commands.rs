use tauri::{command, State, AppHandle, Manager, Emitter};
use crate::state::AppState;
use aurora_core::AppError;
use aurora_config::KeychainManager;
use aurora_core::config::AppConfig;
use aurora_core::types::ai::{TaskTier, AiMessage};
use serde::{Serialize, Deserialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct AgentStepRequest {
    pub task_id: String,
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

/// System prompt that instructs the AI to return structured JSON for agent steps
const AGENT_STEP_SYSTEM: &str = r#"You are an intelligent terminal agent that converts natural language goals into shell commands.

Your job is to determine the NEXT single shell command to execute toward a user's goal.

CRITICAL: You MUST respond ONLY with valid JSON in EXACTLY this format (no markdown, no explanation, no code fences):
{"status":"executing","command":"<shell command here>","explanation":"<why this command helps>"}

OR if the task is complete:
{"status":"completed","message":"<summary of what was accomplished>"}

OR if there's an error or you cannot help:
{"status":"error","message":"<reason>"}

Rules:
- ONE command at a time only
- Use platform-appropriate commands (the user is on Windows, prefer PowerShell when possible)
- For read-only/diagnostic commands (dir, ls, git status, echo, type, Get-Content, etc.) respond immediately
- Keep commands short and correct
- The explanation should be concise (under 80 chars)
- NEVER include backticks, markdown or any text outside the JSON object
"#;

/// Build the user message for the agent step request
fn build_agent_user_message(goal: Option<&str>, last_output: Option<&str>, exit_code: Option<i32>) -> String {
    if let Some(g) = goal {
        format!("Goal: {}", g)
    } else if let Some(output) = last_output {
        let code = exit_code.unwrap_or(0);
        if output.is_empty() {
            format!("The previous command completed with exit code {}. Determine the next step or confirm task completion.", code)
        } else {
            format!(
                "Previous command exit code: {}\nOutput:\n{}\n\nDetermine the next command needed, or confirm task completion.",
                code,
                if output.len() > 2000 { &output[..2000] } else { output }
            )
        }
    } else {
        "No context available. Confirm task completion.".to_string()
    }
}

/// Parse the AI's text output into an AgentStepResponse.
/// Handles cases where the AI wraps JSON in markdown code fences.
fn parse_agent_response(text: &str) -> Result<AgentStepResponse, AppError> {
    let cleaned = text.trim();

    // Strip markdown code fences if present
    let json_str = if cleaned.starts_with("```") {
        let lines: Vec<&str> = cleaned.lines().collect();
        let start = lines.iter().position(|l| l.starts_with("```")).map(|i| i + 1).unwrap_or(0);
        let end = lines.iter().rposition(|l| l.starts_with("```")).unwrap_or(lines.len());
        lines[start..end].join("\n")
    } else {
        cleaned.to_string()
    };

    // Try to find JSON object in the response (sometimes AI prefixes with text)
    let json_str = if let Some(start) = json_str.find('{') {
        if let Some(end) = json_str.rfind('}') {
            json_str[start..=end].to_string()
        } else {
            json_str
        }
    } else {
        json_str
    };

    serde_json::from_str::<AgentStepResponse>(&json_str)
        .map_err(|e| AppError::Ai(format!(
            "Failed to parse AI agent response as JSON: {}. Raw response: {}",
            e, text.chars().take(200).collect::<String>()
        )))
}

/// Make a non-streaming HTTP request to the AI provider and return the full response text.
async fn call_ai_direct(
    provider_name: &str,
    config: &AppConfig,
    messages: Vec<AiMessage>,
    tier: TaskTier,
) -> Result<String, AppError> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| AppError::Ai(format!("Failed to build HTTP client: {}", e)))?;

    match provider_name {
        "anthropic" => {
            let api_key = KeychainManager::get_api_key("anthropic")?;
            let model = match tier {
                TaskTier::Fast => &config.ai.anthropic.fast_model,
                TaskTier::Balanced => &config.ai.anthropic.balanced_model,
                TaskTier::Powerful => &config.ai.anthropic.powerful_model,
            };

            // Separate system messages for Anthropic API
            let mut system_prompt = String::new();
            let mut api_messages = Vec::new();
            for msg in &messages {
                if msg.role == "system" {
                    system_prompt = msg.content.clone();
                } else {
                    api_messages.push(serde_json::json!({
                        "role": msg.role,
                        "content": msg.content
                    }));
                }
            }

            let mut body = serde_json::json!({
                "model": model,
                "max_tokens": 512,
                "messages": api_messages,
                "stream": false
            });
            if !system_prompt.is_empty() {
                body["system"] = serde_json::Value::String(system_prompt);
            }

            let res = client
                .post("https://api.anthropic.com/v1/messages")
                .header("x-api-key", &api_key)
                .header("anthropic-version", "2023-06-01")
                .header("content-type", "application/json")
                .json(&body)
                .send()
                .await
                .map_err(|e| AppError::Ai(format!("Anthropic request failed: {}", e)))?;

            if !res.status().is_success() {
                let err = res.text().await.unwrap_or_default();
                return Err(AppError::Ai(format!("Anthropic API error: {}", err)));
            }

            let json: serde_json::Value = res.json().await
                .map_err(|e| AppError::Ai(format!("Failed to parse Anthropic response: {}", e)))?;

            json["content"][0]["text"].as_str()
                .map(|s| s.to_string())
                .ok_or_else(|| AppError::Ai("No text content in Anthropic response".to_string()))
        }

        "openai" | "nvidia" => {
            let (api_key, base_url, model) = if provider_name == "openai" {
                let key = KeychainManager::get_api_key("openai")?;
                let url = config.ai.openai.base_url.clone()
                    .unwrap_or_else(|| "https://api.openai.com/v1".to_string());
                let model = match tier {
                    TaskTier::Fast => config.ai.openai.fast_model.clone(),
                    TaskTier::Balanced => config.ai.openai.balanced_model.clone(),
                    TaskTier::Powerful => config.ai.openai.powerful_model.clone(),
                };
                (key, url, model)
            } else {
                let key = KeychainManager::get_api_key("nvidia")?;
                let url = config.ai.nvidia.base_url.clone()
                    .unwrap_or_else(|| "https://integrate.api.nvidia.com/v1".to_string());
                let model = match tier {
                    TaskTier::Fast => config.ai.nvidia.fast_model.clone(),
                    TaskTier::Balanced => config.ai.nvidia.balanced_model.clone(),
                    TaskTier::Powerful => config.ai.nvidia.powerful_model.clone(),
                };
                (key, url, model)
            };

            let api_messages: Vec<serde_json::Value> = messages.iter().map(|m| {
                serde_json::json!({"role": m.role, "content": m.content})
            }).collect();

            let body = serde_json::json!({
                "model": model,
                "messages": api_messages,
                "max_tokens": 512,
                "stream": false
            });

            let res = client
                .post(format!("{}/chat/completions", base_url))
                .header("Authorization", format!("Bearer {}", api_key))
                .header("content-type", "application/json")
                .json(&body)
                .send()
                .await
                .map_err(|e| AppError::Ai(format!("OpenAI request failed: {}", e)))?;

            if !res.status().is_success() {
                let err = res.text().await.unwrap_or_default();
                return Err(AppError::Ai(format!("OpenAI API error: {}", err)));
            }

            let json: serde_json::Value = res.json().await
                .map_err(|e| AppError::Ai(format!("Failed to parse OpenAI response: {}", e)))?;

            json["choices"][0]["message"]["content"].as_str()
                .map(|s| s.to_string())
                .ok_or_else(|| AppError::Ai("No content in OpenAI response".to_string()))
        }

        "gemini" => {
            let api_key = KeychainManager::get_api_key("gemini")?;
            let model = match tier {
                TaskTier::Fast => &config.ai.gemini.fast_model,
                TaskTier::Balanced => &config.ai.gemini.balanced_model,
                TaskTier::Powerful => &config.ai.gemini.powerful_model,
            };

            // Combine system + user messages for Gemini
            let mut full_text = String::new();
            for msg in &messages {
                full_text.push_str(&msg.content);
                full_text.push_str("\n\n");
            }

            let body = serde_json::json!({
                "contents": [{
                    "parts": [{"text": full_text}]
                }],
                "generationConfig": {
                    "maxOutputTokens": 512,
                    "temperature": 0.1
                }
            });

            let url = format!(
                "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
                model, api_key
            );

            let res = client
                .post(&url)
                .header("content-type", "application/json")
                .json(&body)
                .send()
                .await
                .map_err(|e| AppError::Ai(format!("Gemini request failed: {}", e)))?;

            if !res.status().is_success() {
                let err = res.text().await.unwrap_or_default();
                return Err(AppError::Ai(format!("Gemini API error: {}", err)));
            }

            let json: serde_json::Value = res.json().await
                .map_err(|e| AppError::Ai(format!("Failed to parse Gemini response: {}", e)))?;

            json["candidates"][0]["content"]["parts"][0]["text"].as_str()
                .map(|s| s.to_string())
                .ok_or_else(|| AppError::Ai("No text in Gemini response".to_string()))
        }

        "ollama" => {
            let base_url = config.ai.ollama.base_url.clone()
                .unwrap_or_else(|| "http://localhost:11434".to_string());
            let model = match tier {
                TaskTier::Fast => &config.ai.ollama.fast_model,
                TaskTier::Balanced => &config.ai.ollama.balanced_model,
                TaskTier::Powerful => &config.ai.ollama.powerful_model,
            };

            let api_messages: Vec<serde_json::Value> = messages.iter().map(|m| {
                serde_json::json!({"role": m.role, "content": m.content})
            }).collect();

            let body = serde_json::json!({
                "model": model,
                "messages": api_messages,
                "stream": false
            });

            let res = client
                .post(format!("{}/api/chat", base_url))
                .header("content-type", "application/json")
                .json(&body)
                .send()
                .await
                .map_err(|e| AppError::Ai(format!("Ollama request failed: {}", e)))?;

            if !res.status().is_success() {
                let err = res.text().await.unwrap_or_default();
                return Err(AppError::Ai(format!("Ollama API error: {}", err)));
            }

            let json: serde_json::Value = res.json().await
                .map_err(|e| AppError::Ai(format!("Failed to parse Ollama response: {}", e)))?;

            json["message"]["content"].as_str()
                .map(|s| s.to_string())
                .ok_or_else(|| AppError::Ai("No content in Ollama response".to_string()))
        }

        _ => Err(AppError::Ai(format!(
            "Unsupported provider '{}'. Please configure an AI provider in Settings.",
            provider_name
        ))),
    }
}

/// Direct AI-powered agent step — does NOT require the OpenCode sidecar.
/// Calls the configured AI provider and returns a structured step response.
#[command]
pub async fn agent_plan_step(
    state: State<'_, AppState>,
    _task_id: String,
    goal: Option<String>,
    last_output: Option<String>,
    exit_code: Option<i32>,
) -> Result<AgentStepResponse, AppError> {
    let (provider_name, config_snapshot) = {
        let config = state.config.lock().await;
        (config.ai.active_provider.clone(), config.clone())
    };

    let user_msg = build_agent_user_message(
        goal.as_deref(),
        last_output.as_deref(),
        exit_code,
    );

    let messages = vec![
        AiMessage {
            role: "system".to_string(),
            content: AGENT_STEP_SYSTEM.to_string(),
        },
        AiMessage {
            role: "user".to_string(),
            content: user_msg,
        },
    ];

    let response_text = call_ai_direct(&provider_name, &config_snapshot, messages, TaskTier::Balanced)
        .await
        .map_err(|e| AppError::Ai(format!("Agent AI call failed: {}", e)))?;

    parse_agent_response(&response_text)
}

#[command]
pub async fn get_opencode_port(
    state: State<'_, AppState>,
) -> Result<u16, AppError> {
    let sidecar = state.sidecar.lock().await;
    sidecar.port().ok_or_else(|| AppError::Sidecar("OpenCode sidecar is not running".to_string()))
}

#[command]
pub async fn restart_opencode(
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    spawn_sidecar_internal(app_handle, state).await
}

#[command]
pub async fn opencode_agent_step(
    state: State<'_, AppState>,
    task_id: String,
    goal: Option<String>,
    last_output: Option<String>,
    exit_code: Option<i32>,
) -> Result<AgentStepResponse, AppError> {
    let port = {
        let sidecar = state.sidecar.lock().await;
        sidecar.port().ok_or_else(|| AppError::Sidecar("OpenCode sidecar is not running".to_string()))?
    };

    let client = reqwest::Client::new();
    let url = format!("http://127.0.0.1:{}/api/step", port);

    let request_payload = AgentStepRequest {
        task_id,
        goal,
        last_output,
        exit_code,
    };

    let response = client.post(&url)
        .json(&request_payload)
        .send()
        .await
        .map_err(|e| AppError::Sidecar(format!("Failed to contact sidecar API: {}", e)))?;

    if !response.status().is_success() {
        return Err(AppError::Sidecar(format!("Sidecar API returned error status: {}", response.status())));
    }

    let response_data = response.json::<AgentStepResponse>()
        .await
        .map_err(|e| AppError::Sidecar(format!("Failed to parse sidecar response: {}", e)))?;

    Ok(response_data)
}

fn check_opencode_installed() -> bool {
    let mut cmd = if cfg!(target_os = "windows") {
        let mut c = std::process::Command::new("cmd");
        c.args(&["/c", "opencode", "--version"]);
        c
    } else {
        let mut c = std::process::Command::new("sh");
        c.args(&["-c", "opencode --version"]);
        c
    };

    if let Ok(status) = cmd.status() {
        status.success()
    } else {
        false
    }
}

fn install_opencode() -> Result<(), AppError> {
    let mut cmd = if cfg!(target_os = "windows") {
        let mut c = std::process::Command::new("cmd");
        c.args(&["/c", "npm", "install", "-g", "opencode-ai"]);
        c
    } else {
        let mut c = std::process::Command::new("sh");
        c.args(&["-c", "npm install -g opencode-ai"]);
        c
    };

    let status = cmd.status()
        .map_err(|e| AppError::Sidecar(format!("Failed to execute npm install command: {}", e)))?;

    if status.success() {
        Ok(())
    } else {
        Err(AppError::Sidecar("Failed to install opencode-ai package via npm".to_string()))
    }
}

/// Helper function to locate sidecar binary, write config, and spawn process.
pub async fn spawn_sidecar_internal(
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    // 1. Detect if opencode is installed. If not, install it.
    if !check_opencode_installed() {
        tracing::info!("OpenCode is not installed. Installing globally via npm...");
        install_opencode()?;
    }

    let app_handle_clone = app_handle.clone();
    let (crashed_sender, mut crashed_receiver) = tokio::sync::mpsc::unbounded_channel::<()>();

    tokio::spawn(async move {
        if crashed_receiver.recv().await.is_some() {
            let _ = app_handle_clone.emit("opencode_crashed", ());
        }
    });

    let mut sidecar = state.sidecar.lock().await;
    sidecar.spawn(crashed_sender).await?;

    Ok(())
}
