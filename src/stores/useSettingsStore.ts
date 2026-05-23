import { create } from "zustand";

export type EditorMode = "NORMAL" | "INSERT" | "VISUAL" | "COMMAND";

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
  
  setTheme: (theme: "dark" | "light") => void;
  setMode: (mode: EditorMode) => void;
  setFontFamily: (font: string) => void;
  setFontSize: (size: number) => void;
  setCursorStyle: (style: "block" | "underline" | "bar") => void;
  setCursorBlink: (blink: boolean) => void;
  setCompactUi: (compact: boolean) => void;
  setShowStatusbar: (show: boolean) => void;
  setBlurSidebar: (blur: boolean) => void;
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  theme: "dark",
  mode: "INSERT", // Start in standard insert mode so PTY handles typing by default
  fontFamily: "JetBrains Mono",
  fontSize: 14,
  cursorStyle: "block",
  cursorBlink: true,
  compactUi: false,
  showStatusbar: true,
  blurSidebar: false,

  setTheme: (theme) => {
    set({ theme });
    // Apply data-theme attribute for CSS theme switching as requested by AGENT.md section 10
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
}));
