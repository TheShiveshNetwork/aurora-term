//! SidecarManager: spawn, health check, and kill the aurora-agent sidecar process.

use std::path::PathBuf;
use tokio::sync::mpsc::UnboundedSender;
use tokio::sync::oneshot;
use aurora_core::AppError;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

pub struct SidecarManager {
    kill_sender: tokio::sync::Mutex<Option<oneshot::Sender<()>>>,
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
            kill_sender: tokio::sync::Mutex::new(None),
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
        // Signal any previous monitor and terminate existing process
        self.kill().await?;

        let port = self.find_free_port()?;

        #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
        const TARGET_TRIPLE: &str = "x86_64-pc-windows-msvc";
        #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
        const TARGET_TRIPLE: &str = "x86_64-apple-darwin";
        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        const TARGET_TRIPLE: &str = "aarch64-apple-darwin";
        #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
        const TARGET_TRIPLE: &str = "x86_64-unknown-linux-gnu";
        #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
        const TARGET_TRIPLE: &str = "aarch64-unknown-linux-gnu";
        #[cfg(not(any(
            all(target_os = "windows", target_arch = "x86_64"),
            all(target_os = "macos", target_arch = "x86_64"),
            all(target_os = "macos", target_arch = "aarch64"),
            all(target_os = "linux", target_arch = "x86_64"),
            all(target_os = "linux", target_arch = "aarch64")
        )))]
        const TARGET_TRIPLE: &str = "unknown";

        let workspace_root = find_workspace_root();
        
        let mut cmd = if let Some(root) = workspace_root.filter(|_| cfg!(debug_assertions)) {
            #[cfg(target_os = "windows")]
            {
                let mut c = tokio::process::Command::new("cmd");
                c.args(["/c", "pnpm", "--dir", "packages/aurora-agent", "dev", "--port", &port.to_string()]);
                c.current_dir(root);
                c.as_std_mut().creation_flags(0x08000000); // CREATE_NO_WINDOW
                c
            }
            #[cfg(not(target_os = "windows"))]
            {
                let mut c = tokio::process::Command::new("pnpm");
                c.args(["--dir", "packages/aurora-agent", "dev", "--port", &port.to_string()]);
                c.current_dir(root);
                c
            }
        } else {
            let mut exe_path = std::env::current_exe().map_err(|e| AppError::Sidecar(format!("Failed to get current executable path: {}", e)))?;
            exe_path.pop(); // get directory containing the executable
            
            let base_name = "aurora-agent";
            let triple_name = format!("{}-{}", base_name, TARGET_TRIPLE);
            
            #[cfg(target_os = "windows")]
            let (base_name_ext, triple_name_ext) = (format!("{}.exe", base_name), format!("{}.exe", triple_name));
            #[cfg(not(target_os = "windows"))]
            let (base_name_ext, triple_name_ext) = (base_name.to_string(), triple_name);
            
            let base_path = exe_path.join(&base_name_ext);
            let triple_path = exe_path.join(&triple_name_ext);
            
            let sidecar_path = if base_path.exists() {
                base_path
            } else if triple_path.exists() {
                triple_path
            } else {
                return Err(AppError::Sidecar(format!(
                    "Compiled sidecar binary not found (looked for {:?} and {:?})",
                    base_path, triple_path
                )));
            };
            
            let mut c = tokio::process::Command::new(sidecar_path);
            c.args(["--port", &port.to_string()]);
            #[cfg(target_os = "windows")]
            c.as_std_mut().creation_flags(0x08000000); // CREATE_NO_WINDOW
            c
        };

        for (k, v) in &envs {
            cmd.env(k, v);
        }

        // Route stdout/stderr based on build profile:
        //   dev  → inherit (logs reach the parent terminal with colors via LOG_PRETTY=1)
        //   prod → null    (sidecar manages its own file via LOG_FILE_PATH env var)
        if cfg!(debug_assertions) {
            cmd.stdout(std::process::Stdio::inherit());
            cmd.stderr(std::process::Stdio::inherit());
        } else {
            cmd.stdout(std::process::Stdio::null());
            cmd.stderr(std::process::Stdio::null());
        }

        let child = cmd.spawn()
            .map_err(|e| AppError::Sidecar(format!("Failed to spawn aurora-agent serve: {}", e)))?;

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

        for _ in 0..30 {
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
            let req = client.get(&health_url).timeout(tokio::time::Duration::from_secs(1));
            if let Ok(resp) = req.send().await {
                if resp.status().is_success() {
                    healthy = true;
                    break;
                }
            }
        }

        if !healthy {
            self.kill().await?;
            return Err(AppError::Sidecar("aurora-agent server health check timed out".to_string()));
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
