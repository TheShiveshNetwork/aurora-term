/// Unified error type for the entire aurora-term workspace.
/// No external crate dependencies in From impls — conversions
/// happen at call sites via `.map_err(|e| AppError::Xx(e.to_string()))`.
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
    #[error("Sidecar error: {0}")]
    Sidecar(String),
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Io(e.to_string())
    }
}
