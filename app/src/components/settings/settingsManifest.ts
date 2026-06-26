export interface SettingsManifestEntry {
  id: string;
  label: string;
  description: string;
  elementId: string;
  section: string;
  subPage: string;
}

const CATEGORY: Record<string, Record<string, string>> = {
  general: {
    window: "Window",
    editor: "Editor",
    appearance: "Appearance",
    keybindings: "Keybindings",
  },
  agent: { ai: "AI" },
  about: { about: "About" },
};

export const SETTINGS_MANIFEST: SettingsManifestEntry[] = [
  // ── Window ──
  { id: "show-status-bar", label: "Show Status Bar", description: "Toggle status bar visibility", elementId: "setting-show-status-bar", section: "general", subPage: "window" },
  { id: "sidebar", label: "Show Sidebar", description: "Toggle sidebar visibility", elementId: "setting-sidebar", section: "general", subPage: "window" },
  { id: "right-panel", label: "Show Right Panel", description: "Toggle right panel visibility", elementId: "setting-right-panel", section: "general", subPage: "window" },
  { id: "command-input", label: "Show Command Input", description: "Toggle command input visibility", elementId: "setting-command-input", section: "general", subPage: "window" },
  { id: "tab-bar", label: "Show Tab Bar", description: "Toggle tab bar visibility", elementId: "setting-tab-bar", section: "general", subPage: "window" },
  { id: "blur-sidebar", label: "Blur Sidebar", description: "Toggle sidebar blur effect", elementId: "setting-blur-sidebar", section: "general", subPage: "window" },
  // ── Editor ──
  { id: "fontFamily", label: "Font Family", description: "Terminal font family", elementId: "setting-font-family", section: "general", subPage: "editor" },
  { id: "fontSize", label: "Font Size", description: "Terminal font size", elementId: "setting-font-size", section: "general", subPage: "editor" },
  { id: "cursorStyle", label: "Cursor Style", description: "Terminal cursor appearance", elementId: "setting-cursor-style", section: "general", subPage: "editor" },
  { id: "wordWrap", label: "Word Wrap", description: "Toggle word wrap", elementId: "setting-word-wrap", section: "general", subPage: "editor" },
  // ── Appearance ──
  { id: "theme", label: "Theme", description: "Dark/Light theme", elementId: "setting-theme", section: "general", subPage: "appearance" },
  { id: "editorTheme", label: "Editor Theme", description: "CodeMirror editor color theme", elementId: "setting-editor-theme", section: "general", subPage: "appearance" },
  // ── Keybindings ──
  { id: "keybindings", label: "Keybindings", description: "Terminal keybinding mode", elementId: "setting-keybindings", section: "general", subPage: "keybindings" },
  // ── AI ──
  { id: "ai-providers", label: "AI Providers", description: "Select and configure AI providers", elementId: "setting-ai-providers", section: "agent", subPage: "ai" },
  { id: "default-provider", label: "Default Provider", description: "Set default AI provider", elementId: "setting-default-provider", section: "agent", subPage: "ai" },
  { id: "api-key", label: "API Key", description: "Manage AI provider API keys", elementId: "setting-api-key", section: "agent", subPage: "ai" },
  // ── About ──
  { id: "about", label: "About Aurora", description: "Version, credits, and system info", elementId: "setting-about", section: "about", subPage: "about" },
];

export function categoryFor(section: string, subPage: string): string {
  return CATEGORY[section]?.[subPage] ?? section;
}
