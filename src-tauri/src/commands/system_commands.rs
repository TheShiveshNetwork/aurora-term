use tauri::command;
use std::process::Command;

#[derive(serde::Serialize)]
pub struct SystemInfo {
    pub ram_used_mb: u64,
    pub ram_total_mb: u64,
    pub git_branch: Option<String>,
    pub encoding: String,
}

#[command]
pub fn get_system_info(cwd: Option<String>) -> SystemInfo {
    let (ram_used_mb, ram_total_mb) = get_ram_usage();
    let git_branch = get_git_branch(cwd.as_deref());
    let encoding = "UTF-8".to_string();

    SystemInfo {
        ram_used_mb,
        ram_total_mb,
        git_branch,
        encoding,
    }
}

fn get_ram_usage() -> (u64, u64) {
    #[cfg(target_os = "windows")]
    {
        let ps_script = r#"
$os = Get-CimInstance -ClassName Win32_OperatingSystem;
$total = $os.TotalVisibleMemorySize;
$free  = $os.FreePhysicalMemory;
Write-Output "$total $free"
"#;
        let output = Command::new("powershell")
            .args([
                "-NonInteractive",
                "-NoProfile",
                "-WindowStyle", "Hidden",
                "-Command",
                ps_script,
            ])
            .output();

        if let Ok(out) = output {
            let text = String::from_utf8_lossy(&out.stdout);
            let mut parts = text.split_whitespace();
            if let (Some(total_str), Some(free_str)) = (parts.next(), parts.next()) {
                let total_kb: u64 = total_str.trim().parse().unwrap_or(0);
                let free_kb:  u64 = free_str.trim().parse().unwrap_or(0);
                if total_kb > 0 {
                    return ((total_kb - free_kb) / 1024, total_kb / 1024);
                }
            }
        }
        return (0, 0);
    }

    #[cfg(target_os = "macos")]
    {
        let total_bytes: u64 = Command::new("sysctl")
            .args(["-n", "hw.memsize"])
            .output()
            .ok()
            .and_then(|o| String::from_utf8_lossy(&o.stdout).trim().parse::<u64>().ok())
            .unwrap_or(0);

        let used_mb: u64 = Command::new("sh")
            .args([
                "-c",
                r#"
page_size=$(pagesize);
vm=$(vm_stat);
wired=$(echo "$vm" | awk '/wired/{gsub(/\./,"",$NF); print $NF}');
active=$(echo "$vm" | awk '/^Pages active/{gsub(/\./,"",$NF); print $NF}');
compressed=$(echo "$vm" | awk '/compressed/{gsub(/\./,"",$NF); print $NF+0}');
echo $(( (wired + active + compressed) * page_size / 1048576 ))
"#,
            ])
            .output()
            .ok()
            .and_then(|o| String::from_utf8_lossy(&o.stdout).trim().parse::<u64>().ok())
            .unwrap_or(0);

        return (used_mb, total_bytes / (1024 * 1024));
    }

    #[cfg(target_os = "linux")]
    {
        let contents = std::fs::read_to_string("/proc/meminfo").unwrap_or_default();
        let mut total_kb = 0u64;
        let mut available_kb = 0u64;
        for line in contents.lines() {
            if line.starts_with("MemTotal:") {
                total_kb = line.split_whitespace().nth(1).and_then(|v| v.parse().ok()).unwrap_or(0);
            } else if line.starts_with("MemAvailable:") {
                available_kb = line.split_whitespace().nth(1).and_then(|v| v.parse().ok()).unwrap_or(0);
            }
        }
        return ((total_kb.saturating_sub(available_kb)) / 1024, total_kb / 1024);
    }

    #[allow(unreachable_code)]
    (0, 0)
}

fn get_git_branch(cwd: Option<&str>) -> Option<String> {
    let mut cmd = Command::new("git");
    cmd.args(["rev-parse", "--abbrev-ref", "HEAD"]);

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
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
