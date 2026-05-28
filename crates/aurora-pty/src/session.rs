use std::io::{Read, Write};
use serde::Serialize;
use portable_pty::{MasterPty, PtySize};
use aurora_core::AppError;

/// Events emitted by the PTY reader loop.
/// The consuming layer (aurora-app) translates these into
/// Tauri window.emit() calls.
#[derive(Debug, Clone, Serialize)]
pub enum PtyEvent {
    Data {
        session_id: String,
        data: String,
    },
    Exit {
        session_id: String,
        exit_code: i32,
    },
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

/// Starts the blocking reader loop in a tokio::spawn_blocking task.
/// Sends PtyEvent::Data and PtyEvent::Exit through the provided sender.
/// This is decoupled from Tauri — the caller (aurora-app) bridges
/// these events to window.emit().
pub fn start_reader_loop(
    mut reader: Box<dyn Read + Send>,
    session_id: String,
    sender: tokio::sync::mpsc::UnboundedSender<PtyEvent>,
) {
    tokio::task::spawn_blocking(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => {
                    let _ = sender.send(PtyEvent::Exit {
                        session_id: session_id.clone(),
                        exit_code: 0,
                    });
                    break;
                }
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = sender.send(PtyEvent::Data {
                        session_id: session_id.clone(),
                        data,
                    });
                }
            }
        }
    });
}
