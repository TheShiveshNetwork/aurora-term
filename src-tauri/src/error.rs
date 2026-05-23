#[derive(Debug, thiserror::Error, serde::Serialize)]
pub enum AppError {
    #[error("PTY error: {0}")]
    Pty(String),
    #[error("AI error: {0}")]
    Ai(String),
    #[error("Database error: {0}")]
    Db(String),
    #[error("Config error: {0}")]
    Config(String),
    #[error("IO error: {0}")]
    Io(String),
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Io(e.to_string())
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        AppError::Db(e.to_string())
    }
}
