use std::sync::Arc;
use std::path::PathBuf;
use tokio::sync::Mutex;
use aurora_pty::{PtyManager, PtyEvent};
use aurora_db::HistoryDb;
use aurora_core::AppError;
use aurora_core::AppConfig;
use crate::watcher::{FileWatcher, GitWatcher};

pub struct AppState {
    pub pty_manager: Arc<Mutex<PtyManager>>,
    pub history_db: Arc<Mutex<Option<HistoryDb>>>,
    pub db_dir: Option<PathBuf>,
    pub config: Arc<Mutex<AppConfig>>,
    pub file_watcher: FileWatcher,
    pub git_watcher: GitWatcher,
    pub sidecar: Arc<Mutex<aurora_sidecar::manager::SidecarManager>>,
    /// Channel sender for PTY events — passed to PtyManager on spawn.
    pub pty_event_sender: tokio::sync::mpsc::UnboundedSender<PtyEvent>,
}

impl AppState {
    pub fn new(
        pty_manager: PtyManager,
        config: AppConfig,
        pty_event_sender: tokio::sync::mpsc::UnboundedSender<PtyEvent>,
        db_dir: Option<PathBuf>,
    ) -> Self {
        Self {
            pty_manager: Arc::new(Mutex::new(pty_manager)),
            history_db: Arc::new(Mutex::new(None)),
            db_dir,
            config: Arc::new(Mutex::new(config)),
            file_watcher: FileWatcher::new(),
            git_watcher: GitWatcher::new(),
            sidecar: Arc::new(Mutex::new(aurora_sidecar::manager::SidecarManager::new())),
            pty_event_sender,
        }
    }

    /// Lazily initialise the history database on first access.
    pub async fn get_or_init_db(&self) -> Result<tokio::sync::MutexGuard<'_, Option<HistoryDb>>, AppError> {
        let mut db = self.history_db.lock().await;
        if db.is_none() {
            let dir = self.db_dir.clone();
            *db = Some(HistoryDb::new(dir)?);
        }
        Ok(db)
    }
}
