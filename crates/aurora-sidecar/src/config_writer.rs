//! Writes opencode config.toml or opencode.json on startup based on aurora-term's AppConfig.

use std::path::{Path, PathBuf};
use std::fs::File;
use std::io::Write;
use serde_json::json;
use aurora_core::AppError;

/// Writes the configuration for the OpenCode sidecar.
pub fn write_config(
    temp_dir: &Path,
    provider: &str,
    api_key: &str,
    port: u16,
) -> Result<PathBuf, AppError> {
    let config_data = json!({
        "port": port,
        "active_provider": provider,
        "providers": {
            provider: {
                "api_key": api_key
            }
        }
    });

    let config_path = temp_dir.join("opencode.json");
    let mut file = File::create(&config_path)?;
    
    let json_str = serde_json::to_string_pretty(&config_data)
        .map_err(|e| AppError::Config(e.to_string()))?;
        
    file.write_all(json_str.as_bytes())?;

    Ok(config_path)
}
