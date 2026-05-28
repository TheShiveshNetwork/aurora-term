use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum BlockStatus {
    Running,
    Success,
    Error,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum OutputType {
    Plain,
    Json,
    Diff,
    Image,
    Markdown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Block {
    pub id: String,
    pub session_id: String,
    pub command: String,
    pub started_at: i64,
    pub finished_at: Option<i64>,
    pub exit_code: Option<i32>,
    pub status: BlockStatus,
    pub output_type: OutputType,
    pub collapsed: bool,
    pub ai_explain: Option<String>,
    pub bookmarked: bool,
}
