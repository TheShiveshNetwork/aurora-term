import { create } from "zustand";

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

export interface KeybindingDef {
  id: string;
  command: string;
  keys: string;
  when: string;
}

export const DEFAULT_KEYBINDINGS: KeybindingDef[] = [
  { id: "command-palette", command: "Command Palette", keys: "Ctrl+P", when: "Global" },
  { id: "toggle-ai-bar", command: "Toggle AI Bar", keys: "Ctrl+K", when: "Global" },
  { id: "new-terminal-tab", command: "New Terminal Tab", keys: "Ctrl+T", when: "Global" },
  { id: "close-tab", command: "Close Tab", keys: "Ctrl+W", when: "Global" },
  { id: "next-tab", command: "Next Tab", keys: "Ctrl+Tab", when: "Global" },
  { id: "prev-tab", command: "Previous Tab", keys: "Ctrl+Shift+Tab", when: "Global" },
  { id: "new-window", command: "New Window", keys: "Ctrl+Shift+N", when: "Global" },
  { id: "open-folder", command: "Open Folder", keys: "Ctrl+O", when: "Global" },
  { id: "open-file", command: "Open File", keys: "Ctrl+Shift+O", when: "Global" },
  { id: "toggle-sidebar", command: "Toggle Sidebar", keys: "Ctrl+B", when: "Global" },
  { id: "focus-search", command: "Focus Search Bar", keys: "Ctrl+Shift+F", when: "Global" },
  { id: "open-settings", command: "Open Settings", keys: "Ctrl+,", when: "Global" },
  { id: "toggle-tab-bar", command: "Toggle Tab Bar", keys: "Ctrl+Shift+P", when: "Global" },
  { id: "save-file", command: "Save File", keys: "Ctrl+S", when: "Global" },
  { id: "find", command: "Find", keys: "Ctrl+F", when: "Editor" },
  { id: "select-all", command: "Select All", keys: "Ctrl+A", when: "Editor" },
  { id: "copy", command: "Copy Line", keys: "Ctrl+C", when: "Editor / Terminal" },
  { id: "cut", command: "Cut Line", keys: "Ctrl+X", when: "Editor" },
  { id: "paste-clipboard", command: "Paste", keys: "Ctrl+V", when: "Editor / Terminal" },
  { id: "toggle-comment", command: "Toggle Comment", keys: "Ctrl+/", when: "Editor" },
  { id: "format-doc", command: "Format Document", keys: "Ctrl+Shift+I", when: "Editor" },
  { id: "go-to-definition", command: "Go to Definition", keys: "F12", when: "Editor" },
  { id: "peek-definition", command: "Peek Definition", keys: "Alt+F12", when: "Editor" },
  { id: "find-references", command: "Find References", keys: "Shift+F12", when: "Editor" },
  { id: "rename-symbol", command: "Rename Symbol", keys: "F2", when: "Editor" },
  { id: "run-file", command: "Run / Debug File", keys: "Ctrl+F5", when: "Editor" },
  { id: "terminal-search", command: "Search Terminal", keys: "Ctrl+Shift+F", when: "Terminal" },
  { id: "voice-input", command: "Toggle Voice Input", keys: "Ctrl+Alt+M", when: "Global" },
];

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
  keybindingOverrides: Record<string, string>;
  gitGuiMode: "tab" | "window";
  restoreTabs: boolean;

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
  setKeybindingOverride: (id, keys) => set((state) => ({ keybindingOverrides: { ...state.keybindingOverrides, [id]: keys } })),
  resetKeybindingOverride: (id) => set((state) => {
    const { [id]: _, ...rest } = state.keybindingOverrides;
    return { keybindingOverrides: rest };
  }),
}));
