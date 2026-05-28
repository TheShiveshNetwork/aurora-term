/// Detect the default shell for the current OS.
pub fn detect_default_shell() -> String {
    #[cfg(target_os = "windows")]
    {
        // Prefer PowerShell 7 (pwsh) if available
        if which::which("pwsh").is_ok() {
            return "pwsh".to_string();
        }
        "powershell.exe".to_string()
    }

    #[cfg(target_os = "macos")]
    {
        // macOS default is zsh since Catalina
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string())
    }

    #[cfg(target_os = "linux")]
    {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
    }
}

/// Build default environment variables for a PTY session.
pub fn build_default_env() -> std::collections::HashMap<String, String> {
    let mut env = std::collections::HashMap::new();
    env.insert("TERM".to_string(), "xterm-256color".to_string());
    env.insert("COLORTERM".to_string(), "truecolor".to_string());
    env
}
