//! SidecarManager: spawn, health check, and kill the opencode sidecar process.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio::sync::mpsc::UnboundedSender;
use aurora_core::AppError;

pub struct SidecarManager {
    child: Arc<Mutex<Option<tokio::process::Child>>>,
    port: Option<u16>,
    config_path: Option<PathBuf>,
}

impl SidecarManager {
    pub fn new() -> Self {
        Self {
            child: Arc::new(Mutex::new(None)),
            port: None,
            config_path: None,
        }
    }

    /// Retrieve the running port of the sidecar.
    pub fn port(&self) -> Option<u16> {
        self.port
    }

    /// Spawn the opencode sidecar process.
    pub async fn spawn(
        &mut self,
        crashed_sender: UnboundedSender<()>,
    ) -> Result<u16, AppError> {
        // Ensure any existing process is terminated first
        self.kill().await?;

        let port = self.find_free_port()?;

        let mut cmd = if cfg!(target_os = "windows") {
            let mut c = tokio::process::Command::new("cmd");
            c.args(&["/c", "opencode", "serve", "--port", &port.to_string(), "--cors", "*"]);
            c
        } else {
            let mut c = tokio::process::Command::new("opencode");
            c.args(&["serve", "--port", &port.to_string(), "--cors", "*"]);
            c
        };
        cmd.stdout(std::process::Stdio::piped());
        cmd.stderr(std::process::Stdio::piped());

        let child = cmd.spawn()
            .map_err(|e| AppError::Sidecar(format!("Failed to spawn opencode serve: {}", e)))?;

        {
            let mut lock = self.child.lock().await;
            *lock = Some(child);
        }
        self.port = Some(port);
        self.config_path = None;

        // Start background crash monitoring
        crate::monitor::start_monitor(self.child.clone(), crashed_sender);

        // Perform health check loop (up to 3 seconds)
        let client = reqwest::Client::new();
        let health_url = format!("http://127.0.0.1:{}/global/health", port);
        let mut healthy = false;

        for _ in 0..30 {
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
            if let Ok(resp) = client.get(&health_url).send().await {
                if resp.status().is_success() {
                    healthy = true;
                    break;
                }
            }
        }

        if !healthy {
            self.kill().await?;
            return Err(AppError::Sidecar("OpenCode server health check timed out".to_string()));
        }

        Ok(port)
    }

    /// Check if the sidecar is healthy.
    pub async fn health_check(&self) -> Result<bool, AppError> {
        let port = match self.port {
            Some(p) => p,
            None => return Ok(false),
        };

        let client = reqwest::Client::new();
        let health_url = format!("http://127.0.0.1:{}/global/health", port);

        match client.get(&health_url).send().await {
            Ok(resp) => Ok(resp.status().is_success()),
            Err(_) => Ok(false),
        }
    }

    /// Kill the sidecar process.
    pub async fn kill(&mut self) -> Result<(), AppError> {
        let mut lock = self.child.lock().await;
        if let Some(mut child) = lock.take() {
            let _ = child.kill().await;
        }
        self.port = None;
        if let Some(path) = self.config_path.take() {
            let _ = std::fs::remove_file(path);
        }
        Ok(())
    }

    /// Find an available port dynamically by binding to port 0.
    fn find_free_port(&self) -> Result<u16, AppError> {
        let listener = std::net::TcpListener::bind("127.0.0.1:0")
            .map_err(|e| AppError::Sidecar(format!("Failed to find free port: {}", e)))?;
        let port = listener.local_addr()
            .map_err(|e| AppError::Sidecar(format!("Failed to get local address: {}", e)))?
            .port();
        Ok(port)
    }
}

impl Drop for SidecarManager {
    fn drop(&mut self) {
        if let Ok(mut lock) = self.child.try_lock() {
            if let Some(mut child) = lock.take() {
                let _ = child.start_kill();
            }
        }
        if let Some(path) = self.config_path.take() {
            let _ = std::fs::remove_file(path);
        }
    }
}
