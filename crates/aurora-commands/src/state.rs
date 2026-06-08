use std::sync::Arc;
use tokio::sync::Mutex;
use aurora_pty::{PtyManager, PtyEvent};
use aurora_db::HistoryDb;
use aurora_core::AppConfig;
use crate::watcher::FileWatcher;

pub struct AppState {
    pub pty_manager: Arc<Mutex<PtyManager>>,
    pub history_db: Arc<Mutex<HistoryDb>>,
    pub config: Arc<Mutex<AppConfig>>,
    pub file_watcher: FileWatcher,
    pub sidecar: Arc<Mutex<aurora_sidecar::manager::SidecarManager>>,
    /// Channel sender for PTY events — passed to PtyManager on spawn.
    pub pty_event_sender: tokio::sync::mpsc::UnboundedSender<PtyEvent>,
}

impl AppState {
    pub fn new(
        pty_manager: PtyManager,
        history_db: HistoryDb,
        config: AppConfig,
        pty_event_sender: tokio::sync::mpsc::UnboundedSender<PtyEvent>,
    ) -> Self {
        Self {
            pty_manager: Arc::new(Mutex::new(pty_manager)),
            history_db: Arc::new(Mutex::new(history_db)),
            config: Arc::new(Mutex::new(config)),
            file_watcher: FileWatcher::new(),
            sidecar: Arc::new(Mutex::new(aurora_sidecar::manager::SidecarManager::new())),
            pty_event_sender,
        }
    }
}
