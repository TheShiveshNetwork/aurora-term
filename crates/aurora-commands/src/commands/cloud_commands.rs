use tauri::{command, State};

use aurora_core::config::AppConfig;
use aurora_core::types::sync::{AuthStatus, SyncAction, SyncResult, SyncStatus};
use aurora_core::AppError;
use aurora_cloud::{run_oauth_flow, SessionStore};

use crate::state::AppState;

async fn current_base_url(state: &State<'_, AppState>) -> String {
    let cfg = state.config.lock().await;
    cfg.cloud.api_base_url.clone()
}

fn recompute_merged(
    config_manager: &aurora_config::ConfigManager,
) -> Result<AppConfig, AppError> {
    let mut gv = serde_json::to_value(&config_manager.global_config)
        .map_err(|e| AppError::Config(format!("Serialize error: {}", e)))?;
    if let Some(ref proj) = config_manager.project_config {
        let pv = serde_json::to_value(proj)
            .map_err(|e| AppError::Config(format!("Serialize error: {}", e)))?;
        aurora_config::manager::deep_merge_raw(&mut gv, &pv);
    }
    serde_json::from_value(gv)
        .map_err(|e| AppError::Config(format!("Deserialize error: {}", e)))
}

#[command]
pub async fn cloud_auth_status(state: State<'_, AppState>) -> Result<AuthStatus, AppError> {
    let _ = state;
    Ok(SessionStore::auth_status())
}

#[command]
pub async fn cloud_sign_in_password(
    state: State<'_, AppState>,
    email: String,
    password: String,
) -> Result<AuthStatus, AppError> {
    let base_url = current_base_url(&state).await;
    let client = aurora_cloud::CloudClient::new(base_url);
    let auth = client.sign_in_password(&email, &password).await?;
    SessionStore::save_session(&auth.token, &auth.email)?;
    Ok(SessionStore::auth_status())
}

#[command]
pub async fn cloud_sign_in_oauth(
    state: State<'_, AppState>,
    provider: String,
) -> Result<AuthStatus, AppError> {
    let base_url = current_base_url(&state).await;
    let client = aurora_cloud::CloudClient::new(base_url);
    let email = run_oauth_flow(&client, &provider).await?;
    Ok(AuthStatus {
        signed_in: true,
        email: Some(email),
    })
}

#[command]
pub async fn cloud_sign_out(state: State<'_, AppState>) -> Result<(), AppError> {
    let base_url = current_base_url(&state).await;
    if let Some(token) = SessionStore::load_token() {
        let client = aurora_cloud::CloudClient::new(base_url);
        let _ = client.logout(&token).await;
    }
    SessionStore::clear_session();
    Ok(())
}

#[command]
pub async fn cloud_sync_now(
    state: State<'_, AppState>,
    config: AppConfig,
) -> Result<SyncResult, AppError> {
    let base_url = current_base_url(&state).await;
    let mut sync_manager = state.cloud.lock().await;
    sync_manager.set_base_url(base_url);

    let result = sync_manager.sync_now(&config).await?;
    drop(sync_manager);

    if result.status == SyncStatus::Pulled {
        if let Some(payload) = &result.remote_payload {
            let mut cm = state.config_manager.lock().await;
            aurora_cloud::SyncManager::apply_payload(&mut cm, payload)?;
            let merged = recompute_merged(&cm)?;
            let mut merged_config = state.config.lock().await;
            *merged_config = merged;
        }
    }
    Ok(result)
}

#[command]
pub async fn cloud_resolve_conflict(
    state: State<'_, AppState>,
    action: SyncAction,
    config: AppConfig,
    remote_version: String,
) -> Result<SyncResult, AppError> {
    let base_url = current_base_url(&state).await;
    let mut sync_manager = state.cloud.lock().await;
    sync_manager.set_base_url(base_url);

    let result = sync_manager
        .resolve_conflict(&config, &remote_version, action)
        .await?;
    drop(sync_manager);

    // Merge pushes a blended document and KeepCloud pulls the remote one —
    // both leave the local config behind, so persist the resolved document.
    let should_apply = result.status == SyncStatus::Pulled
        || (action == SyncAction::Merge && result.status == SyncStatus::Pushed);
    if should_apply {
        if let Some(payload) = &result.remote_payload {
            let mut cm = state.config_manager.lock().await;
            aurora_cloud::SyncManager::apply_payload(&mut cm, payload)?;
            let merged = recompute_merged(&cm)?;
            let mut merged_config = state.config.lock().await;
            *merged_config = merged;
        }
    }
    Ok(result)
}
