import { DEFAULT_KEYBINDINGS, useSettingsStore } from "../../stores/useSettingsStore";

export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

// CSI-u modifier encoding (kitty keyboard protocol):
//   1=none, 2=shift, 3=alt, 4=shift+alt, 5=ctrl, 6=ctrl+shift, 7=ctrl+alt, 8=ctrl+shift+alt
function encodeEnterModifier(e: KeyLike): number {
  let mod = 1;
  if (e.shiftKey) mod += 1;
  if (e.altKey) mod += 2;
  if (e.ctrlKey || e.metaKey) mod += 4;
  return mod;
}

// Modified Enter is disambiguated for TUIs (e.g. opencode reads \x1b[13;2u for
// Shift+Enter and \x1b[13;5u for Ctrl+Enter). Plain Enter stays \r for shells.
export function enterToPtyData(e: KeyLike): string {
  const mod = encodeEnterModifier(e);
  return mod === 1 ? "\r" : `\x1b[13;${mod}u`;
}

export function mapKeyToPtyData(e: KeyLike): string | null {
  if (e.key === "Enter") return enterToPtyData(e);
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
    const bindingKeys = overrides[kb.id] || kb.keys;
    return normalizeKeyCombination(bindingKeys) === pressed;
  });
}
