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

/// Downloads the latest release artifact from the backend's release cache and
/// runs it (in-place upgrade). Built defensively: if the URL is not a direct
/// installer asset (e.g. a release page served as HTML), it errors out so the
/// frontend can fall back to opening the release URL in a browser.
#[command]
pub async fn update_install(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let (enabled, base_url, current) = {
        let cfg = state.config.lock().await;
        let current = app.package_info().version.to_string();
        (cfg.updates.enabled, cfg.cloud.api_base_url.clone(), current)
    };

    if !enabled {
        return Err(AppError::Update("Updates are disabled".to_string()));
    }

    let mut client = state.updates.lock().await;
    client.set_base_url(base_url);
    let info = client.check(&current).await?;
    drop(client);

    if !info.available {
        return Err(AppError::Update("No update available".to_string()));
    }
    let Some(url) = info.url.clone() else {
        return Err(AppError::Update("Update has no download URL".to_string()));
    };

    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| AppError::Update(format!("HTTP client error: {e}")))?;

    let resp = http
        .get(&url)
        .send()
        .await
        .map_err(|e| AppError::Update(format!("Download failed: {e}")))?;
    if !resp.status().is_success() {
        return Err(AppError::Update(format!(
            "Download failed with status {}",
            resp.status()
        )));
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| AppError::Update(format!("Read body failed: {e}")))?;

    // Defensive sniff: if the "asset" is actually an HTML page (release notes),
    // bail so the frontend can fall back to opening the release URL.
    if bytes.len() >= 5 && (&bytes[..5] == b"<!DOC" || &bytes[..5] == b"<html") {
        return Err(AppError::Update(
            "Update URL is not a direct installer asset".to_string(),
        ));
    }

    let ext = extension_from_url(&url).unwrap_or_else(default_ext);
    let tmp = std::env::temp_dir().join(format!("aurora-update-{}{}", info.latest_version, ext));
    std::fs::write(&tmp, &bytes)
        .map_err(|e| AppError::Update(format!("Failed to write installer: {e}")))?;

    run_installer(&tmp).map_err(AppError::Update)?;
    Ok(())
}

fn extension_from_url(url: &str) -> Option<String> {
    let path = url.split('?').next().unwrap_or(url);
    let last = path.rsplit('/').next()?;
    let ext = last.rsplit('.').next()?;
    if ext.is_empty() || ext == last {
        None
    } else {
        Some(format!(".{ext}"))
    }
}

#[cfg(windows)]
fn default_ext() -> String {
    ".exe".to_string()
}

#[cfg(not(windows))]
fn default_ext() -> String {
    ".run".to_string()
}

#[cfg(windows)]
fn run_installer(path: &std::path::Path) -> Result<(), String> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    // `.msi` packages must be launched through msiexec rather than directly.
    let status = if ext == "msi" {
        std::process::Command::new("msiexec")
            .arg("/i")
            .arg(path)
            .arg("/passive")
            .status()
    } else {
        std::process::Command::new(path).status()
    }
    .map_err(|e| format!("Failed to launch installer: {e}"))?;
    if !status.success() {
        return Err(format!("Installer exited with status {status}"));
    }
    Ok(())
}

#[cfg(not(windows))]
fn run_installer(_path: &std::path::Path) -> Result<(), String> {
    Err("Automatic install is only supported on Windows".to_string())
}
