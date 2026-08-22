use std::process::Command;
use std::path::PathBuf;

fn main() {
    let target = std::env::var("TARGET").unwrap();
    let profile = std::env::var("PROFILE").unwrap_or_default();
    
    // We'll compile the sidecar to tauri/binaries/
    let manifest_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let binaries_dir = manifest_dir.join("binaries");
    std::fs::create_dir_all(&binaries_dir).unwrap();
    
    let mut real_binary_name = format!("aurora-agent-real-{}", target);
    let mut wrapper_binary_name = format!("aurora-agent-{}", target);
    if target.contains("windows") {
        real_binary_name.push_str(".exe");
        wrapper_binary_name.push_str(".exe");
    }
    let bun_output_path = binaries_dir.join(real_binary_name);
    let wrapper_output_path = binaries_dir.join(wrapper_binary_name);
    
    // Path to the agent root folder (one level up from tauri directory, then packages/aurora-agent)
    let agent_dir = manifest_dir.parent().unwrap().join("packages").join("aurora-agent");
    
    println!("cargo:rerun-if-changed={}", agent_dir.join("src").to_string_lossy());
    
    // Check if bun is installed and runs successfully
    let bun_available = if cfg!(target_os = "windows") {
        Command::new("cmd").args(["/c", "bun", "--version"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    } else {
        Command::new("bun").arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    };
    
    if bun_available {
        eprintln!("Compiling aurora-agent sidecar via Bun for target {}...", target);
        
        let bun_target = match target.as_str() {
            "x86_64-pc-windows-msvc" => Some("bun-windows-x64"),
            "x86_64-apple-darwin" => Some("bun-darwin-x64"),
            "aarch64-apple-darwin" => Some("bun-darwin-arm64"),
            "x86_64-unknown-linux-gnu" => Some("bun-linux-x64"),
            "aarch64-unknown-linux-gnu" => Some("bun-linux-arm64"),
            _ => None,
        };

        let output_str = bun_output_path.to_string_lossy();
        let mut args = vec![
            "build",
            "./src/index.ts",
            "--compile",
            "--minify",
            "--external",
            "@libsql/*",
            "--external",
            "@libsql/client",
            "--outfile",
            &output_str,
        ];

        if let Some(bt) = bun_target {
            args.push("--target");
            args.push(bt);
        }

        let mut cmd = if cfg!(target_os = "windows") {
            let mut c = Command::new("cmd");
            let mut full_args = vec!["/c", "bun"];
            full_args.extend(args);
            c.args(full_args);
            c
        } else {
            let mut c = Command::new("bun");
            c.args(args);
            c
        };
        
        cmd.current_dir(&agent_dir);
        
        let status = cmd.status().expect("Failed to execute bun build command");
        if !status.success() {
            panic!("Failed to compile aurora-agent sidecar using Bun");
        }

        // Now compile the Rust wrapper
        let wrapper_src = manifest_dir.join("src").join("agent_wrapper.rs");
        eprintln!("Compiling agent wrapper from {:?} to {:?}", wrapper_src, wrapper_output_path);
        let rustc_status = Command::new("rustc")
            .arg(&wrapper_src)
            .arg("-o")
            .arg(&wrapper_output_path)
            .env("TARGET_TRIPLE", &target)
            .status();
        match rustc_status {
            Ok(s) if s.success() => {
                eprintln!("Successfully compiled agent_wrapper");
            }
            other => {
                panic!("Failed to compile agent_wrapper: {:?}", other);
            }
        }

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Ok(metadata) = std::fs::metadata(&wrapper_output_path) {
                let mut perms = metadata.permissions();
                perms.set_mode(0o755); // rwxr-xr-x
                let _ = std::fs::set_permissions(&wrapper_output_path, perms);
            }
            if let Ok(metadata) = std::fs::metadata(&bun_output_path) {
                let mut perms = metadata.permissions();
                perms.set_mode(0o755); // rwxr-xr-x
                let _ = std::fs::set_permissions(&bun_output_path, perms);
            }

            if let Ok(ldd_output) = Command::new("ldd").arg(&wrapper_output_path).output() {
                eprintln!(
                    "Diagnostic: ldd on wrapper stdout:\n{}",
                    String::from_utf8_lossy(&ldd_output.stdout)
                );
                eprintln!(
                    "Diagnostic: ldd on wrapper stderr:\n{}",
                    String::from_utf8_lossy(&ldd_output.stderr)
                );
                eprintln!("Diagnostic: ldd on wrapper exit code: {:?}", ldd_output.status.code());
            }
        }
    } else {
        if profile == "release" {
            if !bun_output_path.exists() {
                panic!(
                    "Bun is required to compile the aurora-agent sidecar for release builds, but bun was not found in PATH. \
                    Please install Bun (https://bun.sh) and try again."
                );
            }
        } else {
            println!("cargo:warning=Bun not found in PATH. Creating placeholder sidecar for debug build.");
            if !bun_output_path.exists() {
                std::fs::write(&bun_output_path, "placeholder").expect("Failed to write placeholder sidecar");
            }
            if !wrapper_output_path.exists() {
                std::fs::write(&wrapper_output_path, "placeholder").expect("Failed to write placeholder wrapper");
            }
        }
    }

    tauri_build::build()
}
