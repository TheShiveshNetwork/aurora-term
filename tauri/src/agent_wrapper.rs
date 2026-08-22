use std::process::Command;
use std::path::PathBuf;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let target = env!("TARGET_TRIPLE");
    
    // Resolve the real agent path
    let mut exe_path = std::env::current_exe().expect("Failed to get current executable path");
    exe_path.pop(); // pop wrapper binary -> usr/bin/ or target/release/
    
    let mut real_binary_name = format!("aurora-agent-real-{}", target);
    if cfg!(target_os = "windows") {
        real_binary_name.push_str(".exe");
    }
    
    // In AppImage, $APPDIR environment variable is set
    let appdir = std::env::var("APPDIR").ok();
    
    let mut real_agent_path = None;
    
    if let Some(appdir_path) = appdir {
        let appdir_buf = PathBuf::from(appdir_path);
        // Search inside resources folder of AppImage: usr/lib/aurora-term/resources/binaries/
        // or usr/lib/aurora-app/resources/binaries/
        for name in &["aurora-term", "aurora-app"] {
            let p = appdir_buf.join("usr").join("lib").join(name).join("resources").join("binaries").join(&real_binary_name);
            if p.exists() {
                real_agent_path = Some(p);
                break;
            }
        }
    }
    
    // For macOS: resources are located in the App Bundle: ../Resources/binaries/
    if real_agent_path.is_none() && cfg!(target_os = "macos") {
        // current_exe() is at Aurora.app/Contents/MacOS/aurora-agent
        // resources are at Aurora.app/Contents/Resources/binaries/
        let macos_resources = exe_path.parent().map(|p| p.join("Resources").join("binaries").join(&real_binary_name));
        if let Some(ref p) = macos_resources {
            if p.exists() {
                real_agent_path = Some(p.clone());
            }
        }
    }
    
    if real_agent_path.is_none() {
        // Fallback: check next to the executable (e.g. in dev or standard install)
        let p_dev = exe_path.join(&real_binary_name);
        if p_dev.exists() {
            real_agent_path = Some(p_dev);
        } else {
            // Check relative path for Linux/Unix installation
            let usr_dir = exe_path.parent().unwrap_or(&exe_path);
            for name in &["aurora-term", "aurora-app"] {
                let p = usr_dir.join("lib").join(name).join("resources").join("binaries").join(&real_binary_name);
                if p.exists() {
                    real_agent_path = Some(p);
                    break;
                }
            }
        }
    }
    
    // Windows dev/prod resources are next to the executable or in the resources dir
    if real_agent_path.is_none() && cfg!(target_os = "windows") {
        // Check relative resources directory for Windows: resources/binaries/
        let p_win_res = exe_path.join("resources").join("binaries").join(&real_binary_name);
        if p_win_res.exists() {
            real_agent_path = Some(p_win_res);
        }
    }
    
    let real_agent = match real_agent_path {
        Some(p) => p,
        None => {
            eprintln!("Error: Real aurora-agent binary not found. (Expected name: {})", real_binary_name);
            std::process::exit(1);
        }
    };
    
    // Set NODE_PATH to resolve external native modules (like @libsql)
    let mut node_modules_path = None;
    
    // 1. Check inside resources next to the real agent
    if let Some(res_dir) = real_agent.parent() {
        let p = res_dir.join("packages").join("aurora-agent").join("node_modules");
        if p.exists() {
            node_modules_path = Some(p);
        }
    }
    
    // 2. Check next to the wrapper executable (e.g. if node_modules is next to wrapper)
    if node_modules_path.is_none() {
        let p = exe_path.join("packages").join("aurora-agent").join("node_modules");
        if p.exists() {
            node_modules_path = Some(p);
        }
    }
    
    // 3. Check relative to current working directory (e.g. running from workspace root in dev)
    if node_modules_path.is_none() {
        let p = std::env::current_dir().map(|cwd| cwd.join("packages").join("aurora-agent").join("node_modules")).ok();
        if let Some(ref p) = p {
            if p.exists() {
                node_modules_path = Some(p.clone());
            }
        }
    }
    
    // Spawn and inherit everything
    let mut cmd = Command::new(real_agent);
    cmd.args(&args);
    
    if let Some(nm_path) = node_modules_path {
        cmd.env("NODE_PATH", nm_path);
    }
    
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    
    let mut child = cmd.spawn().expect("Failed to execute real aurora-agent");
    let status = child.wait().expect("Failed to wait for real aurora-agent");
    std::process::exit(status.code().unwrap_or(0));
}
