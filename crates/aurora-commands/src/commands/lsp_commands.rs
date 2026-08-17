use std::path::PathBuf;
use tauri::{command, State, Emitter, Manager};
use crate::state::AppState;
use aurora_lsp::{LspIncoming, narrow_root};
use aurora_lsp_fetch::{ensure_installed, spec_for};

/// Ensure the server for `language_id` is fetched (if needed), then started,
/// scoped to `(language_id, project_root)`. Safe to call repeatedly — already
/// running servers are no-ops.
///
/// `file_path` (the file being opened) is used to narrow the workspace root to
/// the nearest manifest (Cargo.toml / go.mod / tsconfig.json / …) so a server
/// never indexes an entire monorepo. Returns the `server_key` the frontend must
/// use for subsequent `lsp_send`/`lsp_stop` calls and event subscription.
#[command]
pub async fn lsp_ensure_and_start(
    state: State<'_, AppState>,
    language_id: String,
    root: String,
    file_path: String,
) -> Result<String, String> {
    let spec = spec_for(&language_id).ok_or_else(|| {
        format!("no built-in language server registered for '{}'", language_id)
    })?;

    let resolved = ensure_installed(spec, &state.lsp_cache_dir)
        .await
        .map_err(|e| e.to_string())?;

    let mut args: Vec<String> = resolved.base_args;
    args.extend(spec.args.iter().map(|s| s.to_string()));

    let root_path = PathBuf::from(&root);
    let file_path_buf = PathBuf::from(&file_path);
    let narrowed = narrow_root(&language_id, &root_path, &file_path_buf);
    let server_key = format!("{}|{}", language_id, narrowed.to_string_lossy());

    {
        let mut mgr = state.lsp_manager.lock().await;
        mgr.start(aurora_lsp::LspStartParams {
            server_key: server_key.clone(),
            language_id,
            exec: resolved.program,
            args,
            root: narrowed,
            weight: spec.weight(),
            runtime: spec.runtime(),
        })
        .await
        .map_err(|e| e.to_string())?;
    }
    Ok(server_key)
}

/// Send a raw JSON-RPC message (without headers) to the running server.
#[command]
pub async fn lsp_send(
    state: State<'_, AppState>,
    server_key: String,
    message: String,
) -> Result<(), String> {
    let mut mgr = state.lsp_manager.lock().await;
    mgr.send(&server_key, message).await.map_err(|e| e.to_string())
}

/// Stop the running server for `server_key`.
#[command]
pub async fn lsp_stop(state: State<'_, AppState>, server_key: String) -> Result<(), String> {
    let mut mgr = state.lsp_manager.lock().await;
    mgr.stop(&server_key).await.map_err(|e| e.to_string())
}

/// Spawn the background task that forwards decoded server messages to the
/// frontend. Every message — including server-loss notifications — is emitted on
/// a single `lsp-message` channel carrying the full `LspIncoming` payload. The
/// frontend routes by `server_key` (server keys contain `|` and path
/// separators, which are illegal in Tauri event names, so per-server channels
/// are not possible). Called once at startup.
pub fn start_lsp_event_bridge(
    app_handle: tauri::AppHandle,
    mut rx: tokio::sync::mpsc::UnboundedReceiver<LspIncoming>,
) {
    tauri::async_runtime::spawn(async move {
        while let Some(msg) = rx.recv().await {
            let _ = app_handle.emit("lsp-message", &msg);
        }
    });
}

/// Spawn the idle-sweep loop that kills unused language servers and restarts
/// crashed ones (with backoff).
pub fn start_lsp_idle_sweep(app: &tauri::AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
        loop {
            interval.tick().await;
            let state = app.state::<AppState>();
            let mut mgr = state.lsp_manager.lock().await;
            mgr.tick().await;
        }
    });
}
