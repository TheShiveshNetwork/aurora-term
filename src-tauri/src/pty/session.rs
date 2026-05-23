use std::io::{Read, Write};
use tauri::{Window, Emitter};
use serde::Serialize;
use portable_pty::{MasterPty, PtySize};
use crate::error::AppError;

#[derive(Debug, Clone, Serialize)]
pub struct PtyDataPayload {
    pub session_id: String,
    pub data: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PtyExitPayload {
    pub session_id: String,
    pub exit_code: i32,
}

pub struct PtySession {
    pub session_id: String,
    pub master: Box<dyn MasterPty + Send>,
    pub writer: Box<dyn Write + Send>,
}

impl PtySession {
    pub fn new(
        session_id: String,
        master: Box<dyn MasterPty + Send>,
        writer: Box<dyn Write + Send>,
    ) -> Self {
        Self {
            session_id,
            master,
            writer,
        }
    }

    pub fn write(&mut self, data: &str) -> Result<(), AppError> {
        self.writer
            .write_all(data.as_bytes())
            .map_err(|e| AppError::Pty(format!("Failed to write to PTY: {}", e)))?;
        self.writer
            .flush()
            .map_err(|e| AppError::Pty(format!("Failed to flush PTY: {}", e)))?;
        Ok(())
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), AppError> {
        self.master
            .resize(PtySize {
                cols,
                rows,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| AppError::Pty(format!("Failed to resize PTY: {}", e)))?;
        Ok(())
    }
}

pub fn start_reader_loop(
    mut reader: Box<dyn Read + Send>,
    session_id: String,
    window: Window,
) {
    tokio::task::spawn_blocking(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => {
                    let _ = window.emit(
                        "pty_exit",
                        PtyExitPayload {
                            session_id: session_id.clone(),
                            exit_code: 0,
                        },
                    );
                    break;
                }
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = window.emit(
                        "pty_data",
                        PtyDataPayload {
                            session_id: session_id.clone(),
                            data,
                        },
                    );
                }
            }
        }
    });
}
