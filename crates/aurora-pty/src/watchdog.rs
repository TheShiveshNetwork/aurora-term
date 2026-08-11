// ─────────────────────────────────────────────────────────────────────────────
// Process watchdog — detects whether a foreground command is running inside a
// shell by walking the shell's descendant process tree.
//
// xterm/PTY data alone cannot tell us if a process is still running: a shell
// stays alive while its foreground child executes, and the prompt sentinel only
// appears after the child exits. Polling the process tree is the authoritative
// cross-platform signal used by real terminal emulators.
//
// No Tauri, no I/O beyond the process table snapshot.
// ─────────────────────────────────────────────────────────────────────────────

use std::ffi::OsStr;
use std::time::Duration;

use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};

use crate::session::PtyEvent;

/// How often the process table is re-scanned. Kept short enough for snappy
/// busy/idle transitions without hammering the OS.
const POLL_INTERVAL: Duration = Duration::from_millis(300);

/// Console infrastructure that can briefly appear in the shell's tree but is
/// never a user command. Matched case-insensitively.
const INFRA_PROCESS_NAMES: &[&str] = &["conhost.exe", "openconsole.exe", "windowsterminal.exe"];

fn is_infra_process(name: &OsStr) -> bool {
    let lower = name.to_string_lossy().to_ascii_lowercase();
    INFRA_PROCESS_NAMES.contains(&lower.as_str())
}

/// True when `shell_pid` has at least one live descendant (excluding console
/// infrastructure). The shell itself is never counted.
fn shell_has_foreground_children(system: &System, shell_pid: u32) -> bool {
    let mut children: std::collections::HashMap<u32, Vec<u32>> = std::collections::HashMap::new();
    for (pid, process) in system.processes() {
        if is_infra_process(process.name()) {
            continue;
        }
        if let Some(parent) = process.parent() {
            children
                .entry(parent.as_u32())
                .or_default()
                .push(pid.as_u32());
        }
    }

    let mut stack: Vec<u32> = vec![shell_pid];
    let mut seen: std::collections::HashSet<u32> = std::collections::HashSet::new();
    while let Some(pid) = stack.pop() {
        if !seen.insert(pid) {
            continue;
        }
        if let Some(kids) = children.get(&pid) {
            stack.extend(kids.iter().copied());
        }
    }

    // Anything reachable beyond the shell process itself means a foreground
    // command is running.
    seen.len() > 1
}

/// Spawns the watchdog for a PTY session. Runs forever on the blocking pool,
/// polling the process table every `POLL_INTERVAL` and forwarding `PtyEvent::Busy`
/// through `sender` whenever the busy state flips. Exits once the shell process
/// is gone, emitting a final `busy = false` if it was previously true.
pub fn start_process_watchdog(
    session_id: String,
    shell_pid: u32,
    sender: tokio::sync::mpsc::UnboundedSender<PtyEvent>,
) {
    tokio::task::spawn_blocking(move || {
        let session_id_arc: std::sync::Arc<str> = session_id.into();
        let mut system = System::new();
        let mut last_busy: Option<bool> = None;

        loop {
            // We only need pid/parent/name, so skip the expensive CPU/mem info.
            system.refresh_processes_specifics(
                ProcessesToUpdate::All,
                ProcessRefreshKind::new(),
            );

            if system.process(Pid::from_u32(shell_pid)).is_none() {
                if last_busy != Some(false) {
                    let _ = sender.send(PtyEvent::Busy {
                        session_id: session_id_arc.clone(),
                        busy: false,
                    });
                }
                break;
            }

            let busy = shell_has_foreground_children(&system, shell_pid);
            if last_busy != Some(busy) {
                let _ = sender.send(PtyEvent::Busy {
                    session_id: session_id_arc.clone(),
                    busy,
                });
                last_busy = Some(busy);
            }

            std::thread::sleep(POLL_INTERVAL);
        }
    });
}
