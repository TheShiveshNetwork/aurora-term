use std::collections::HashMap;

use tauri::Window;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use crate::error::AppError;
use crate::pty::session::{PtySession, start_reader_loop};

pub struct PtyManager {
    sessions: HashMap<String, PtySession>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }

    pub async fn spawn(
        &mut self,
        session_id: String,
        shell: String,
        args: Vec<String>,
        env: HashMap<String, String>,
        cwd: Option<String>,
        window: Window,
    ) -> Result<(), AppError> {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                cols: 80,
                rows: 24,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| AppError::Pty(format!("Failed to open PTY: {}", e)))?;

        let mut cmd = CommandBuilder::new(&shell);
        cmd.args(&args);
        
        if let Some(dir) = cwd {
            cmd.cwd(dir);
        }
        
        // Set standard env variables
        for (k, v) in env {
            cmd.env(k, v);
        }

        // Set default TERM if not present
        cmd.env("TERM", "xterm-256color");

        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| AppError::Pty(format!("Failed to clone reader: {}", e)))?;

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| AppError::Pty(format!("Failed to take writer: {}", e)))?;

        let _child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| AppError::Pty(format!("Failed to spawn shell command: {}", e)))?;

        // Start standard reader loop in thread
        start_reader_loop(reader, session_id.clone(), window);

        let session = PtySession::new(session_id.clone(), pair.master, writer);
        self.sessions.insert(session_id, session);

        Ok(())
    }

    pub fn write(&mut self, session_id: &str, data: &str) -> Result<(), AppError> {
        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or_else(|| AppError::Pty(format!("PTY session not found: {}", session_id)))?;
        session.write(data)
    }

    pub fn resize(&self, session_id: &str, cols: u16, rows: u16) -> Result<(), AppError> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| AppError::Pty(format!("PTY session not found: {}", session_id)))?;
        session.resize(cols, rows)
    }

    pub fn kill(&mut self, session_id: &str) -> Result<(), AppError> {
        if self.sessions.remove(session_id).is_some() {
            Ok(())
        } else {
            Err(AppError::Pty(format!("PTY session not found: {}", session_id)))
        }
    }
}
