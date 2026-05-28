use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum PaneType {
    Terminal,
    Editor,
    Browser,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TermSession {
    pub id: String,
    pub shell: String,
    pub cwd: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EditorSession {
    pub id: String,
    pub file_path: String,
    pub dirty: bool,
}
