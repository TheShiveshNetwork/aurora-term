use tauri::{command, State, AppHandle};
use crate::state::AppState;
use crate::error::AppError;
use crate::config::{AppConfig, ConfigLoader};

#[command]
pub async fn config_get(
    state: State<'_, AppState>,
) -> Result<AppConfig, AppError> {
    let config = state.config.lock().await;
    Ok(config.clone())
}

#[command]
pub async fn config_set(
    app: AppHandle,
    state: State<'_, AppState>,
    config: AppConfig,
) -> Result<(), AppError> {
    let mut state_config = state.config.lock().await;
    *state_config = config.clone();

    // Persist to disk
    let loader = ConfigLoader::new(&app)?;
    loader.save(&config)?;

    Ok(())
}
