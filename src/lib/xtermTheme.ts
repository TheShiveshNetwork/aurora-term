import { Terminal, ITheme } from "@xterm/xterm";

export function buildXtermTheme(): ITheme {
  const v = (name: string) => {
    const style = getComputedStyle(document.documentElement);
    return style ? style.getPropertyValue(name).trim() : "";
  };

  // Read theme colors from Tailwind v4 variables in globals.css, falling back gracefully
  return {
    background:          "#00000000",
    foreground:          v("--color-term-fg") || "#e8e8e8",
    cursor:              v("--color-primary") || "#dbfcff",
    cursorAccent:        v("--color-background") || "#131314",
    selectionBackground: v("--color-term-selection") || "rgba(255, 255, 255, 0.15)",
    black:               "#1a1a1a",
    red:                 "#e06c75",
    green:               "#98c379",
    yellow:              "#e5c07b",
    blue:                "#61afef",
    magenta:             "#c678dd",
    cyan:                "#56b6c2",
    white:               "#abb2bf",
    brightBlack:         "#5c6370",
    brightRed:           "#e06c75",
    brightGreen:         "#98c379",
    brightYellow:        "#e5c07b",
    brightBlue:          "#61afef",
    brightMagenta:       "#c678dd",
    brightCyan:          "#56b6c2",
    brightWhite:         "#ffffff",
  };
}

// Re-apply on theme toggle
export function syncTerminalTheme(terminal: Terminal): void {
  terminal.options.theme = buildXtermTheme();
}
