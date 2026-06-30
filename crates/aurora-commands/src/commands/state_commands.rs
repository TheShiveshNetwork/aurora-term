use std::collections::HashMap;
use std::path::PathBuf;
use tauri::{command, State};
use crate::state::AppState;
use aurora_config::state::{UiState, SavedTab};
use aurora_core::AppError;

#[command]
pub async fn state_get(
    state: State<'_, AppState>,
) -> Result<UiState, AppError> {
    let us = state.ui_state.lock().await;
    Ok(us.state.clone())
}

#[command]
pub async fn state_update_sidebar(
    state: State<'_, AppState>,
    collapsed: bool,
    visible: bool,
    show_ai_bar: bool,
    chat_input_open: bool,
) -> Result<(), AppError> {
    let mut us = state.ui_state.lock().await;
    us.update_sidebar(collapsed, visible, show_ai_bar, chat_input_open)
}

#[command]
pub async fn state_update_pinned_tabs(
    state: State<'_, AppState>,
    pinned: Vec<String>,
) -> Result<(), AppError> {
    let mut us = state.ui_state.lock().await;
    us.update_pinned_tabs(pinned)
}

#[command]
pub async fn state_update_section_visibility(
    state: State<'_, AppState>,
    sections: HashMap<String, bool>,
) -> Result<(), AppError> {
    let mut us = state.ui_state.lock().await;
    us.update_section_visibility(sections)
}

#[command]
pub async fn state_update_tabs(
    state: State<'_, AppState>,
    tabs: Vec<SavedTab>,
    active_id: Option<String>,
) -> Result<(), AppError> {
    let mut us = state.ui_state.lock().await;
    us.update_tabs(tabs, active_id)
}

#[command]
pub async fn state_set_project_dir(
    state: State<'_, AppState>,
    path: Option<String>,
) -> Result<(), AppError> {
    {
        let mut us = state.ui_state.lock().await;
        us.set_project_dir(path.clone())?;
    }

    let project_dir = path.map(PathBuf::from);
    let mut cm = state.config_manager.lock().await;
    let new_merged = cm.set_project_dir(project_dir)?;

    {
        let mut config = state.config.lock().await;
        *config = new_merged.clone();
    }

    Ok(())
}

#[command]
pub async fn state_set_workspace_cwd(
    state: State<'_, AppState>,
    path: Option<String>,
) -> Result<(), AppError> {
    let mut us = state.ui_state.lock().await;
    us.set_workspace_cwd(path)
}
