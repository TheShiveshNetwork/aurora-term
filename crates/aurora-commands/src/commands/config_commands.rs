use tauri::{command, State, Emitter, Manager};
use crate::state::AppState;
use aurora_core::config::AppConfig;
use aurora_core::AppError;

#[command]
pub async fn config_get(
    state: State<'_, AppState>,
) -> Result<AppConfig, AppError> {
    let config = state.config.lock().await;
    Ok(config.clone())
}

#[command]
pub async fn config_get_global(
    state: State<'_, AppState>,
) -> Result<AppConfig, AppError> {
    let cm = state.config_manager.lock().await;
    Ok(cm.global_config.clone())
}

#[command]
pub async fn config_get_project(
    state: State<'_, AppState>,
) -> Result<Option<AppConfig>, AppError> {
    let cm = state.config_manager.lock().await;
    Ok(cm.project_config.clone())
}

#[command]
pub async fn config_save_global(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    config: AppConfig,
) -> Result<(), AppError> {
    let mut cm = state.config_manager.lock().await;
    cm.save_global(&config)?;
    // Update the in-memory merged config
    let mut merged = state.config.lock().await;
    *merged = if let Some(ref proj) = cm.project_config {
        let mut gv = serde_json::to_value(&config)
            .map_err(|e| AppError::Config(format!("Serialize error: {}", e)))?;
        let pv = serde_json::to_value(proj)
            .map_err(|e| AppError::Config(format!("Serialize error: {}", e)))?;
        aurora_config::manager::deep_merge_raw(&mut gv, &pv);
        serde_json::from_value(gv)
            .map_err(|e| AppError::Config(format!("Deserialize error: {}", e)))?
    } else {
        config
    };
    let _ = app.emit("config_changed", merged.clone());

    // Restart sidecar asynchronously to pick up new config/keys
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        let state_ref = app_clone.state::<AppState>();
        if let Err(e) = crate::sidecar_commands::spawn_sidecar_internal(app_clone.clone(), state_ref).await {
            tracing::error!("Failed to restart sidecar on config save: {:?}", e);
        }
    });

    Ok(())
}

#[command]
pub async fn config_save_project(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    config: AppConfig,
) -> Result<(), AppError> {
    let mut cm = state.config_manager.lock().await;
    cm.save_project(&config)?;
    // Update in-memory merged config
    let mut merged = state.config.lock().await;
    let mut gv = serde_json::to_value(&cm.global_config)
        .map_err(|e| AppError::Config(format!("Serialize error: {}", e)))?;
    let pv = serde_json::to_value(&config)
        .map_err(|e| AppError::Config(format!("Serialize error: {}", e)))?;
    aurora_config::manager::deep_merge_raw(&mut gv, &pv);
    *merged = serde_json::from_value(gv)
        .map_err(|e| AppError::Config(format!("Deserialize error: {}", e)))?;
    let _ = app.emit("config_changed", merged.clone());

    // Restart sidecar asynchronously to pick up new config/keys
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        let state_ref = app_clone.state::<AppState>();
        if let Err(e) = crate::sidecar_commands::spawn_sidecar_internal(app_clone.clone(), state_ref).await {
            tracing::error!("Failed to restart sidecar on project config save: {:?}", e);
        }
    });

    Ok(())
}

#[command]
pub async fn config_has_project(
    state: State<'_, AppState>,
) -> Result<bool, AppError> {
    let cm = state.config_manager.lock().await;
    Ok(cm.has_project())
}
