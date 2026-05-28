use aurora_commands::state::AppState;
use aurora_config::ConfigLoader;
use aurora_core::config::AppConfig;
use aurora_db::HistoryDb;
use aurora_pty::{PtyManager, PtyEvent};
use tauri::{Manager, Emitter};
use tauri_plugin_prevent_default::Flags;

fn start_pty_event_bridge(
    app_handle: tauri::AppHandle,
    mut receiver: tokio::sync::mpsc::UnboundedReceiver<PtyEvent>,
) {
    tokio::spawn(async move {
        while let Some(event) = receiver.recv().await {
            match event {
                PtyEvent::Data { session_id, data } => {
                    let _ = app_handle.emit("pty_data", serde_json::json!({
                        "session_id": session_id,
                        "data": data,
                    }));
                }
                PtyEvent::Exit { session_id, exit_code } => {
                    let _ = app_handle.emit("pty_exit", serde_json::json!({
                        "session_id": session_id,
                        "exit_code": exit_code,
                    }));
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
        .setup(|app| {
            let config_loader = ConfigLoader::new(app)?;
            let config = config_loader.load().unwrap_or_else(|_| AppConfig::default());
            
            let db_dir = app.path()
                .app_data_dir()
                .map_err(|e| anyhow::anyhow!("Failed to get app data dir: {}", e))?;
            let history_db = HistoryDb::new(Some(db_dir))?;
            
            let pty_manager = PtyManager::new();
            let (pty_sender, pty_receiver) = tokio::sync::mpsc::unbounded_channel::<PtyEvent>();
            
            start_pty_event_bridge(app.handle().clone(), pty_receiver);
            
            let state = AppState::new(pty_manager, history_db, config, pty_sender);
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            aurora_commands::pty_spawn,
            aurora_commands::pty_write,
            aurora_commands::pty_resize,
            aurora_commands::pty_kill,
            aurora_commands::get_cwd,
            aurora_commands::read_dir,
            aurora_commands::read_file_content,
            aurora_commands::read_file_base64,
            aurora_commands::write_file_content,
            aurora_commands::history_search,
            aurora_commands::history_add,
            aurora_commands::config_get,
            aurora_commands::config_set,
            aurora_commands::ai_save_api_key,
            aurora_commands::ai_delete_api_key,
            aurora_commands::ai_provider_status,
            aurora_commands::ai_translate_command,
            aurora_commands::ai_explain_error,
            aurora_commands::ai_test_provider,
            aurora_commands::process_list,
            aurora_commands::process_kill,
            aurora_commands::get_system_info,
            aurora_commands::get_current_pwd,
            aurora_commands::read_shell_history,
            aurora_commands::reveal_in_explorer,
            aurora_commands::delete_path,
            aurora_commands::rename_path,
            aurora_commands::select_folder,
            aurora_commands::select_file,
            aurora_commands::watch_directory,
            aurora_commands::get_git_branch,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
