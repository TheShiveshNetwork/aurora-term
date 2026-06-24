use tauri::command;
use std::process::Command;
use sysinfo::System;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use aurora_core::AppError;

#[derive(serde::Serialize)]
pub struct SystemInfo {
    pub ram_used_mb: u64,
    pub ram_total_mb: u64,
    pub git_branch: Option<String>,
    pub encoding: String,
}

static RAM_CACHE: Mutex<Option<(u64, u64, Instant)>> = Mutex::new(None);
static GIT_CACHE: Mutex<Option<(String, Option<String>, Instant)>> = Mutex::new(None);

#[command]
pub fn get_system_info(cwd: Option<String>, force: Option<bool>) -> SystemInfo {
    let (ram_used_mb, ram_total_mb) = get_ram_usage_cached();
    let git_branch = get_git_branch_cached(cwd.as_deref(), force.unwrap_or(false));
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

fn get_git_branch_cached(cwd: Option<&str>, force: bool) -> Option<String> {
    let cwd_str = cwd.unwrap_or("").to_string();
    if !force {
        if let Ok(cache) = GIT_CACHE.lock() {
            if let Some((cached_cwd, branch, time)) = cache.as_ref() {
                if cached_cwd == &cwd_str && time.elapsed() < Duration::from_secs(60) {
                    return branch.clone();
                }
            }
        }
    }
    let result = get_git_branch_helper(cwd);
    if let Ok(mut cache) = GIT_CACHE.lock() {
        *cache = Some((cwd_str, result.clone(), Instant::now()));
    }
    result
}

fn get_ram_usage() -> (u64, u64) {
    let mut sys = System::new();
    sys.refresh_memory();
    let total = sys.total_memory() / (1024 * 1024);
    let used = (sys.total_memory() - sys.available_memory()) / (1024 * 1024);
    (used, total)
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
pub async fn get_git_branch(cwd: String) -> Result<Option<String>, AppError> {
    let res = tokio::task::spawn_blocking(move || {
        get_git_branch_helper(Some(&cwd))
    }).await.map_err(|e| AppError::Pty(format!("Git lookup thread panicked: {}", e)))?;
    Ok(res)
}

#[derive(serde::Serialize)]
pub struct GitCommit {
    pub hash: String,
    pub parents: Vec<String>,
    pub author: String,
    pub date: String,
    pub message: String,
}

#[derive(serde::Serialize)]
pub struct GitRef {
    pub name: String,
    pub commit_hash: String,
}

#[derive(serde::Serialize)]
pub struct GitLogResult {
    pub commits: Vec<GitCommit>,
    pub branches: Vec<GitRef>,
    pub tags: Vec<GitRef>,
    pub current_branch: Option<String>,
}

fn run_git(args: &[&str], cwd: Option<&str>) -> Result<String, AppError> {
    let mut cmd = Command::new("git");
    cmd.args(args);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    let output = cmd.output().map_err(|e| AppError::Io(e.to_string()))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // If not a git repo or git not found, return empty rather than error
        if stderr.contains("not a git repository") || stderr.contains("fatal:") {
            return Ok(String::new());
        }
        return Err(AppError::Io(format!("git failed: {}", stderr)));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[command]
pub async fn get_git_log(cwd: String) -> Result<GitLogResult, AppError> {
    let cwd_clone = cwd.clone();
    let log_output = tokio::task::spawn_blocking(move || {
        run_git(&[
            "log", "--all",
            "--format=%H|||%P|||%an|||%ai|||%s",
            "--max-count=50"
        ], Some(&cwd_clone))
    }).await.map_err(|e| AppError::Io(e.to_string()))??;

    let cwd_clone2 = cwd.clone();
    let branch_output = tokio::task::spawn_blocking(move || {
        run_git(&[
            "branch", "--format=%(refname:short)|||%(objectname)"
        ], Some(&cwd_clone2))
    }).await.map_err(|e| AppError::Io(e.to_string()))??;

    let cwd_clone3 = cwd.clone();
    let tag_output = tokio::task::spawn_blocking(move || {
        run_git(&[
            "tag", "--format=%(refname:short)|||%(objectname)"
        ], Some(&cwd_clone3))
    }).await.map_err(|e| AppError::Io(e.to_string()))??;

    let cwd_clone4 = cwd.clone();
    let current_branch = tokio::task::spawn_blocking(move || {
        let out = run_git(&["rev-parse", "--abbrev-ref", "HEAD"], Some(&cwd_clone4)).ok()?;
        let trimmed = out.trim().to_string();
        if trimmed.is_empty() || trimmed == "HEAD" { None } else { Some(trimmed) }
    }).await.map_err(|e| AppError::Io(e.to_string()))?;

    let mut commits = Vec::new();
    for line in log_output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() { continue; }
        let parts: Vec<&str> = trimmed.split("|||").collect();
        if parts.len() < 5 { continue; }
        let parents = if parts[1].is_empty() {
            Vec::new()
        } else {
            parts[1].split_whitespace().map(|s| s.to_string()).collect()
        };
        commits.push(GitCommit {
            hash: parts[0].to_string(),
            parents,
            author: parts[2].to_string(),
            date: parts[3].to_string(),
            message: parts[4].to_string(),
        });
    }

    let mut branches = Vec::new();
    for line in branch_output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() { continue; }
        let parts: Vec<&str> = trimmed.split("|||").collect();
        if parts.len() < 2 { continue; }
        branches.push(GitRef {
            name: parts[0].to_string(),
            commit_hash: parts[1].to_string(),
        });
    }

    let mut tags = Vec::new();
    for line in tag_output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() { continue; }
        let parts: Vec<&str> = trimmed.split("|||").collect();
        if parts.len() < 2 { continue; }
        tags.push(GitRef {
            name: parts[0].to_string(),
            commit_hash: parts[1].to_string(),
        });
    }

    Ok(GitLogResult {
        commits,
        branches,
        tags,
        current_branch,
    })
}

#[command]
pub async fn get_git_file_log(cwd: String, file_path: String) -> Result<GitLogResult, AppError> {
    let cwd_clone = cwd.clone();
    let fp_clone = file_path.clone();
    let log_output = tokio::task::spawn_blocking(move || {
        run_git(&[
            "log", "--all",
            "--format=%H|||%P|||%an|||%ai|||%s",
            "--max-count=50", "--", &fp_clone
        ], Some(&cwd_clone))
    }).await.map_err(|e| AppError::Io(e.to_string()))??;

    let cwd_clone2 = cwd.clone();
    let branch_output = tokio::task::spawn_blocking(move || {
        run_git(&["branch", "--format=%(refname:short)|||%(objectname)"], Some(&cwd_clone2))
    }).await.map_err(|e| AppError::Io(e.to_string()))??;

    let cwd_clone3 = cwd.clone();
    let current_branch = tokio::task::spawn_blocking(move || {
        let out = run_git(&["rev-parse", "--abbrev-ref", "HEAD"], Some(&cwd_clone3)).ok()?;
        let trimmed = out.trim().to_string();
        if trimmed.is_empty() || trimmed == "HEAD" { None } else { Some(trimmed) }
    }).await.map_err(|e| AppError::Io(e.to_string()))?;

    let mut commits = Vec::new();
    for line in log_output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() { continue; }
        let parts: Vec<&str> = trimmed.split("|||").collect();
        if parts.len() < 5 { continue; }
        let parents = if parts[1].is_empty() {
            Vec::new()
        } else {
            parts[1].split_whitespace().map(|s| s.to_string()).collect()
        };
        commits.push(GitCommit {
            hash: parts[0].to_string(),
            parents,
            author: parts[2].to_string(),
            date: parts[3].to_string(),
            message: parts[4].to_string(),
        });
    }

    let mut branches = Vec::new();
    for line in branch_output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() { continue; }
        let parts: Vec<&str> = trimmed.split("|||").collect();
        if parts.len() < 2 { continue; }
        branches.push(GitRef {
            name: parts[0].to_string(),
            commit_hash: parts[1].to_string(),
        });
    }

    Ok(GitLogResult {
        commits,
        branches,
        tags: Vec::new(),
        current_branch,
    })
}

#[command]
pub async fn get_git_graph(cwd: String) -> Result<String, AppError> {
    tokio::task::spawn_blocking(move || {
        run_git(&[
            "log", "--graph", "--oneline", "--all", "--decorate",
        ], Some(&cwd))
    }).await.map_err(|e| AppError::Io(e.to_string()))?
}

#[command]
pub async fn get_git_file_diff(cwd: String, file_path: String, commit_hash: String) -> Result<String, AppError> {
    tokio::task::spawn_blocking(move || {
        run_git(&[
            "diff", &format!("{}~1", commit_hash), commit_hash.as_str(), "--", &file_path,
        ], Some(&cwd))
    }).await.map_err(|e| AppError::Io(e.to_string()))?
}

#[command]
pub async fn get_git_commit_diff(cwd: String, commit_hash: String) -> Result<String, AppError> {
    tokio::task::spawn_blocking(move || {
        run_git(&[
            "show", "--format=", commit_hash.as_str(), "--",
        ], Some(&cwd))
    }).await.map_err(|e| AppError::Io(e.to_string()))?
}

#[command]
pub async fn get_git_file_content_at_commit(cwd: String, file_path: String, commit_hash: String) -> Result<String, AppError> {
    let ch = commit_hash.clone();
    tokio::task::spawn_blocking(move || {
        run_git(&[
            "show", &format!("{}:{}", ch.trim(), file_path.trim()),
        ], Some(&cwd))
    }).await.map_err(|e| {
        AppError::Io(format!("Failed to get file content at {}: {}", commit_hash, e))
    })?
}

#[derive(serde::Serialize)]
pub struct ChangedFile {
    pub status: String,
    pub file_path: String,
}

#[command]
pub async fn get_git_commit_files(cwd: String, commit_hash: String) -> Result<Vec<ChangedFile>, AppError> {
    let ch = commit_hash.clone();
    tokio::task::spawn_blocking(move || {
        let output = run_git(&[
            "diff-tree", "--no-commit-id", "-r", "--name-status", ch.trim(),
        ], Some(&cwd))?;
        let mut files = Vec::new();
        for line in output.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() { continue; }
            let parts: Vec<&str> = trimmed.splitn(2, '\t').collect();
            if parts.len() == 2 {
                files.push(ChangedFile {
                    status: parts[0].to_string(),
                    file_path: parts[1].to_string(),
                });
            }
        }
        Ok(files)
    }).await.map_err(|e| AppError::Io(e.to_string()))?
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
pub fn get_available_commands() -> Vec<String> {
    let path_var = match std::env::var("PATH") {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };

    #[cfg(target_os = "windows")]
    let pathext: Vec<String> = std::env::var("PATHEXT")
        .unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC;.PS1".to_string())
        .split(';')
        .map(|s| s.trim().to_lowercase())
        .collect();

    let mut commands: Vec<String> = Vec::with_capacity(4096);

    for dir in path_var.split(if cfg!(target_os = "windows") { ";" } else { ":" }) {
        if dir.is_empty() {
            continue;
        }
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();

                #[cfg(target_os = "windows")]
                {
                    if let Some(ext) = path.extension() {
                        if pathext.contains(&format!(".{}", ext.to_string_lossy().to_lowercase())) {
                            if let Some(stem) = path.file_stem() {
                                commands.push(stem.to_string_lossy().to_lowercase());
                            }
                        }
                    }
                }

                #[cfg(not(target_os = "windows"))]
                {
                    if let Ok(metadata) = path.metadata() {
                        use std::os::unix::fs::PermissionsExt;
                        if metadata.is_file() && metadata.permissions().mode() & 0o111 != 0 {
                            if let Some(name) = path.file_name() {
                                commands.push(name.to_string_lossy().to_lowercase());
                            }
                        }
                    }
                }
            }
        }
    }

    commands.sort();
    commands.dedup();
    commands
}

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
