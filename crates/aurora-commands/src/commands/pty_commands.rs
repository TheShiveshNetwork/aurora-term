use std::collections::HashMap;
use tauri::{command, State};
use crate::state::AppState;
use aurora_core::AppError;

#[command]
pub async fn pty_spawn(
    state: State<'_, AppState>,
    shell: String,
    args: Vec<String>,
    env: HashMap<String, String>,
    cwd: Option<String>,
    session_id: Option<String>,
) -> Result<String, AppError> {
    let id = session_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let mut manager = state.pty_manager.lock().await;
    let sender = state.pty_event_sender.clone();

    let resolved_shell = if shell.is_empty() {
        aurora_pty::shell::detect_default_shell()
    } else {
        #[cfg(not(target_os = "windows"))]
        {
            if shell == "powershell.exe" || shell == "pwsh" || shell == "bash" || shell == "zsh" {
                aurora_pty::shell::detect_default_shell()
            } else if !shell.contains('/') {
                which::which(&shell)
                    .map(|p| p.to_string_lossy().into_owned())
                    .unwrap_or_else(|_| aurora_pty::shell::detect_default_shell())
            } else {
                shell
            }
        }
        #[cfg(target_os = "windows")]
        {
            if shell == "bash" || shell == "zsh" {
                aurora_pty::shell::detect_default_shell()
            } else if !shell.contains('\\') && !shell.contains('/') {
                which::which(&shell)
                    .map(|p| p.to_string_lossy().into_owned())
                    .unwrap_or_else(|_| aurora_pty::shell::detect_default_shell())
            } else {
                shell
            }
        }
    };

    manager.spawn(id.clone(), resolved_shell, args, env, cwd, sender).await?;
    Ok(id)
}

#[command]
pub async fn pty_write(
    state: State<'_, AppState>,
    session_id: String,
    data: String,
) -> Result<(), AppError> {
    let mut manager = state.pty_manager.lock().await;
    manager.write(&session_id, &data)
}

#[command]
pub async fn pty_resize(
    state: State<'_, AppState>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), AppError> {
    let manager = state.pty_manager.lock().await;
    manager.resize(&session_id, cols, rows)
}

#[command]
pub async fn pty_kill(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), AppError> {
    let mut manager = state.pty_manager.lock().await;
    manager.kill(&session_id)
}

#[command]
pub fn get_cwd() -> Result<String, AppError> {
    Ok(std::env::current_dir()?.to_string_lossy().into_owned())
}
