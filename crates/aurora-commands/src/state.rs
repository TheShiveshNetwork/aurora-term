use std::sync::Arc;
use tokio::sync::Mutex;
use aurora_pty::{PtyManager, PtyEvent};
use aurora_db::HistoryDb;
use aurora_config::{ConfigManager, UiStateManager};
use aurora_core::config::AppConfig;
use crate::watcher::{FileWatcher, GitWatcher};

pub struct AppState {
    pub pty_manager: Arc<Mutex<PtyManager>>,
    pub history_db: Arc<Mutex<HistoryDb>>,
    pub config: Arc<Mutex<AppConfig>>,
    pub config_manager: Arc<Mutex<ConfigManager>>,
    pub ui_state: Arc<Mutex<UiStateManager>>,
    pub file_watcher: FileWatcher,
    pub git_watcher: GitWatcher,
    pub sidecar: Arc<Mutex<aurora_sidecar::manager::SidecarManager>>,
    pub pty_event_sender: tokio::sync::mpsc::UnboundedSender<PtyEvent>,
}

impl AppState {
    pub fn new(
        pty_manager: PtyManager,
        config_manager: ConfigManager,
        ui_state_manager: UiStateManager,
        history_db: HistoryDb,
        pty_event_sender: tokio::sync::mpsc::UnboundedSender<PtyEvent>,
    ) -> Self {
        let merged_config = config_manager.merged_config.clone();
        Self {
            pty_manager: Arc::new(Mutex::new(pty_manager)),
            history_db: Arc::new(Mutex::new(history_db)),
            config: Arc::new(Mutex::new(merged_config)),
            config_manager: Arc::new(Mutex::new(config_manager)),
            ui_state: Arc::new(Mutex::new(ui_state_manager)),
            file_watcher: FileWatcher::new(),
            git_watcher: GitWatcher::new(),
            sidecar: Arc::new(Mutex::new(aurora_sidecar::manager::SidecarManager::new())),
            pty_event_sender,
        }
    }
}
