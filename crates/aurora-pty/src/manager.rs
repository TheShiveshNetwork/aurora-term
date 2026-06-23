use std::collections::HashMap;

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use aurora_core::AppError;
use crate::session::{PtySession, PtyEvent, start_reader_loop};

#[derive(Default)]
pub struct PtyManager {
    sessions: HashMap<String, PtySession>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }

    /// Spawn a new PTY session. The reader loop sends events
    /// through the provided `event_sender`. The caller (aurora-app)
    /// is responsible for bridging these events to Tauri.
    pub async fn spawn(
        &mut self,
        session_id: String,
        shell: String,
        args: Vec<String>,
        env: HashMap<String, String>,
        cwd: Option<String>,
        event_sender: tokio::sync::mpsc::UnboundedSender<PtyEvent>,
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

        // Start reader loop with channel-based event delivery
        start_reader_loop(reader, session_id.clone(), event_sender);

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shell::detect_default_shell;
    use tokio::sync::mpsc;
    use std::time::Duration;

    #[tokio::test]
    async fn test_pty_spawn_and_write() {
        let mut manager = PtyManager::new();
        let (sender, mut receiver) = mpsc::unbounded_channel();
        let shell = detect_default_shell();
        let session_id = "test-session".to_string();

        manager.spawn(
            session_id.clone(),
            shell,
            vec![],
            std::collections::HashMap::new(),
            None,
            sender,
        ).await.unwrap();

        // Write a simple command to the PTY
        #[cfg(target_os = "windows")]
        manager.write("test-session", "echo hello_pty\r\n").unwrap();
        #[cfg(not(target_os = "windows"))]
        manager.write("test-session", "echo hello_pty\n").unwrap();

        // Read channel events to make sure we get the data output
        let mut found = false;
        let timeout = tokio::time::sleep(Duration::from_secs(3));
        tokio::pin!(timeout);

        loop {
            tokio::select! {
                _ = &mut timeout => {
                    break;
                }
                event = receiver.recv() => {
                    if let Some(PtyEvent::Data { data, .. }) = event {
                        if data.contains("hello_pty") {
                            found = true;
                            break;
                        }
                    }
                }
            }
        }

        manager.kill("test-session").unwrap();
        assert!(found, "Did not receive expected PTY echo output");
    }
}

