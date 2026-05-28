use std::fs;
use std::path::PathBuf;

use aurora_core::config::AppConfig;
use aurora_core::AppError;

pub struct ConfigLoader {
    config_dir: PathBuf,
    config_path: PathBuf,
}

impl ConfigLoader {
    pub fn new<R: tauri::Runtime>(manager: &impl tauri::Manager<R>) -> Result<Self, AppError> {
        let config_dir = manager
            .path()
            .app_config_dir()
            .map_err(|e| AppError::Config(format!("Failed to get app config dir: {}", e)))?;
        
        let config_path = config_dir.join("config.toml");
        
        Ok(Self {
            config_dir,
            config_path,
        })
    }

    pub fn load(&self) -> Result<AppConfig, AppError> {
        if !self.config_path.exists() {
            let default_config = AppConfig::default();
            self.save(&default_config)?;
            return Ok(default_config);
        }

        let content = fs::read_to_string(&self.config_path)
            .map_err(|e| AppError::Config(format!("Failed to read config file: {}", e)))?;

        let config: AppConfig = toml::from_str(&content)
            .map_err(|e| AppError::Config(format!("Failed to parse config file: {}", e)))?;

        Ok(config)
    }

    pub fn save(&self, config: &AppConfig) -> Result<(), AppError> {
        if !self.config_dir.exists() {
            fs::create_dir_all(&self.config_dir)
                .map_err(|e| AppError::Config(format!("Failed to create config dir: {}", e)))?;
        }

        let content = toml::to_string_pretty(config)
            .map_err(|e| AppError::Config(format!("Failed to serialize config: {}", e)))?;

        fs::write(&self.config_path, content)
            .map_err(|e| AppError::Config(format!("Failed to write config file: {}", e)))?;

        Ok(())
    }
}
