//! Watches the sidecar child process for unexpected exit and restarts it.

use std::sync::Arc;
use tokio::sync::Mutex;
use tokio::sync::mpsc::UnboundedSender;

/// Starts a background polling task to monitor the sidecar process liveness.
/// If the process exits unexpectedly, it sends a message on the crashed channel.
pub fn start_monitor(
    shared_child: Arc<Mutex<Option<tokio::process::Child>>>,
    crashed_sender: UnboundedSender<()>,
) {
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
            
            let mut lock = shared_child.lock().await;
            if lock.is_none() {
                // Process was intentionally terminated/cleared
                break;
            }
            
            let child = lock.as_mut().unwrap();
            match child.try_wait() {
                Ok(Some(status)) => {
                    tracing::warn!("aurora-agent sidecar process exited unexpectedly with status: {:?}", status);
                    // Clear the child process from state
                    *lock = None;
                    let _ = crashed_sender.send(());
                    break;
                }
                Ok(None) => {
                    // Still running, continue checking
                }
                Err(e) => {
                    tracing::error!("Error checking sidecar process status: {}", e);
                    *lock = None;
                    let _ = crashed_sender.send(());
                    break;
                }
            }
        }
    });
}
