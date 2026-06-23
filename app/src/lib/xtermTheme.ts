import { Terminal, ITheme } from "@xterm/xterm";

export function buildXtermTheme(): ITheme {
  return {
    // Background is transparent so the CSS bg-[#0D1117] of the container shows through
    background: "#00000000",
    foreground: "#E8EAF0",
    // cursor:               "#4F8CFF",
    cursorAccent: "#0A0D14",
    selectionBackground: "rgba(79,140,255,0.25)",
    selectionForeground: "#E8EAF0",

    // One Dark Pro — aligned with Aurora palette
    black: "#1E2430",
    red: "#FF6B6B",
    green: "#3DDC84",
    yellow: "#FFB454",
    blue: "#61AFEF",
    magenta: "#9A7CFF",
    cyan: "#42C6FF",
    white: "#ABB2BF",

    brightBlack: "#4B5263",
    brightRed: "#FF6B6B",
    brightGreen: "#3DDC84",
    brightYellow: "#FFB454",
    brightBlue: "#4F8CFF",
    brightMagenta: "#C9A9FF",
    brightCyan: "#56D5F8",
    brightWhite: "#E8EAF0",
  };
}

// Re-apply on theme toggle
export function syncTerminalTheme(terminal: Terminal): void {
  terminal.options.theme = buildXtermTheme();
}
