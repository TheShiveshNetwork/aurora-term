// ── Keyboard Shortcut Catalog ──────────────────────────────────────────────
// Single source of truth for every app shortcut. Defaults live here and every
// place that renders or matches shortcuts reads from this catalog:
//   - useKeybindings / keymap   (input matching)
//   - KeybindingsSettingsView   (settings table)
//   - AppHeader menu + search   (title bar rendering)
//   - FileWorkspaceView         (workspace hints)
// User overrides from aurora.json are applied on app load into
// `useSettingsStore.keybindingOverrides` and surface through
// `getEffectiveKeybinding` / `getEffectiveKeybindings`.

export const KEYBINDING_IDS = {
  commandPalette: "command-palette",
  toggleAiBar: "toggle-ai-bar",
  newTerminalTab: "new-terminal-tab",
  closeTab: "close-tab",
  nextTab: "next-tab",
  prevTab: "prev-tab",
  newWindow: "new-window",
  openFolder: "open-folder",
  openFile: "open-file",
  toggleSidebar: "toggle-sidebar",
  focusSearch: "focus-search",
  openSettings: "open-settings",
  toggleTabBar: "toggle-tab-bar",
  saveFile: "save-file",
  find: "find",
  selectAll: "select-all",
  copy: "copy",
  cut: "cut",
  pasteClipboard: "paste-clipboard",
  toggleComment: "toggle-comment",
  formatDoc: "format-doc",
  goToDefinition: "go-to-definition",
  peekDefinition: "peek-definition",
  findReferences: "find-references",
  renameSymbol: "rename-symbol",
  runFile: "run-file",
  terminalSearch: "terminal-search",
  voiceInput: "voice-input",
  toggleWordWrap: "toggle-word-wrap",
  zoomIn: "zoom-in",
  zoomOut: "zoom-out",
  selectMatches: "select-matches",
  codeAction: "code-action",
  organizeImports: "organize-imports",
  findNext: "find-next",
  findPrev: "find-prev",
} as const;

export type KeybindingId = (typeof KEYBINDING_IDS)[keyof typeof KEYBINDING_IDS];

export type KeybindingWhen = "Global" | "Editor" | "Terminal" | "Editor / Terminal";

export interface KeybindingDef {
  id: KeybindingId;
  command: string;
  keys: string;
  when: string;
}

export type KeybindingOverrides = Record<string, string>;

export const DEFAULT_KEYBINDINGS: KeybindingDef[] = [
  { id: KEYBINDING_IDS.commandPalette, command: "Command Palette", keys: "Ctrl+P", when: "Global" },
  { id: KEYBINDING_IDS.toggleAiBar, command: "Toggle AI Bar", keys: "Ctrl+K", when: "Global" },
  { id: KEYBINDING_IDS.newTerminalTab, command: "New Terminal Tab", keys: "Ctrl+T", when: "Global" },
  { id: KEYBINDING_IDS.closeTab, command: "Close Tab", keys: "Ctrl+W", when: "Global" },
  { id: KEYBINDING_IDS.nextTab, command: "Next Tab", keys: "Ctrl+Tab", when: "Global" },
  { id: KEYBINDING_IDS.prevTab, command: "Previous Tab", keys: "Ctrl+Shift+Tab", when: "Global" },
  { id: KEYBINDING_IDS.newWindow, command: "New Window", keys: "Ctrl+Shift+N", when: "Global" },
  { id: KEYBINDING_IDS.openFolder, command: "Open Folder", keys: "Ctrl+O", when: "Global" },
  { id: KEYBINDING_IDS.openFile, command: "Open File", keys: "Ctrl+Shift+O", when: "Global" },
  { id: KEYBINDING_IDS.toggleSidebar, command: "Toggle Sidebar", keys: "Ctrl+B", when: "Global" },
  { id: KEYBINDING_IDS.focusSearch, command: "Focus Search Bar", keys: "Ctrl+Shift+F", when: "Global" },
  { id: KEYBINDING_IDS.openSettings, command: "Open Settings", keys: "Ctrl+,", when: "Global" },
  { id: KEYBINDING_IDS.toggleTabBar, command: "Toggle Tab Bar", keys: "Ctrl+Shift+P", when: "Global" },
  { id: KEYBINDING_IDS.saveFile, command: "Save File", keys: "Ctrl+S", when: "Global" },
  { id: KEYBINDING_IDS.find, command: "Find", keys: "Ctrl+F", when: "Editor" },
  { id: KEYBINDING_IDS.selectAll, command: "Select All", keys: "Ctrl+A", when: "Editor" },
  { id: KEYBINDING_IDS.copy, command: "Copy Line", keys: "Ctrl+C", when: "Editor" },
  { id: KEYBINDING_IDS.cut, command: "Cut Line", keys: "Ctrl+X", when: "Editor" },
  { id: KEYBINDING_IDS.pasteClipboard, command: "Paste", keys: "Ctrl+V", when: "Editor / Terminal" },
  { id: KEYBINDING_IDS.toggleComment, command: "Toggle Comment", keys: "Ctrl+/", when: "Editor" },
  { id: KEYBINDING_IDS.formatDoc, command: "Format Document", keys: "Ctrl+Shift+I", when: "Editor" },
  { id: KEYBINDING_IDS.goToDefinition, command: "Go to Definition", keys: "F12", when: "Editor" },
  { id: KEYBINDING_IDS.peekDefinition, command: "Peek Definition", keys: "Alt+F12", when: "Editor" },
  { id: KEYBINDING_IDS.findReferences, command: "Find References", keys: "Shift+F12", when: "Editor" },
  { id: KEYBINDING_IDS.renameSymbol, command: "Rename Symbol", keys: "F2", when: "Editor" },
  { id: KEYBINDING_IDS.runFile, command: "Run / Debug File", keys: "Ctrl+F5", when: "Editor" },
  { id: KEYBINDING_IDS.findNext, command: "Find Next", keys: "F3", when: "Editor" },
  { id: KEYBINDING_IDS.findPrev, command: "Find Previous", keys: "Shift+F3", when: "Editor" },
  { id: KEYBINDING_IDS.zoomIn, command: "Zoom In", keys: "Ctrl+=", when: "Editor" },
  { id: KEYBINDING_IDS.zoomOut, command: "Zoom Out", keys: "Ctrl+-", when: "Editor" },
  { id: KEYBINDING_IDS.selectMatches, command: "Select Matches", keys: "Shift+Ctrl+L", when: "Editor" },
  { id: KEYBINDING_IDS.codeAction, command: "Code Action", keys: "Ctrl+.", when: "Editor" },
  { id: KEYBINDING_IDS.organizeImports, command: "Organize Imports", keys: "Shift+Alt+O", when: "Editor" },
  { id: KEYBINDING_IDS.terminalSearch, command: "Search Terminal", keys: "Ctrl+Shift+F", when: "Terminal" },
  { id: KEYBINDING_IDS.voiceInput, command: "Toggle Voice Input", keys: "Ctrl+Alt+M", when: "Global" },
  { id: KEYBINDING_IDS.toggleWordWrap, command: "Toggle Word Wrap", keys: "Alt+Z", when: "Editor" },
];

/**
 * Normalize a raw combination into a consistent display form
 * ("ctrl+shift+p" / "Ctrl + Shift + P" → "Ctrl+Shift+P").
 */
export function formatKeybinding(keys: string): string {
  return keys
    .split("+")
    .map((part) => {
      const p = part.trim();
      if (!p) return p;
      const lower = p.toLowerCase();
      if (lower === "ctrl" || lower === "cmd" || lower === "meta") return "Ctrl";
      if (lower === "shift") return "Shift";
      if (lower === "alt") return "Alt";
      if (lower === "space") return "Space";
      if (lower === "up" || lower === "down" || lower === "left" || lower === "right") {
        return lower.charAt(0).toUpperCase() + lower.slice(1);
      }
      if (lower.length === 1) return lower.toUpperCase();
      return p.charAt(0).toUpperCase() + p.slice(1);
    })
    .join("+");
}

/** Effective keys for a single shortcut, honoring user overrides. */
export function getEffectiveKeybinding(id: KeybindingId, overrides: KeybindingOverrides = {}): string {
  const defaults = DEFAULT_KEYBINDINGS.find((kb) => kb.id === id)?.keys ?? "";
  return formatKeybinding(overrides[id] || defaults);
}

/** Effective keys for every catalogued shortcut, honoring user overrides. */
export function getEffectiveKeybindings(overrides: KeybindingOverrides = {}): Record<KeybindingId, string> {
  const effective = {} as Record<KeybindingId, string>;
  for (const kb of DEFAULT_KEYBINDINGS) {
    effective[kb.id] = getEffectiveKeybinding(kb.id, overrides);
  }
  return effective;
}
