use std::collections::HashMap;
use tauri::{command, State, Window};
use crate::state::AppState;
use crate::error::AppError;

#[command]
pub async fn pty_spawn(
    window: Window,
    state: State<'_, AppState>,
    shell: String,
    args: Vec<String>,
    env: HashMap<String, String>,
    cwd: Option<String>,
    session_id: Option<String>,
) -> Result<String, AppError> {
    let id = session_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let mut manager = state.pty_manager.lock().await;
    manager.spawn(id.clone(), shell, args, env, cwd, window).await?;
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
