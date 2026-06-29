use std::fs;
use std::path::PathBuf;

use serde_json::Value;

use aurora_core::config::AppConfig;
use aurora_core::AppError;

pub struct ConfigManager {
    global_dir: PathBuf,
    global_path: PathBuf,
    project_path: Option<PathBuf>,
    pub global_config: AppConfig,
    pub project_config: Option<AppConfig>,
    pub merged_config: AppConfig,
}

pub fn deep_merge_raw(global: &mut Value, project: &Value) {
    match (global, project) {
        (Value::Object(g), Value::Object(p)) => {
            for (k, v) in p {
                if g.contains_key(k) && v.is_object() {
                    deep_merge_raw(&mut g[k], v);
                } else {
                    g[k] = v.clone();
                }
            }
        }
        (g, p) => *g = p.clone(),
    }
}

fn read_json_file(path: &PathBuf) -> Result<AppConfig, AppError> {
    let content = fs::read_to_string(path)
        .map_err(|e| AppError::Config(format!("Failed to read {}: {}", path.display(), e)))?;
    let config: AppConfig = serde_json::from_str(&content)
        .map_err(|e| AppError::Config(format!("Failed to parse {}: {}", path.display(), e)))?;
    Ok(config)
}

fn write_json_file(path: &PathBuf, config: &AppConfig) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent)
                .map_err(|e| AppError::Config(format!("Failed to create dir {}: {}", parent.display(), e)))?;
        }
    }

    // Write to a temp file first, then rename for atomicity
    let tmp_path = path.with_extension("json.tmp");
    let content = serde_json::to_string_pretty(config)
        .map_err(|e| AppError::Config(format!("Failed to serialize config: {}", e)))?;
    fs::write(&tmp_path, &content)
        .map_err(|e| AppError::Config(format!("Failed to write {}: {}", tmp_path.display(), e)))?;
    fs::rename(&tmp_path, path)
        .map_err(|e| AppError::Config(format!("Failed to rename {} -> {}: {}", tmp_path.display(), path.display(), e)))?;

    Ok(())
}

fn backup_file(path: &PathBuf) {
    let bak = path.with_extension("json.bak");
    if path.exists() {
        let _ = fs::copy(path, bak);
    }
}

impl ConfigManager {
    pub fn new(global_dir: PathBuf, project_dir: Option<PathBuf>) -> Self {
        let global_path = global_dir.join("aurora.json");

        let project_path = project_dir.as_ref().map(|pd| pd.join(".aurora").join("aurora.json"));

        Self {
            global_dir,
            global_path,
            project_path,
            global_config: AppConfig::default(),
            project_config: None,
            merged_config: AppConfig::default(),
        }
    }

    /// Migrate from legacy config.toml to aurora.json if needed.
    fn migrate_if_needed(&self) -> Result<(), AppError> {
        let legacy = self.global_dir.join("config.toml");
        if !self.global_path.exists() && legacy.exists() {
            let content = fs::read_to_string(&legacy)
                .map_err(|e| AppError::Config(format!("Failed to read legacy config: {}", e)))?;
            // Parse legacy TOML as JSON-compatible Value for migration
            let legacy_value: Value = toml::from_str(&content)
                .map_err(|e| AppError::Config(format!("Failed to parse legacy config: {}", e)))?;
            // Convert to JSON and write
            if let Some(parent) = self.global_path.parent() {
                if !parent.exists() {
                    fs::create_dir_all(parent)
                        .map_err(|e| AppError::Config(format!("Failed to create dir: {}", e)))?;
                }
            }
            let json_str = serde_json::to_string_pretty(&legacy_value)
                .map_err(|e| AppError::Config(format!("Failed to serialize: {}", e)))?;
            fs::write(&self.global_path, &json_str)
                .map_err(|e| AppError::Config(format!("Failed to write aurora.json: {}", e)))?;
            // Remove legacy file
            let _ = fs::remove_file(&legacy);
            tracing::info!("Migrated config.toml -> aurora.json");
        }
        Ok(())
    }

    /// Load global config (create defaults if missing), then overlay project config if present.
    pub fn load(&mut self) -> Result<AppConfig, AppError> {
        // Phase 1: migration
        self.migrate_if_needed()?;

        // Phase 2: load or create global
        if !self.global_path.exists() {
            let default_config = AppConfig::default();
            write_json_file(&self.global_path, &default_config)?;
            self.global_config = default_config.clone();
            self.merged_config = default_config;
            self.project_config = None;
            return Ok(self.merged_config.clone());
        }

        let global: AppConfig = read_json_file(&self.global_path)?;
        self.global_config = global.clone();
        self.merged_config = global;

        // Phase 3: overlay project config
        if let Some(ref pp) = self.project_path {
            if pp.exists() {
                let project: AppConfig = read_json_file(pp)?;
                self.project_config = Some(project.clone());

                // Deep merge
                let mut global_value =
                    serde_json::to_value(&self.merged_config)
                        .map_err(|e| AppError::Config(format!("Serialization error: {}", e)))?;
                let project_value =
                    serde_json::to_value(&project)
                        .map_err(|e| AppError::Config(format!("Serialization error: {}", e)))?;
                deep_merge_raw(&mut global_value, &project_value);

                let merged: AppConfig = serde_json::from_value(global_value)
                    .map_err(|e| AppError::Config(format!("Deserialization error: {}", e)))?;
                self.merged_config = merged;
            }
        }

        Ok(self.merged_config.clone())
    }

    pub fn save_global(&mut self, config: &AppConfig) -> Result<(), AppError> {
        backup_file(&self.global_path);
        write_json_file(&self.global_path, config)?;
        self.global_config = config.clone();
        Ok(())
    }

    pub fn save_project(&mut self, config: &AppConfig) -> Result<(), AppError> {
        if let Some(ref pp) = self.project_path {
            backup_file(pp);
            write_json_file(pp, config)?;
            self.project_config = Some(config.clone());
            Ok(())
        } else {
            Err(AppError::Config("No project directory set".to_string()))
        }
    }

    pub fn set_project_dir(&mut self, project_dir: Option<PathBuf>) -> Result<AppConfig, AppError> {
        self.project_path = project_dir.map(|pd| pd.join(".aurora").join("aurora.json"));
        self.project_config = None;
        self.load()
    }

    pub fn has_project(&self) -> bool {
        self.project_path.as_ref().is_some_and(|p| p.exists())
    }

    pub fn global_path(&self) -> &PathBuf {
        &self.global_path
    }

    pub fn project_path(&self) -> Option<&PathBuf> {
        self.project_path.as_ref()
    }
}
