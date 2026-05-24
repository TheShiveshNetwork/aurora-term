pub mod error;
pub mod config;
pub mod history;
pub mod pty;
pub mod ai;
pub mod state;
pub mod commands;
pub mod watcher;

use state::AppState;
use config::{ConfigLoader, AppConfig};
use history::HistoryDb;
use pty::PtyManager;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Load config or write default
            let config_loader = ConfigLoader::new(app)?;
            let config = config_loader.load().unwrap_or_else(|_| AppConfig::default());

            // Initialize SQLite DB
            let history_db = HistoryDb::new(app)?;

            // Initialize PTY manager
            let pty_manager = PtyManager::new();

            // Store shared AppState
            let state = AppState::new(pty_manager, history_db, config);
            app.manage(state);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::pty_spawn,
            commands::pty_write,
            commands::pty_resize,
            commands::pty_kill,
            commands::get_cwd,
            commands::read_dir,
            commands::read_file_content,
            commands::read_file_base64,
            commands::write_file_content,
            commands::history_search,
            commands::history_add,
            commands::config_get,
            commands::config_set,
            commands::ai_save_api_key,
            commands::ai_delete_api_key,
            commands::ai_provider_status,
            commands::ai_translate_command,
            commands::ai_explain_error,
            commands::ai_test_provider,
            commands::process_list,
            commands::process_kill,
            commands::get_system_info,
            commands::get_current_pwd,
            commands::read_shell_history,
            commands::reveal_in_explorer,
            commands::delete_path,
            commands::rename_path,
            commands::select_folder,
            commands::select_file,
            commands::watch_directory,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
