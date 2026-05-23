use tauri::command;
use crate::error::AppError;
use serde::{Serialize, Deserialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessInfo {
    pub pid: u32,
    pub command: String,
    pub status: String,
}

#[command]
pub async fn process_list() -> Result<Vec<ProcessInfo>, AppError> {
    // Stub processes listing
    Ok(vec![])
}

#[command]
pub async fn process_kill(_pid: u32) -> Result<(), AppError> {
    Ok(())
}
