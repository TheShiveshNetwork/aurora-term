use tauri::{command, AppHandle, State};

use aurora_core::types::sync::{UpdateInfo, UpdateStatus};
use aurora_core::AppError;

use crate::state::AppState;

#[command]
pub async fn update_check(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<UpdateInfo, AppError> {
    let (enabled, base_url, current) = {
        let cfg = state.config.lock().await;
        let current = app.package_info().version.to_string();
        (cfg.updates.enabled, cfg.cloud.api_base_url.clone(), current)
    };

    if !enabled {
        return Ok(UpdateInfo {
            status: UpdateStatus::Disabled,
            available: false,
            current_version: current.clone(),
            latest_version: current,
            url: None,
            notes: None,
            published_at: None,
            dismissed: false,
        });
    }

    let mut client = state.updates.lock().await;
    client.set_base_url(base_url);
    let mut info = client.check(&current).await?;
    drop(client);

    let dismissed = {
        let ui = state.ui_state.lock().await;
        ui.state.dismissed_update_version.clone()
    };
    info.dismissed = dismissed.as_deref() == Some(info.latest_version.as_str());
    Ok(info)
}

#[command]
pub async fn update_dismiss(
    state: State<'_, AppState>,
    version: String,
) -> Result<(), AppError> {
    let mut ui = state.ui_state.lock().await;
    ui.state.dismissed_update_version = Some(version);
    ui.save()?;
    Ok(())
}
