use tauri::{command, State};
use crate::state::AppState;
use crate::error::AppError;
use crate::history::{HistoryEntry, fuzzy_search_history};

#[command]
pub async fn history_search(
    state: State<'_, AppState>,
    query: String,
    limit: usize,
) -> Result<Vec<HistoryEntry>, AppError> {
    let db = state.history_db.lock().await;
    fuzzy_search_history(&db, &query, limit)
}

#[command]
pub async fn history_add(
    state: State<'_, AppState>,
    entry: HistoryEntry,
) -> Result<(), AppError> {
    let db = state.history_db.lock().await;
    db.add_entry(&entry)
}
