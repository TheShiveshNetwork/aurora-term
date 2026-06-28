//! Watches the sidecar child process for unexpected exit using event-driven wait.
//!
//! Uses OS-native child-exit notification (`Child::wait()`) instead of polling
//! `try_wait()` every 500ms. A `kill_signal` channel allows the manager to
//! cancel the wait when intentionally terminating the sidecar.

use tokio::sync::mpsc::UnboundedSender;
use tokio::sync::oneshot;

/// Starts a background task to monitor the sidecar process liveness using
/// event-driven `Child::wait()`. Returns a `kill_sender` that the manager can
/// use to signal intentional termination (cancels the wait and kills the child).
pub fn start_monitor(
    mut child: tokio::process::Child,
    crashed_sender: UnboundedSender<()>,
) -> oneshot::Sender<()> {
    let (kill_sender, mut kill_receiver) = oneshot::channel::<()>();

    tokio::spawn(async move {
        tokio::select! {
            // OS-native wait — no polling, zero CPU when idle
            result = child.wait() => {
                match result {
                    Ok(status) => {
                        tracing::warn!("aurora-agent sidecar exited with status: {:?}", status);
                    }
                    Err(e) => {
                        tracing::error!("Error waiting for sidecar: {}", e);
                    }
                }
                let _ = crashed_sender.send(());
            }
            // Intentional kill signal — manager called kill() or Drop
            _ = &mut kill_receiver => {
                tracing::info!("aurora-agent sidecar: kill signal received, terminating");
                #[cfg(target_os = "windows")]
                {
                    if let Some(pid) = child.id() {
                        let mut kill_cmd = tokio::process::Command::new("taskkill");
                        kill_cmd.args(["/F", "/T", "/PID", &pid.to_string()]);
                        kill_cmd.stdout(std::process::Stdio::null());
                        kill_cmd.stderr(std::process::Stdio::null());
                        let _ = kill_cmd.status().await;
                    }
                }
                let _ = child.kill().await;
                let _ = child.wait().await;
            }
        }
    });

    kill_sender
}
