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

    let resolved_cwd = match cwd {
        Some(ref d) if !d.is_empty() => Some(d.clone()),
        _ => {
            if let Ok(mut dir) = std::env::current_dir() {
                if (dir.ends_with("tauri") || dir.ends_with("app"))
                    && dir.parent().is_some_and(|p| p.join("pnpm-workspace.yaml").exists() || p.join("Cargo.toml").exists())
                {
                    if let Some(parent) = dir.parent() {
                        dir = parent.to_path_buf();
                    }
                }
                Some(dir.to_string_lossy().into_owned())
            } else {
                None
            }
        }
    };

    manager.spawn(id.clone(), resolved_shell, args, env, resolved_cwd, sender).await?;
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
    let mut current = std::env::current_dir()?;
    if (current.ends_with("tauri") || current.ends_with("app"))
        && current.parent().is_some_and(|p| p.join("pnpm-workspace.yaml").exists() || p.join("Cargo.toml").exists())
    {
        if let Some(parent) = current.parent() {
            current = parent.to_path_buf();
        }
    }
    Ok(current.to_string_lossy().into_owned())
}
