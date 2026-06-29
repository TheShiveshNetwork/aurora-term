use std::path::PathBuf;
use aurora_commands::state::AppState;
use aurora_config::{ConfigManager, UiStateManager};
use aurora_pty::{PtyManager, PtyEvent};
use aurora_db::HistoryDb;
use tauri::{Manager, Emitter};
use tauri_plugin_prevent_default::Flags;

fn start_pty_event_bridge(
    app_handle: tauri::AppHandle,
    mut receiver: tokio::sync::mpsc::UnboundedReceiver<PtyEvent>,
) {
    tokio::spawn(async move {
        let mut buffers: std::collections::HashMap<std::sync::Arc<str>, String> = std::collections::HashMap::new();
        let mut interval = tokio::time::interval(std::time::Duration::from_millis(16));
        
        loop {
            tokio::select! {
                maybe_event = receiver.recv() => {
                    match maybe_event {
                        Some(PtyEvent::Data { session_id, data }) => {
                            buffers.entry(session_id).or_default().push_str(&data);
                        }
                        Some(PtyEvent::Exit { session_id, exit_code }) => {
                            if let Some(buffered) = buffers.remove(&session_id) {
                                if !buffered.is_empty() {
                                    let _ = app_handle.emit("pty_data", serde_json::json!({
                                        "session_id": &*session_id,
                                        "data": buffered,
                                    }));
                                }
                            }
                            let _ = app_handle.emit("pty_exit", serde_json::json!({
                                "session_id": &*session_id,
                                "exit_code": exit_code,
                            }));
                        }
                        None => {
                            for (session_id, buffered) in buffers {
                                if !buffered.is_empty() {
                                    let _ = app_handle.emit("pty_data", serde_json::json!({
                                        "session_id": &*session_id,
                                        "data": buffered,
                                    }));
                                }
                            }
                            break;
                        }
                    }
                }
                _ = interval.tick() => {
                    for (session_id, buffered) in buffers.iter_mut() {
                        if !buffered.is_empty() {
                            let _ = app_handle.emit("pty_data", serde_json::json!({
                                "session_id": &**session_id,
                                "data": std::mem::take(buffered),
                            }));
                        }
                    }
                }
            }
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_prevent_default::Builder::new()
                .with_flags(Flags::keyboard())
                .build()
        )
        .plugin(tauri_plugin_window_state::Builder::default()
            .with_denylist(&["settings"])
            .build())
        .setup(|app| {
            // Resolve platform-specific config directory (single source of truth for persistence)
            let config_dir = app.path()
                .app_config_dir()
                .map_err(|e| anyhow::anyhow!("Failed to get app config dir: {}", e))?;

            // Load UI state first so we can get the last project dir
            let mut ui_state_manager = UiStateManager::new(config_dir.clone());
            let ui_state = ui_state_manager.load();

            // Determine project directory from state
            let project_dir: Option<PathBuf> = ui_state.last_project_dir.clone().map(PathBuf::from);

            // Initialize config manager (global + project tier)
            let mut config_manager = ConfigManager::new(config_dir.clone(), project_dir);
            let _ = config_manager.load()
                .unwrap_or_else(|e| {
                    tracing::error!("Failed to load config, using defaults: {}", e);
                    aurora_core::config::AppConfig::default()
                });

            // Initialize History Database on startup
            let history_db = HistoryDb::new(Some(config_dir))?;

            let pty_manager = PtyManager::new();
            let (pty_sender, pty_receiver) = tokio::sync::mpsc::unbounded_channel::<PtyEvent>();

            start_pty_event_bridge(app.handle().clone(), pty_receiver);

            let app_state = AppState::new(
                pty_manager,
                config_manager,
                ui_state_manager,
                history_db,
                pty_sender,
            );
            app.manage(app_state);

            // Spawn aurora-agent sidecar asynchronously on startup
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let state_ref = app_handle.state::<AppState>();
                if let Err(e) = aurora_commands::spawn_sidecar_internal(app_handle.clone(), state_ref).await {
                    tracing::error!("Failed to spawn aurora-agent sidecar on startup: {:?}", e);
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            aurora_commands::pty_spawn,
            aurora_commands::pty_write,
            aurora_commands::pty_resize,
            aurora_commands::pty_kill,
            aurora_commands::get_cwd,
            aurora_commands::read_dir,
            aurora_commands::search_files,
            aurora_commands::read_file_content,
            aurora_commands::read_file_base64,
            aurora_commands::write_file_content,
            aurora_commands::history_search,
            aurora_commands::history_add,
            // Config commands
            aurora_commands::config_get,
            aurora_commands::config_get_global,
            aurora_commands::config_get_project,
            aurora_commands::config_save_global,
            aurora_commands::config_save_project,
            aurora_commands::config_has_project,
            // State commands
            aurora_commands::state_get,
            aurora_commands::state_update_sidebar,
            aurora_commands::state_update_pinned_tabs,
            aurora_commands::state_update_section_visibility,
            aurora_commands::state_update_tabs,
            aurora_commands::state_set_project_dir,
            aurora_commands::state_set_workspace_cwd,
            // AI commands
            aurora_commands::ai_save_api_key,
            aurora_commands::ai_delete_api_key,
            aurora_commands::ai_provider_status,
            aurora_commands::ai_translate_command,
            aurora_commands::ai_explain_error,
            aurora_commands::ai_test_provider,
            aurora_commands::process_list,
            aurora_commands::process_kill,
            aurora_commands::get_system_info,
            aurora_commands::get_cwd_info,
            aurora_commands::get_current_pwd,
            aurora_commands::read_shell_history,
            aurora_commands::reveal_in_explorer,
            aurora_commands::delete_path,
            aurora_commands::rename_path,
            aurora_commands::copy_path,
            aurora_commands::move_path,
            aurora_commands::select_folder,
            aurora_commands::select_file,
            aurora_commands::create_path,
            aurora_commands::watch_directory,
            aurora_commands::watch_git,
            aurora_commands::unwatch_git,
            aurora_commands::get_git_branch,
            aurora_commands::get_git_log,
            aurora_commands::get_git_file_log,
            aurora_commands::get_git_graph,
            aurora_commands::get_git_file_diff,
            aurora_commands::get_git_commit_diff,
            aurora_commands::get_git_file_content_at_commit,
            aurora_commands::get_git_commit_files,
            aurora_commands::git_status,
            aurora_commands::git_add,
            aurora_commands::git_reset,
            aurora_commands::git_restore,
            aurora_commands::git_commit,
            aurora_commands::git_push,
            aurora_commands::git_pull,
            aurora_commands::git_fetch,
            aurora_commands::git_checkout,
            aurora_commands::git_branch_create,
            aurora_commands::git_branch_delete,
            aurora_commands::git_branch_list,
            aurora_commands::git_diff_unstaged,
            aurora_commands::git_diff_staged,
            aurora_commands::git_log_oneline,
            aurora_commands::git_clone,
            aurora_commands::git_remote_list,
            aurora_commands::git_exec,
            aurora_commands::agent_plan_step,
            aurora_commands::get_available_commands,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app_handle.try_state::<AppState>() {
                    let sidecar = state.sidecar.clone();
                    tauri::async_runtime::block_on(async move {
                        let mut lock = sidecar.lock().await;
                        let _ = lock.kill().await;
                    });
                }
            }
        });
}
