use tauri::{command, State};
use crate::state::AppState;
use aurora_core::AppError;
use aurora_db::{HistoryEntry, fuzzy_search_history};

#[command]
pub async fn history_search(
    state: State<'_, AppState>,
    query: String,
    limit: usize,
) -> Result<Vec<HistoryEntry>, AppError> {
    let db_guard = state.get_or_init_db().await?;
    let db = db_guard.as_ref().expect("HistoryDb just initialised");
    fuzzy_search_history(db, &query, limit)
}

#[command]
pub async fn history_add(
    state: State<'_, AppState>,
    entry: HistoryEntry,
) -> Result<(), AppError> {
    let db_guard = state.get_or_init_db().await?;
    let db = db_guard.as_ref().expect("HistoryDb just initialised");
    db.add_entry(&entry)
}
