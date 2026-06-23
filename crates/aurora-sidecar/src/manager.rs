//! SidecarManager: spawn, health check, and kill the opencode sidecar process.
//! This is a scaffolded module — implement when opencode integration is ready.

use aurora_core::AppError;

pub struct SidecarManager {
    // TODO: Track child process handle, port, health status
}

impl SidecarManager {
    pub fn new() -> Self {
        Self {}
    }

    /// Spawn the opencode sidecar process.
    pub async fn spawn(&mut self) -> Result<(), AppError> {
        // TODO: Locate opencode binary, spawn child process, wait for health
        Ok(())
    }

    /// Check if the sidecar is healthy.
    pub async fn health_check(&self) -> Result<bool, AppError> {
        // TODO: GET /health on sidecar port
        Ok(false)
    }

    /// Kill the sidecar process.
    pub async fn kill(&mut self) -> Result<(), AppError> {
        // TODO: Kill child process
        Ok(())
    }
}
