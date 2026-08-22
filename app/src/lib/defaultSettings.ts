// ── Default Settings ─────────────────────────────────────────────────────
// Single source of truth for the setting states the app ships with.
//
// These defaults are compiled into the bundle — nothing is written to disk at
// install time. On window open, `useAppBootstrap` reads the merged config
// (`aurora.json`) and overrides these values where the user changed them.
// Because defaults live in code, "reset to default" always reflects the
// current release instead of a stale copy persisted at install time.
//
// Keep in sync with `AppConfig::default()` in `crates/aurora-core/src/config.rs`
// so the Rust and TypeScript layers agree on the shipped defaults.

import { DEFAULT_KEYBINDINGS } from "./keybindings";
import type { KeybindingDef, KeybindingOverrides } from "./keybindings";
import type { EditorMode, EditorThemeName } from "../stores/useSettingsStore";

export interface DefaultSettings {
  theme: "dark" | "light";
  mode: EditorMode;
  fontFamily: string;
  fontSize: number;
  editorFontSize: number;
  cursorStyle: "block" | "underline" | "bar";
  cursorBlink: boolean;
  compactUi: boolean;
  showStatusbar: boolean;
  blurSidebar: boolean;
  editorTheme: EditorThemeName;
  showMinimap: boolean;
  keybindings: KeybindingDef[];
  keybindingOverrides: KeybindingOverrides;
  gitGuiMode: "tab" | "window";
  restoreTabs: boolean;
  wordWrap: boolean;
  aiLiveSuggestions: boolean;
  indentMarkers: boolean;
  lspEnabled: boolean;
  cloudAutoSync: boolean;
  updatesEnabled: boolean;
}

export const DEFAULT_SETTINGS: DefaultSettings = {
  theme: "dark",
  mode: "INSERT",
  fontFamily: "JetBrains Mono",
  fontSize: 14,
  editorFontSize: 14,
  cursorStyle: "block",
  cursorBlink: true,
  compactUi: false,
  showStatusbar: true,
  blurSidebar: false,
  editorTheme: "dracula",
  showMinimap: true,
  keybindings: DEFAULT_KEYBINDINGS,
  keybindingOverrides: {},
  gitGuiMode: "tab",
  restoreTabs: true,
  wordWrap: true,
  aiLiveSuggestions: true,
  indentMarkers: true,
  lspEnabled: true,
  cloudAutoSync: false,
  updatesEnabled: true,
};
