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
        // Use PowerShell Get-CimInstance — works on Windows 10/11, unlike wmic which was removed.
        // A single PS call returns "TotalKB UsedKB" on one line.
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
        // sysctl gives total physical bytes
        let total_bytes: u64 = Command::new("sysctl")
            .args(["-n", "hw.memsize"])
            .output()
            .ok()
            .and_then(|o| String::from_utf8_lossy(&o.stdout).trim().parse::<u64>().ok())
            .unwrap_or(0);

        // vm_stat page size + pages free/inactive
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

    // Suppress Windows console window popup
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
