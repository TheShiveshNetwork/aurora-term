//! SidecarManager: spawn, health check, and kill the aurora-agent sidecar process.

use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio::sync::mpsc::UnboundedSender;
use tokio::sync::oneshot;
use aurora_core::AppError;

pub struct SidecarManager {
    kill_sender: Arc<Mutex<Option<oneshot::Sender<()>>>>,
    port: Option<u16>,
    config_path: Option<PathBuf>,
    child_pid: Option<u32>,
}

impl Default for SidecarManager {
    fn default() -> Self {
        Self::new()
    }
}

impl SidecarManager {
    pub fn new() -> Self {
        Self {
            kill_sender: Arc::new(Mutex::new(None)),
            port: None,
            config_path: None,
            child_pid: None,
        }
    }

    /// Retrieve the running port of the sidecar.
    pub fn port(&self) -> Option<u16> {
        self.port
    }

    /// Spawn the aurora-agent sidecar process.
    pub async fn spawn(
        &mut self,
        crashed_sender: UnboundedSender<()>,
        envs: Vec<(String, String)>,
    ) -> Result<u16, AppError> {
        let _ = std::fs::write("d:/builds/aurora/sidecar_status.log", "SidecarManager::spawn: entered");
        // Signal any previous monitor and terminate existing process
        self.kill().await?;
        let _ = std::fs::write("d:/builds/aurora/sidecar_status.log", "SidecarManager::spawn: killed old child");

        let port = self.find_free_port()?;
        let _ = std::fs::write("d:/builds/aurora/sidecar_status.log", format!("SidecarManager::spawn: found port {}", port));

        let mut cmd = if cfg!(target_os = "windows") {
            let mut c = tokio::process::Command::new("cmd");
            c.args(["/c", "pnpm", "--dir", "packages/aurora-agent", "dev", "--port", &port.to_string()]);
            c
        } else {
            let mut c = tokio::process::Command::new("pnpm");
            c.args(["--dir", "packages/aurora-agent", "dev", "--port", &port.to_string()]);
            c
        };

        if let Some(root) = find_workspace_root() {
            let _ = std::fs::write("d:/builds/aurora/sidecar_status.log", format!("SidecarManager::spawn: using workspace root {:?}", root));
            cmd.current_dir(root);
        } else {
            let _ = std::fs::write("d:/builds/aurora/sidecar_status.log", "SidecarManager::spawn: workspace root not found!");
        }

        for (k, v) in envs {
            cmd.env(k, v);
        }
        if let Ok(log_file) = std::fs::File::create("d:/builds/aurora/sidecar_output.log") {
            if let Ok(err_file) = log_file.try_clone() {
                cmd.stdout(log_file);
                cmd.stderr(err_file);
            } else {
                cmd.stdout(std::process::Stdio::piped());
                cmd.stderr(std::process::Stdio::piped());
            }
        } else {
            cmd.stdout(std::process::Stdio::piped());
            cmd.stderr(std::process::Stdio::piped());
        }

        let _ = std::fs::write("d:/builds/aurora/sidecar_status.log", "SidecarManager::spawn: spawning command");
        let child = cmd.spawn()
            .map_err(|e| AppError::Sidecar(format!("Failed to spawn aurora-agent serve: {}", e)))?;
        let _ = std::fs::write("d:/builds/aurora/sidecar_status.log", "SidecarManager::spawn: command spawned successfully");

        self.child_pid = child.id();
        self.port = Some(port);
        self.config_path = None;

        // Start background crash monitoring (event-driven, no polling)
        let kill_sender = crate::monitor::start_monitor(child, crashed_sender);
        {
            let mut lock = self.kill_sender.lock().await;
            *lock = Some(kill_sender);
        }

        // Perform health check loop (up to 3 seconds)
        let client = reqwest::Client::new();
        let health_url = format!("http://127.0.0.1:{}/global/health", port);
        let mut healthy = false;

        for i in 0..30 {
            let _ = std::fs::write("d:/builds/aurora/sidecar_status.log", format!("SidecarManager::spawn: health check iteration {}, url: {}", i, health_url));
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
            // set a 1-second timeout on the request to prevent hanging forever
            let req = client.get(&health_url).timeout(tokio::time::Duration::from_secs(1));
            if let Ok(resp) = req.send().await {
                let _ = std::fs::write("d:/builds/aurora/sidecar_status.log", format!("SidecarManager::spawn: health check got response status: {}", resp.status()));
                if resp.status().is_success() {
                    healthy = true;
                    break;
                }
            } else {
                let _ = std::fs::write("d:/builds/aurora/sidecar_status.log", "SidecarManager::spawn: health check request failed");
            }
        }

        if !healthy {
            let _ = std::fs::write("d:/builds/aurora/sidecar_status.log", "SidecarManager::spawn: health check timed out, killing sidecar");
            self.kill().await?;
            return Err(AppError::Sidecar("aurora-agent server health check timed out".to_string()));
        }

        let _ = std::fs::write("d:/builds/aurora/sidecar_status.log", "SidecarManager::spawn: sidecar is healthy and running!");
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

    /// Kill the sidecar process by signalling the monitor (which owns the child).
    pub async fn kill(&mut self) -> Result<(), AppError> {
        #[cfg(target_os = "windows")]
        {
            if let Some(pid) = self.child_pid.take() {
                let mut kill_cmd = std::process::Command::new("taskkill");
                kill_cmd.args(["/F", "/T", "/PID", &pid.to_string()]);
                kill_cmd.stdout(std::process::Stdio::null());
                kill_cmd.stderr(std::process::Stdio::null());
                let _ = kill_cmd.status();
            }
        }
        {
            let mut lock = self.kill_sender.lock().await;
            if let Some(sender) = lock.take() {
                let _ = sender.send(());
            }
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
        if let Ok(mut lock) = self.kill_sender.try_lock() {
            drop(lock.take());
        }
        if let Some(path) = self.config_path.take() {
            let _ = std::fs::remove_file(path);
        }
    }
}

fn find_workspace_root() -> Option<PathBuf> {
    let mut current = std::env::current_dir().ok()?;
    loop {
        if current.join("pnpm-workspace.yaml").exists() {
            return Some(current);
        }
        if !current.pop() {
            break;
        }
    }
    None
}
