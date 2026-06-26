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
  keybindingOverrides: Record<string, string>;

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
  keybindingOverrides: {},

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
  setKeybindingOverride: (id, keys) => set((state) => ({ keybindingOverrides: { ...state.keybindingOverrides, [id]: keys } })),
  resetKeybindingOverride: (id) => set((state) => {
    const { [id]: _, ...rest } = state.keybindingOverrides;
    return { keybindingOverrides: rest };
  }),
}));
