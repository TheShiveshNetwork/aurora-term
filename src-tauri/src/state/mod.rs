use std::sync::Arc;
use tokio::sync::Mutex;
use crate::pty::manager::PtyManager;
use crate::history::db::HistoryDb;
use crate::config::schema::AppConfig;

pub struct AppState {
    pub pty_manager: Arc<Mutex<PtyManager>>,
    pub history_db: Arc<Mutex<HistoryDb>>,
    pub config: Arc<Mutex<AppConfig>>,
}

impl AppState {
    pub fn new(
        pty_manager: PtyManager,
        history_db: HistoryDb,
        config: AppConfig,
    ) -> Self {
        Self {
            pty_manager: Arc::new(Mutex::new(pty_manager)),
            history_db: Arc::new(Mutex::new(history_db)),
            config: Arc::new(Mutex::new(config)),
        }
    }
}
