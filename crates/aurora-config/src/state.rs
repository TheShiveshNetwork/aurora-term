use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use aurora_core::AppError;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct SavedTab {
    pub id: String,
    pub tab_type: String,
    pub title: String,
    pub cwd: String,
    pub pinned: bool,
    pub file_path: Option<String>,
    pub shell: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct UiState {
    #[serde(default)]
    pub sidebar_collapsed: bool,
    #[serde(default = "default_true")]
    pub tab_bar_visible: bool,
    #[serde(default)]
    pub pinned_tabs: Vec<String>,
    #[serde(default)]
    pub section_visibility: HashMap<String, bool>,

    #[serde(default)]
    pub open_tabs: Vec<SavedTab>,
    #[serde(default)]
    pub active_tab_id: Option<String>,

    #[serde(default)]
    pub last_project_dir: Option<String>,
    #[serde(default)]
    pub last_workspace_cwd: Option<String>,
}

const fn default_true() -> bool {
    true
}

impl Default for UiState {
    fn default() -> Self {
        Self {
            sidebar_collapsed: false,
            tab_bar_visible: true,
            pinned_tabs: Vec::new(),
            section_visibility: HashMap::from([
                ("folders".to_string(), true),
                ("open_tabs".to_string(), true),
                ("outline".to_string(), false),
                ("timeline".to_string(), false),
                ("git".to_string(), false),
            ]),
            open_tabs: Vec::new(),
            active_tab_id: None,
            last_project_dir: None,
            last_workspace_cwd: None,
        }
    }
}

pub struct UiStateManager {
    path: PathBuf,
    pub state: UiState,
}

impl UiStateManager {
    pub fn new(state_dir: PathBuf) -> Self {
        let path = state_dir.join("state.json");
        Self {
            path,
            state: UiState::default(),
        }
    }

    pub fn load(&mut self) -> UiState {
        if !self.path.exists() {
            // Ensure parent dir exists
            if let Some(parent) = self.path.parent() {
                let _ = fs::create_dir_all(parent);
            }
            let _ = self.save();
            self.state = UiState::default();
            return self.state.clone();
        }

        let content = match fs::read_to_string(&self.path) {
            Ok(c) => c,
            Err(e) => {
                tracing::error!("Failed to read state file: {}", e);
                return UiState::default();
            }
        };

        match serde_json::from_str::<UiState>(&content) {
            Ok(state) => {
                self.state = state.clone();
                state
            }
            Err(e) => {
                tracing::error!("Failed to parse state file, using defaults: {}", e);
                UiState::default()
            }
        }
    }

    pub fn save(&self) -> Result<(), AppError> {
        if let Some(parent) = self.path.parent() {
            if !parent.exists() {
                fs::create_dir_all(parent)
                    .map_err(|e| AppError::Config(format!("Failed to create state dir: {}", e)))?;
            }
        }
        let content = serde_json::to_string_pretty(&self.state)
            .map_err(|e| AppError::Config(format!("Failed to serialize state: {}", e)))?;
        fs::write(&self.path, content)
            .map_err(|e| AppError::Config(format!("Failed to write state file: {}", e)))?;
        Ok(())
    }

    pub fn update_sidebar(&mut self, collapsed: bool, visible: bool) -> Result<(), AppError> {
        self.state.sidebar_collapsed = collapsed;
        self.state.tab_bar_visible = visible;
        self.save()
    }

    pub fn update_pinned_tabs(&mut self, pinned: Vec<String>) -> Result<(), AppError> {
        self.state.pinned_tabs = pinned;
        self.save()
    }

    pub fn update_section_visibility(&mut self, sections: HashMap<String, bool>) -> Result<(), AppError> {
        for (k, v) in sections {
            self.state.section_visibility.insert(k, v);
        }
        self.save()
    }

    pub fn update_tabs(&mut self, tabs: Vec<SavedTab>, active_id: Option<String>) -> Result<(), AppError> {
        self.state.open_tabs = tabs;
        self.state.active_tab_id = active_id;
        self.save()
    }

    pub fn set_project_dir(&mut self, path: Option<String>) -> Result<(), AppError> {
        self.state.last_project_dir = path;
        self.save()
    }

    pub fn set_workspace_cwd(&mut self, path: Option<String>) -> Result<(), AppError> {
        self.state.last_workspace_cwd = path;
        self.save()
    }
}
