use tauri::command;
use std::process::Command;
use sysinfo::System;
use std::sync::Mutex;
use std::time::{Duration, Instant};

#[derive(serde::Serialize)]
pub struct SystemInfo {
    pub ram_used_mb: u64,
    pub ram_total_mb: u64,
    pub git_branch: Option<String>,
    pub encoding: String,
}

static RAM_CACHE: Mutex<Option<(u64, u64, Instant)>> = Mutex::new(None);
static GIT_CACHE: Mutex<Option<(Option<String>, Instant)>> = Mutex::new(None);

#[command]
pub fn get_system_info(cwd: Option<String>) -> SystemInfo {
    let (ram_used_mb, ram_total_mb) = get_ram_usage_cached();
    let git_branch = get_git_branch_cached(cwd.as_deref());
    let encoding = "UTF-8".to_string();

    SystemInfo {
        ram_used_mb,
        ram_total_mb,
        git_branch,
        encoding,
    }
}

fn get_ram_usage_cached() -> (u64, u64) {
    if let Ok(cache) = RAM_CACHE.lock() {
        if let Some((used, total, time)) = cache.as_ref() {
            if time.elapsed() < Duration::from_secs(60) {
                return (*used, *total);
            }
        }
    }
    let result = get_ram_usage();
    if let Ok(mut cache) = RAM_CACHE.lock() {
        *cache = Some((result.0, result.1, Instant::now()));
    }
    result
}

fn get_git_branch_cached(cwd: Option<&str>) -> Option<String> {
    if let Ok(cache) = GIT_CACHE.lock() {
        if let Some((branch, time)) = cache.as_ref() {
            if time.elapsed() < Duration::from_secs(60) {
                return branch.clone();
            }
        }
    }
    let result = get_git_branch_helper(cwd);
    if let Ok(mut cache) = GIT_CACHE.lock() {
        *cache = Some((result.clone(), Instant::now()));
    }
    result
}

fn get_ram_usage() -> (u64, u64) {
    let mut sys = System::new();
    sys.refresh_memory();
    let total = sys.total_memory() / (1024 * 1024);
    let used = (sys.total_memory() - sys.available_memory()) / (1024 * 1024);
    (used as u64, total as u64)
}

fn get_git_branch_helper(cwd: Option<&str>) -> Option<String> {
    let mut cmd = Command::new("git");
    cmd.args(["rev-parse", "--abbrev-ref", "HEAD"]);

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }

    cmd.output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty() && s != "HEAD")
}

#[command]
pub async fn get_git_branch(cwd: String) -> Result<Option<String>, crate::error::AppError> {
    let head = std::path::Path::new(&cwd).join(".git/HEAD");
    if !head.exists() { return Ok(None) }
    let content = tokio::fs::read_to_string(head).await?;
    let content_trimmed = content.trim();
    if content_trimmed.starts_with("ref: refs/heads/") {
        Ok(Some(content_trimmed["ref: refs/heads/".len()..].to_string()))
    } else {
        // detached HEAD or hex sha
        Ok(Some(content_trimmed.chars().take(7).collect()))
    }
}

#[command]
pub fn get_current_pwd() -> Result<String, String> {
    std::env::current_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|e| e.to_string())
}

// ─── Shell history reader ──────────────────────────────────────────────────────
// Reads the native shell history file and returns newest-first unique commands.
//
//   Windows  → PSReadLine ConsoleHost_history.txt  (PowerShell 5+ / 7+)
//   macOS    → ~/.zsh_history → ~/.bash_history
//   Linux    → ~/.bash_history → ~/.zsh_history → fish_history
//
// Up to 2 000 distinct entries are returned.
#[command]
pub fn read_shell_history() -> Vec<String> {
    let paths = candidate_history_paths();

    let mut result: Vec<String> = Vec::with_capacity(512);
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

    for path in paths {
        if let Ok(text) = std::fs::read_to_string(&path) {
            // Walk lines newest-first
            for raw in text.lines().rev() {
                let line = raw.trim();

                // Skip blank lines and comment / timestamp lines
                if line.is_empty() || line.starts_with('#') {
                    continue;
                }

                // zsh extended history: ": <timestamp>:<elapsed>;<command>"
                let cmd = if line.starts_with(": ") {
                    if let Some(idx) = line.find(';') {
                        line[idx + 1..].trim()
                    } else {
                        line
                    }
                } else {
                    line
                };

                if cmd.is_empty() {
                    continue;
                }

                let owned = cmd.to_string();
                if seen.insert(owned.clone()) {
                    result.push(owned);
                    if result.len() >= 2000 {
                        return result;
                    }
                }
            }
        }
    }

    result
}

/// Return candidate history file paths for the current OS, most-preferred first.
/// Only paths that exist as regular files are included.
fn candidate_history_paths() -> Vec<std::path::PathBuf> {
    let mut paths: Vec<std::path::PathBuf> = Vec::new();

    #[cfg(target_os = "windows")]
    {
        // PSReadLine (PowerShell 5.x / Windows PowerShell)
        if let Some(appdata) = std::env::var_os("APPDATA") {
            paths.push(
                std::path::PathBuf::from(appdata)
                    .join("Microsoft")
                    .join("Windows")
                    .join("PowerShell")
                    .join("PSReadLine")
                    .join("ConsoleHost_history.txt"),
            );
        }
        // PowerShell 7 / Core can also write here
        if let Some(userprofile) = std::env::var_os("USERPROFILE") {
            let home = std::path::PathBuf::from(&userprofile);
            paths.push(
                home.join("Documents")
                    .join("PowerShell")
                    .join("PSReadLine")
                    .join("ConsoleHost_history.txt"),
            );
            // Git Bash / MSYS2 bash users
            paths.push(home.join(".bash_history"));
        }
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        if let Some(home_os) = std::env::var_os("HOME") {
            let home = std::path::PathBuf::from(home_os);
            paths.push(home.join(".zsh_history"));
            paths.push(home.join(".bash_history"));
            // fish shell
            paths.push(
                home.join(".local")
                    .join("share")
                    .join("fish")
                    .join("fish_history"),
            );
        }
    }

    paths.into_iter().filter(|p| p.is_file()).collect()
}
