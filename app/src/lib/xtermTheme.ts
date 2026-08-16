import { Terminal, ITheme } from "@xterm/xterm";

// Read a CSS custom property off :root at runtime. xterm's background must
// mirror the app's background (never a hardcoded/duplicated value) so that
// ANSI background-color cells composite correctly under the WebGL renderer.
// A fully transparent theme background causes the WebGL addon to paint those
// background-colored cells as opaque black — see buildXtermTheme below.
function cssVar(name: string, fallback: string): string {
  if (typeof document === "undefined" || !document.documentElement) return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

export function buildXtermTheme(): ITheme {
  // The terminal lives inside the terminal workspace region, which uses
  // `bg-surface-container-low`. Mirror that exact token so the terminal
  // background is identical to the surrounding app chrome.
  const bg = cssVar("--color-surface-container-low", "#131A24");
  const selection = cssVar("--color-term-selection", "rgba(79,140,255,0.25)");
  return {
    // Opaque background taken from the app's CSS theme variable. Using a
    // transparent background ("#00000000") made the WebGL renderer fill any
    // ANSI background-colored cells (e.g. Vite build manifest lines) with
    // opaque black. An opaque, theme-matched background avoids that and keeps
    // the terminal visually seamless with the surrounding app chrome.
    background: bg,
    foreground: cssVar("--color-term-fg", "#E8EAF0"),
    // cursor:               "#4F8CFF",
    cursorAccent: bg,
    selectionBackground: selection,
    selectionForeground: cssVar("--color-term-fg", "#E8EAF0"),

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
