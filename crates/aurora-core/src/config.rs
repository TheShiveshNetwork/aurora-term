use std::collections::HashMap;
use serde::{Deserialize, Serialize};

/// Default for ProviderConfig.enabled
const fn default_enabled() -> bool {
    true
}

/// Default for EditorConfig.theme
fn default_editor_theme() -> String {
    "dracula".to_string()
}

fn default_git_gui_mode() -> String {
    "tab".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct AppConfig {
    pub terminal: TerminalConfig,
    pub ai: AiConfig,
    pub keybindings: KeybindingsConfig,
    pub appearance: AppearanceConfig,
    pub editor: EditorConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct TerminalConfig {
    pub shell: String,
    pub font_family: String,
    pub font_size: u32,
    pub scrollback: u32,
    pub theme: String,
    pub cursor_style: String,
    pub cursor_blink: bool,
    #[serde(default = "default_enabled")]
    pub restore_tabs: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct AiConfig {
    pub active_provider: String,
    pub auto_explain: bool,
    pub context_lines: u32,
    pub anthropic: ProviderConfig,
    pub openai: ProviderConfig,
    pub gemini: ProviderConfig,
    pub nvidia: ProviderConfig,
    pub ollama: ProviderConfig,
    pub groq: ProviderConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ProviderConfig {
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    pub fast_model: String,
    pub balanced_model: String,
    pub powerful_model: String,
    pub base_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct KeybindingsConfig {
    pub mode: String,
    pub open_palette: String,
    pub open_ai_bar: String,
    pub new_tab: String,
    pub close_tab: String,
    pub split_h: String,
    pub split_v: String,
    #[serde(default)]
    pub overrides: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct AppearanceConfig {
    pub compact_ui: bool,
    pub show_statusbar: bool,
    pub blur_sidebar: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct EditorConfig {
    #[serde(default = "default_editor_theme")]
    pub theme: String,
    #[serde(default)]
    pub show_minimap: bool,
    #[serde(default = "default_git_gui_mode")]
    pub git_gui_mode: String,
    #[serde(default = "default_enabled")]
    pub word_wrap: bool,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            terminal: TerminalConfig {
                shell: if cfg!(target_os = "windows") {
                    "powershell.exe".to_string()
                } else {
                    "bash".to_string()
                },
                font_family: "JetBrains Mono".to_string(),
                font_size: 14,
                scrollback: 10000,
                theme: "dark".to_string(),
                cursor_style: "block".to_string(),
                cursor_blink: true,
                restore_tabs: true,
            },
            ai: AiConfig {
                active_provider: "groq".to_string(),
                auto_explain: true,
                context_lines: 50,
                groq: ProviderConfig {
                    enabled: true,
                    fast_model: "llama-3.2-3b-preview".to_string(),
                    balanced_model: "llama-3.3-70b-versatile".to_string(),
                    powerful_model: "deepseek-r1-distill-llama-70b".to_string(),
                    base_url: Some("https://api.groq.com/openai/v1".to_string()),
                },
                anthropic: ProviderConfig {
                    enabled: true,
                    fast_model: "claude-haiku-4-5-20251015".to_string(),
                    balanced_model: "claude-sonnet-4-6-20260217".to_string(),
                    powerful_model: "claude-opus-4-7-20260416".to_string(),
                    base_url: None,
                },
                openai: ProviderConfig {
                    enabled: false,
                    fast_model: "gpt-5-mini".to_string(),
                    balanced_model: "gpt-5.4-mini".to_string(),
                    powerful_model: "gpt-5.5".to_string(),
                    base_url: None,
                },
                gemini: ProviderConfig {
                    enabled: false,
                    fast_model: "gemini-3.1-flash-lite".to_string(),
                    balanced_model: "gemini-3.5-flash".to_string(),
                    powerful_model: "gemini-3.1-pro".to_string(),
                    base_url: None,
                },
                nvidia: ProviderConfig {
                    enabled: false,
                    fast_model: "meta/llama-3.1-8b-instruct".to_string(),
                    balanced_model: "meta/llama-4-scout-17b-16e-instruct".to_string(),
                    powerful_model: "meta/llama-3.1-405b-instruct".to_string(),
                    base_url: Some("https://integrate.api.nvidia.com/v1".to_string()),
                },
                ollama: ProviderConfig {
                    enabled: false,
                    fast_model: "llama3.2:3b".to_string(),
                    balanced_model: "llama3.1:8b".to_string(),
                    powerful_model: "llama3.1:70b".to_string(),
                    base_url: Some("http://localhost:11434".to_string()),
                },
            },
            keybindings: KeybindingsConfig {
                mode: "vim".to_string(),
                open_palette: "ctrl+p".to_string(),
                open_ai_bar: "ctrl+k".to_string(),
                new_tab: "ctrl+t".to_string(),
                close_tab: "ctrl+w".to_string(),
                split_h: "ctrl+shift+d".to_string(),
                split_v: "ctrl+shift+e".to_string(),
                overrides: HashMap::new(),
            },
            appearance: AppearanceConfig {
                compact_ui: false,
                show_statusbar: true,
                blur_sidebar: false,
            },
            editor: EditorConfig {
                theme: "dracula".to_string(),
                show_minimap: true,
                git_gui_mode: "tab".to_string(),
                word_wrap: true,
            },
        }
    }
}
