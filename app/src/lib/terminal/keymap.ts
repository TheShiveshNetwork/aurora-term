import { DEFAULT_KEYBINDINGS, getEffectiveKeybinding } from "../keybindings";
import { useSettingsStore } from "../../stores/useSettingsStore";

export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

// Keyboard enhancement protocol the TUI negotiated. "legacy" means none was
// requested, so a distinguishable modified key cannot be emitted (matches
// xterm.js, which collapses modified Enter to \r).
export type KbMode = "legacy" | "csi-u" | "kitty";

// CSI-u (fixterms / libtermkey / modifyOtherKeys DEC 1036). Modifier param is
// 1 + sum of Shift(1) + Alt(2) + Ctrl(4) + Meta(8).
function csiU(base: number, e: KeyLike): string {
  let modifiers = 0;
  if (e.shiftKey) modifiers += 1;
  if (e.altKey) modifiers += 2;
  if (e.ctrlKey) modifiers += 4;
  if (e.metaKey) modifiers += 8;
  return `\x1b[${base};${modifiers + 1}u`;
}

// Kitty keyboard protocol (DEC 9001). Same modifier bits but WITHOUT the +1 and
// prefixed with `<`.
function kitty(base: number, e: KeyLike): string {
  let modifiers = 0;
  if (e.shiftKey) modifiers += 1;
  if (e.altKey) modifiers += 2;
  if (e.ctrlKey) modifiers += 4;
  if (e.metaKey) modifiers += 8;
  return `\x1b[<${base};${modifiers}u`;
}

// Encode Enter for the PTY. Unmodified Enter is always a bare \r. Modified Enter
// is encoded in whatever keyboard protocol the TUI negotiated so the app (vim,
// opencode/crossterm, neovim, etc.) receives a distinguishable key — a bare \r
// would make Ctrl/Shift/Alt/Meta+Enter behave identically and appear "not
// working". In legacy mode (no negotiation) we cannot distinguish and fall
// back to \r, matching xterm.js behavior.
export function modifiedEnterToPtyData(e: KeyLike, mode: KbMode): string {
  if (e.key !== "Enter") return "\r";
  if (!e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey) return "\r";
  if (mode === "kitty") return kitty(13, e);
  if (mode === "csi-u") return csiU(13, e);
  return "\r";
}

export function mapKeyToPtyData(e: KeyLike, kbMode: KbMode = "legacy"): string | null {
  if (e.key === "Enter") return modifiedEnterToPtyData(e, kbMode);
  if (e.key === "Backspace") return "\x7f";
  if (e.key === "Tab") return "\t";
  if (e.key === "Escape") return "\x1b";

  if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey) {
    const lower = e.key.toLowerCase();
    if (lower.length === 1) {
      const code = lower.charCodeAt(0);
      if (code >= 97 && code <= 122) return String.fromCharCode(code - 96);
    }
    if (e.key === "[") return "\x1b";
    if (e.key === "\\") return "\x1c";
    if (e.key === "]") return "\x1d";
    if (e.key === "2") return "\x00";
    if (e.key === "6") return "\x1e";
    if (e.key === "7") return "\x1f";
    if (e.key === "8") return "\x7f";
    if (e.key === "-" || e.key === "_") return "\x1f";
    if (e.key === "/" || e.key === "?") return "\x1f";
    if (e.key === " ") return "\x00";
  }

  if (e.ctrlKey && e.shiftKey) return null;

  const special: Record<string, string> = {
    ArrowUp: "\x1b[A",
    ArrowDown: "\x1b[B",
    ArrowRight: "\x1b[C",
    ArrowLeft: "\x1b[D",
    Home: "\x1b[H",
    End: "\x1b[F",
    PageUp: "\x1b[5~",
    PageDown: "\x1b[6~",
    Delete: "\x1b[3~",
    Insert: "\x1b[2~",
    F1: "\x1bOP",
    F2: "\x1bOQ",
    F3: "\x1bOR",
    F4: "\x1bOS",
  };
  if (special[e.key]) return special[e.key];

  if (e.altKey && e.key.length === 1) return `\x1b${e.key}`;

  if (e.key.length === 1) return e.key;

  return null;
}

function normalizeKeyCombination(combo: string): string {
  return combo.toLowerCase().replace(/\s+/g, "").split("+").sort().join("+");
}

function pressedCombo(e: KeyLike): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("ctrl");
  if (e.shiftKey) parts.push("shift");
  if (e.altKey) parts.push("alt");

  let key = e.key.toLowerCase();
  if (key === " ") key = "space";
  else if (key === "arrowup") key = "up";
  else if (key === "arrowdown") key = "down";
  else if (key === "arrowleft") key = "left";
  else if (key === "arrowright") key = "right";

  parts.push(key);
  return parts.sort().join("+");
}

export function isGlobalAppShortcut(e: KeyLike): boolean {
  const pressed = pressedCombo(e);
  const overrides = useSettingsStore.getState().keybindingOverrides;
  return DEFAULT_KEYBINDINGS.some((kb) => {
    if (kb.when !== "Global") return false;
    const bindingKeys = getEffectiveKeybinding(kb.id, overrides);
    return normalizeKeyCombination(bindingKeys) === pressed;
  });
}
