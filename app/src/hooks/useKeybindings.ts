import { useEffect } from "react";
import { useSessionStore } from "../stores/useSessionStore";
import { useAppShellStore } from "../stores/useAppShellStore";
import { useSettingsStore, DEFAULT_KEYBINDINGS } from "../stores/useSettingsStore";
import { usePTY } from "./usePTY";
import { getDefaultShellLaunch } from "../lib/shell";
import { system } from "../lib/ipc";

// Helper to normalize combinations (sorts keys alphabetically so ctrl+shift+n is same as shift+ctrl+n)
function normalizeKeyCombination(combo: string): string {
  return combo
    .toLowerCase()
    .replace(/\s+/g, "")
    .split("+")
    .sort()
    .join("+");
}

function getPressedCombo(e: KeyboardEvent): string {
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

  if (key === "control" || key === "shift" || key === "alt" || key === "meta") {
    return "";
  }

  parts.push(key);
  return parts.sort().join("+");
}

const getKeyboardContext = (): "Editor" | "Terminal" | "Global" => {
  const active = document.activeElement;
  if (!active) return "Global";
  if (active.classList.contains("cm-content") || active.closest(".cm-editor")) {
    return "Editor";
  }
  if (active.classList.contains("xterm-helper-textarea") || active.closest(".terminal-pane")) {
    return "Terminal";
  }
  return "Global";
};

export function useKeybindings() {
  const { spawnSession, openFile, killSession } = usePTY();

  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      const pressed = getPressedCombo(e);
      if (!pressed) return;

      const keybindingOverrides = useSettingsStore.getState().keybindingOverrides;
      const context = getKeyboardContext();

      // Find matched keybinding
      const matched = DEFAULT_KEYBINDINGS.find((kb) => {
        const bindingKeys = keybindingOverrides[kb.id] || kb.keys;
        const normalizedBinding = normalizeKeyCombination(bindingKeys);
        if (normalizedBinding !== pressed) return false;

        // Context filter
        if (kb.when === "Global") return true;
        if (kb.when === "Editor" && context === "Editor") return true;
        if (kb.when === "Terminal" && context === "Terminal") return true;
        if (kb.when === "Editor / Terminal" && (context === "Editor" || context === "Terminal")) return true;

        return false;
      });

      if (!matched) return;

      if (matched.id === "save-file" && context === "Terminal") {
        return;
      }

      // Prevent default browser shortcuts for registered app commands (unless it's copy/paste/select/find/comment passthrough)
      const PASSTHROUGH_SHORTCUTS = ["copy", "cut", "paste-clipboard", "select-all", "find", "toggle-comment"];
      if (!PASSTHROUGH_SHORTCUTS.includes(matched.id)) {
        e.preventDefault();
        e.stopPropagation();
      }

      const activeTabId = useSessionStore.getState().activeTabId;
      const appShellStore = useAppShellStore.getState();

      switch (matched.id) {
        case "command-palette":
          window.dispatchEvent(new CustomEvent("focus-search-bar"));
          break;

        case "toggle-ai-bar":
          appShellStore.setShowAiBar(!appShellStore.showAiBar);
          break;

        case "new-terminal-tab": {
          const { shell, args } = getDefaultShellLaunch();
          const spawnCwd = appShellStore.projectDir || appShellStore.cwdAbsolute;
          spawnSession(shell, args, {}, spawnCwd).catch(console.error);
          break;
        }

        case "close-tab":
          if (activeTabId) {
            killSession(activeTabId);
          }
          break;

        case "next-tab": {
          const { tabs, activeTabId, setActiveTabId } = useSessionStore.getState();
          if (tabs.length > 1 && activeTabId) {
            const currentIndex = tabs.findIndex((t) => t.id === activeTabId);
            const nextIndex = (currentIndex + 1) % tabs.length;
            setActiveTabId(tabs[nextIndex].id);
          }
          break;
        }

        case "prev-tab": {
          const { tabs, activeTabId, setActiveTabId } = useSessionStore.getState();
          if (tabs.length > 1 && activeTabId) {
            const currentIndex = tabs.findIndex((t) => t.id === activeTabId);
            const prevIndex = (currentIndex - 1 + tabs.length) % tabs.length;
            setActiveTabId(tabs[prevIndex].id);
          }
          break;
        }

        case "new-window": {
          const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
          try {
            new WebviewWindow(`aurora_${Date.now()}`, {
              title: "Aurora Terminal",
              url: "/",
              width: 1024,
              height: 768,
              minWidth: 800,
              minHeight: 500,
              decorations: false,
            });
          } catch (err) {
            console.error(err);
          }
          break;
        }

        case "open-folder": {
          const selected = await system.selectFolder();
          if (selected) {
            appShellStore.setProjectDir(selected);
            appShellStore.setWorkspaceCwd(selected);
          }
          break;
        }

        case "open-file": {
          const selected = await system.selectFile();
          if (selected) {
            openFile(selected, appShellStore.projectDir || appShellStore.cwdAbsolute);
            appShellStore.setViewMode("file");
          }
          break;
        }

        case "toggle-sidebar":
          appShellStore.setSidebarCollapsed(!appShellStore.sidebarCollapsed);
          break;

        case "focus-search":
          window.dispatchEvent(new CustomEvent("focus-search-bar"));
          break;

        case "open-settings": {
          const { openSettingsWindow } = await import("../lib/settings");
          openSettingsWindow().catch(console.error);
          break;
        }

        case "toggle-tab-bar":
          appShellStore.setTabBarVisible(!appShellStore.tabBarVisible);
          break;

        case "save-file":
          if (activeTabId) {
            window.dispatchEvent(new CustomEvent("file-save", { detail: { tabId: activeTabId } }));
          }
          break;

        case "format-doc":
          if (activeTabId) {
            window.dispatchEvent(new CustomEvent("file-format-document", { detail: { tabId: activeTabId } }));
          }
          break;

        case "toggle-word-wrap": {
          const current = useSettingsStore.getState().wordWrap;
          useSettingsStore.getState().setWordWrap(!current);
          break;
        }

        case "go-to-definition":
          if (activeTabId) {
            window.dispatchEvent(new CustomEvent("file-go-to-definition", { detail: { tabId: activeTabId } }));
          }
          break;

        case "peek-definition":
          if (activeTabId) {
            window.dispatchEvent(new CustomEvent("file-peek-definition", { detail: { tabId: activeTabId } }));
          }
          break;

        case "find-references":
          if (activeTabId) {
            window.dispatchEvent(new CustomEvent("file-find-references", { detail: { tabId: activeTabId } }));
          }
          break;

        case "rename-symbol":
          if (activeTabId) {
            window.dispatchEvent(new CustomEvent("file-rename-symbol", { detail: { tabId: activeTabId } }));
          }
          break;

        case "run-file":
          if (activeTabId) {
            window.dispatchEvent(new CustomEvent("file-run", { detail: { tabId: activeTabId } }));
          }
          break;

        case "terminal-search":
          if (activeTabId) {
            window.dispatchEvent(new CustomEvent("terminal-search", { detail: { sessionId: activeTabId } }));
          }
          break;

        case "voice-input":
          window.dispatchEvent(new CustomEvent("voice-input-toggle"));
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [spawnSession, openFile, killSession]);
}
