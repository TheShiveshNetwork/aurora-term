import { create } from "zustand";
import {
  DEFAULT_KEYBINDINGS,
  type KeybindingDef,
  type KeybindingOverrides,
} from "../lib/keybindings";

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
  aiCodeCompletion: boolean;
  aiSuggestions: boolean;
  indentMarkers: boolean;
  cloudAutoSync: boolean;
  cloudApiBaseUrl: string;
  updatesEnabled: boolean;
  updatesIntervalHours: number;

  setTheme: (theme: "dark" | "light") => void;
  setMode: (mode: EditorMode) => void;
  setFontFamily: (font: string) => void;
  setFontSize: (size: number) => void;
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
  setAiCodeCompletion: (enabled: boolean) => void;
  setAiSuggestions: (enabled: boolean) => void;
  setIndentMarkers: (enabled: boolean) => void;
  setCloudAutoSync: (enabled: boolean) => void;
  setCloudApiBaseUrl: (url: string) => void;
  setUpdatesEnabled: (enabled: boolean) => void;
  setUpdatesIntervalHours: (hours: number) => void;
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  theme: "dark",
  mode: "INSERT",
  fontFamily: "JetBrains Mono",
  fontSize: 14,
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
  aiCodeCompletion: true,
  aiSuggestions: true,
  indentMarkers: true,
  cloudAutoSync: false,
  cloudApiBaseUrl: "",
  updatesEnabled: true,
  updatesIntervalHours: 24,

  setTheme: (theme) => {
    set({ theme });
    document.documentElement.setAttribute("data-theme", theme);
  },
  setMode: (mode) => set({ mode }),
  setFontFamily: (fontFamily) => set({ fontFamily }),
  setFontSize: (fontSize) => set({ fontSize }),
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
  setAiCodeCompletion: (aiCodeCompletion) => set({ aiCodeCompletion }),
  setAiSuggestions: (aiSuggestions) => set({ aiSuggestions }),
  setIndentMarkers: (indentMarkers) => set({ indentMarkers }),
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
