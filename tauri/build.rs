use std::process::Command;
use std::path::PathBuf;

fn main() {
    let target = std::env::var("TARGET").unwrap();
    let profile = std::env::var("PROFILE").unwrap_or_default();
    
    // We'll compile the sidecar to tauri/binaries/
    let manifest_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let binaries_dir = manifest_dir.join("binaries");
    std::fs::create_dir_all(&binaries_dir).unwrap();
    
    let mut binary_name = format!("aurora-agent-{}", target);
    if target.contains("windows") {
        binary_name.push_str(".exe");
    }
    let output_path = binaries_dir.join(binary_name);
    
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
        println!("cargo:warning=Compiling aurora-agent sidecar via Bun for target {}...", target);
        
        let bun_target = match target.as_str() {
            "x86_64-pc-windows-msvc" => Some("bun-windows-x64"),
            "x86_64-apple-darwin" => Some("bun-darwin-x64"),
            "aarch64-apple-darwin" => Some("bun-darwin-arm64"),
            "x86_64-unknown-linux-gnu" => Some("bun-linux-x64"),
            "aarch64-unknown-linux-gnu" => Some("bun-linux-arm64"),
            _ => None,
        };

        let output_str = output_path.to_string_lossy();
        let mut args = vec![
            "build",
            "./src/index.ts",
            "--compile",
            "--minify",
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
    } else {
        if profile == "release" {
            if !output_path.exists() {
                panic!(
                    "Bun is required to compile the aurora-agent sidecar for release builds, but bun was not found in PATH. \
                    Please install Bun (https://bun.sh) and try again."
                );
            }
        } else {
            println!("cargo:warning=Bun not found in PATH. Creating placeholder sidecar for debug build.");
            if !output_path.exists() {
                std::fs::write(&output_path, "placeholder").expect("Failed to write placeholder sidecar");
            }
        }
    }

    tauri_build::build()
}
