import { create } from "zustand";
import {
  type KeybindingDef,
  type KeybindingOverrides,
} from "../lib/keybindings";
import { DEFAULT_SETTINGS } from "../lib/defaultSettings";

export { DEFAULT_KEYBINDINGS } from "../lib/keybindings";
export type { KeybindingDef } from "../lib/keybindings";

export type EditorMode = "NORMAL" | "INSERT" | "VISUAL" | "COMMAND";

export type EditorThemeName =
  | "one-dark"
  | "atomone"
  | "bespin"
  | "dracula"
  | "github"
  | "material"
  | "monokai"
  | "nord"
  | "okaidia"
  | "solarized"
  | "tokyo-night"
  | "vscode"
  | "xcode";

interface SettingsStore {
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
  cloudApiBaseUrl: string;
  updatesEnabled: boolean;
  updatesIntervalHours: number;

  setTheme: (theme: "dark" | "light") => void;
  setMode: (mode: EditorMode) => void;
  setFontFamily: (font: string) => void;
  setFontSize: (size: number) => void;
  setEditorFontSize: (size: number) => void;
  setCursorStyle: (style: "block" | "underline" | "bar") => void;
  setCursorBlink: (blink: boolean) => void;
  setCompactUi: (compact: boolean) => void;
  setShowStatusbar: (show: boolean) => void;
  setBlurSidebar: (blur: boolean) => void;
  setEditorTheme: (theme: EditorThemeName) => void;
  setShowMinimap: (show: boolean) => void;
  setKeybindingOverride: (id: string, keys: string) => void;
  resetKeybindingOverride: (id: string) => void;
  setGitGuiMode: (mode: "tab" | "window") => void;
  setRestoreTabs: (restore: boolean) => void;
  setWordWrap: (wrap: boolean) => void;
  setAiLiveSuggestions: (enabled: boolean) => void;
  setIndentMarkers: (enabled: boolean) => void;
  setLspEnabled: (enabled: boolean) => void;
  setCloudAutoSync: (enabled: boolean) => void;
  setCloudApiBaseUrl: (url: string) => void;
  setUpdatesEnabled: (enabled: boolean) => void;
  setUpdatesIntervalHours: (hours: number) => void;
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  ...DEFAULT_SETTINGS,

  setTheme: (theme) => {
    set({ theme });
    document.documentElement.setAttribute("data-theme", theme);
  },
  setMode: (mode) => set({ mode }),
  setFontFamily: (fontFamily) => set({ fontFamily }),
  setFontSize: (fontSize) => set({ fontSize }),
  setEditorFontSize: (editorFontSize) => set({ editorFontSize }),
  setCursorStyle: (cursorStyle) => set({ cursorStyle }),
  setCursorBlink: (cursorBlink) => set({ cursorBlink }),
  setCompactUi: (compactUi) => set({ compactUi }),
  setShowStatusbar: (showStatusbar) => set({ showStatusbar }),
  setBlurSidebar: (blurSidebar) => set({ blurSidebar }),
  setEditorTheme: (editorTheme) => set({ editorTheme }),
  setShowMinimap: (showMinimap) => set({ showMinimap }),
  setGitGuiMode: (gitGuiMode) => set({ gitGuiMode }),
  setRestoreTabs: (restoreTabs) => set({ restoreTabs }),
  setWordWrap: (wordWrap) => set({ wordWrap }),
  setAiLiveSuggestions: (aiLiveSuggestions) => set({ aiLiveSuggestions }),
  setIndentMarkers: (indentMarkers) => set({ indentMarkers }),
  setLspEnabled: (lspEnabled) => set({ lspEnabled }),
  setCloudAutoSync: (cloudAutoSync) => set({ cloudAutoSync }),
  setCloudApiBaseUrl: (cloudApiBaseUrl) => set({ cloudApiBaseUrl }),
  setUpdatesEnabled: (updatesEnabled) => set({ updatesEnabled }),
  setUpdatesIntervalHours: (updatesIntervalHours) => set({ updatesIntervalHours }),
  setKeybindingOverride: (id, keys) => set((state) => ({ keybindingOverrides: { ...state.keybindingOverrides, [id]: keys } })),
  resetKeybindingOverride: (id) => set((state) => {
    const { [id]: _, ...rest } = state.keybindingOverrides;
    return { keybindingOverrides: rest };
  }),
}));
