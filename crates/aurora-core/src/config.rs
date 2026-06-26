use serde::{Deserialize, Serialize};


#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub terminal: TerminalConfig,
    pub ai: AiConfig,
    pub keybindings: KeybindingsConfig,
    pub appearance: AppearanceConfig,
    pub ui: UiStateConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalConfig {
    pub shell: String,
    pub font_family: String,
    pub font_size: u32,
    pub scrollback: u32,
    pub theme: String,
    pub cursor_style: String, // "block" | "underline" | "bar"
    pub cursor_blink: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiConfig {
    pub active_provider: String, // "anthropic" | "openai" | "gemini" | "nvidia" | "ollama" | "groq"
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
pub struct ProviderConfig {
    pub fast_model: String,
    pub balanced_model: String,
    pub powerful_model: String,
    pub base_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeybindingsConfig {
    pub mode: String, // "vim" | "default"
    pub open_palette: String,
    pub open_ai_bar: String,
    pub new_tab: String,
    pub close_tab: String,
    pub split_h: String,
    pub split_v: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppearanceConfig {
    pub compact_ui: bool,
    pub show_statusbar: bool,
    pub blur_sidebar: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UiStateConfig {
    pub sidebar_collapsed: bool,
    pub tab_bar_visible: bool,
    pub pinned_tabs: Vec<String>,
    #[serde(default)]
    pub workspace_cwd: Option<String>,
}

impl Default for UiStateConfig {
    fn default() -> Self {
        Self {
            sidebar_collapsed: false,
            tab_bar_visible: true,
            pinned_tabs: Vec::new(),
            workspace_cwd: None,
        }
    }
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
            },
            ai: AiConfig {
                active_provider: "groq".to_string(),
                auto_explain: true,
                context_lines: 50,
                groq: ProviderConfig {
                    fast_model: "llama-3.2-3b-preview".to_string(),
                    balanced_model: "llama-3.3-70b-versatile".to_string(),
                    powerful_model: "deepseek-r1-distill-llama-70b".to_string(),
                    base_url: Some("https://api.groq.com/openai/v1".to_string()),
                },
                anthropic: ProviderConfig {
                    fast_model: "claude-haiku-4-5-20251015".to_string(),
                    balanced_model: "claude-sonnet-4-6-20260217".to_string(),
                    powerful_model: "claude-opus-4-7-20260416".to_string(),
                    base_url: None,
                },
                openai: ProviderConfig {
                    fast_model: "gpt-5-mini".to_string(),
                    balanced_model: "gpt-5.4-mini".to_string(),
                    powerful_model: "gpt-5.5".to_string(),
                    base_url: None,
                },
                gemini: ProviderConfig {
                    fast_model: "gemini-3.1-flash-lite".to_string(),
                    balanced_model: "gemini-3.5-flash".to_string(),
                    powerful_model: "gemini-3.1-pro".to_string(),
                    base_url: None,
                },
                nvidia: ProviderConfig {
                    fast_model: "meta/llama-3.1-8b-instruct".to_string(),
                    balanced_model: "meta/llama-4-scout-17b-16e-instruct".to_string(),
                    powerful_model: "meta/llama-3.1-405b-instruct".to_string(),
                    base_url: Some("https://integrate.api.nvidia.com/v1".to_string()),
                },
                ollama: ProviderConfig {
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
            },
            appearance: AppearanceConfig {
                compact_ui: false,
                show_statusbar: true,
                blur_sidebar: false,
            },
            ui: UiStateConfig::default(),
        }
    }
}
