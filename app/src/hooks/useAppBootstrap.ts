import { useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { useAICompletion } from "./useAICompletion";
import { usePTY } from "./usePTY";
import { pty, config, system } from "../lib/ipc";
import { getDefaultShellLaunch } from "../lib/shell";
import { closeAllPopups } from "../lib/popups";
import { useAppShellStore } from "../stores/useAppShellStore";
import { useSessionStore } from "../stores/useSessionStore";
import { useSettingsStore } from "../stores/useSettingsStore";

export function useAppBootstrap() {
  useAICompletion();

  const { tabs, activeTabId, spawnSession, killSession, openFile, setActiveTabId } = usePTY();
  const theme = useSettingsStore((state) => state.theme);
  const cwdAbsolute = useAppShellStore((state) => state.cwdAbsolute);
  const sessionCwds = useAppShellStore((state) => state.sessionCwds);

  const hasSpawnedRef = useRef(false);
  const hasHadTabsRef = useRef(false);
  const activeTabIdRef = useRef<string | null>(activeTabId);
  activeTabIdRef.current = activeTabId;
  const openFileRef = useRef(openFile);
  openFileRef.current = openFile;

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (!activeTabId) return;

    const activeTab = tabs.find((tab) => tab.id === activeTabId);
    if (!activeTab) return;

    if (activeTab.type === "terminal") {
      useAppShellStore.getState().setLastActiveTerminalId(activeTab.id);
    } else {
      useAppShellStore.getState().setLastActiveFileId(activeTab.id);
    }

    useAppShellStore.getState().setViewMode(activeTab.type === "terminal" ? "terminal" : "file");
  }, [activeTabId, tabs]);

  useEffect(() => {
    if (!activeTabId) return;

    const activeTab = tabs.find((tab) => tab.id === activeTabId);
    const currentPath = activeTab?.type === "file"
      ? activeTab.cwd
      : sessionCwds[activeTabId];

    if (!currentPath) return;

    useAppShellStore.getState().setWorkspaceCwd(currentPath);
  }, [activeTabId, sessionCwds, tabs]);

  useEffect(() => {
    if (hasSpawnedRef.current) return;
    hasSpawnedRef.current = true;

    // Signal the app shell is ready to render immediately
    useAppShellStore.getState().setBootstrapReady(true);

    system.readShellHistory()
      .then((history) => useAppShellStore.getState().setShellHistory(history))
      .catch(() => {});

    config.get()
      .then(async (cfg) => {
        let initialCwd = "";
        if (cfg?.ui) {
          useAppShellStore.getState().setSidebarCollapsed(cfg.ui.sidebar_collapsed);
          useAppShellStore.getState().setTabBarVisible(cfg.ui.tab_bar_visible);
          const store = useSessionStore.getState();
          for (const tab of store.tabs) {
            if (cfg.ui.pinned_tabs.includes(tab.id)) {
              store.updateTab(tab.id, { pinned: true });
            }
          }
          if (cfg.ui.workspace_cwd) {
            initialCwd = cfg.ui.workspace_cwd;
          }
        }

        if (!initialCwd) {
          try {
            initialCwd = await system.getCwd();
          } catch {
            initialCwd = "";
          }
        }

        useAppShellStore.getState().setWorkspaceCwd(initialCwd);
      })
      .catch(async () => {
        let initialCwd = "";
        try {
          initialCwd = await system.getCwd();
        } catch {
          initialCwd = "";
        }
        useAppShellStore.getState().setWorkspaceCwd(initialCwd);
      });

    const handleToggleCommandPalette = () => {
      window.dispatchEvent(new CustomEvent("focus-search-bar"));
    };

    const handleToggleAiBar = () => {
      const current = useAppShellStore.getState().showAiBar;
      useAppShellStore.getState().setShowAiBar(!current);
    };

    window.addEventListener("toggle-command-palette", handleToggleCommandPalette);
    window.addEventListener("toggle-ai-bar", handleToggleAiBar);

    return () => {
      window.removeEventListener("toggle-command-palette", handleToggleCommandPalette);
      window.removeEventListener("toggle-ai-bar", handleToggleAiBar);
    };
  }, []);

  useEffect(() => {
    const handleSessionRestart = (event: Event) => {
      const { sessionId } = (event as CustomEvent<{ sessionId: string }>).detail;
      useAppShellStore.getState().clearSessionInteracted(sessionId);
    };

    window.addEventListener("terminal-session-restart", handleSessionRestart as EventListener);
    return () => window.removeEventListener("terminal-session-restart", handleSessionRestart as EventListener);
  }, []);

  useEffect(() => {
    const handleOpenFile = (event: Event) => {
      const { path } = (event as CustomEvent<{ path: string }>).detail;
      if (!path) return;

      openFileRef.current(path, cwdAbsolute);
      useAppShellStore.getState().setViewMode("file");
    };

    window.addEventListener("sidebar-open-file", handleOpenFile);
    window.addEventListener("sidebar-open-file-current-tab", handleOpenFile);

    return () => {
      window.removeEventListener("sidebar-open-file", handleOpenFile);
      window.removeEventListener("sidebar-open-file-current-tab", handleOpenFile);
    };
  }, [cwdAbsolute]);

  useEffect(() => {
    const handleContextMenu = (event: Event) => {
      const { x, y, selectedText, source, filePath } = (event as CustomEvent<{ x: number; y: number; selectedText?: string; source?: "terminal" | "input" | "file"; filePath?: string }>).detail;
      closeAllPopups();
      useAppShellStore.getState().setContextMenu({ x, y, selectedText, source, filePath });
    };

    const clearContextMenu = () => useAppShellStore.getState().clearContextMenu();

    window.addEventListener("show-context-menu", handleContextMenu);
    window.addEventListener("aurora-right-click-menu-close", clearContextMenu);
    window.addEventListener("click", clearContextMenu);

    return () => {
      window.removeEventListener("show-context-menu", handleContextMenu);
      window.removeEventListener("aurora-right-click-menu-close", clearContextMenu);
      window.removeEventListener("click", clearContextMenu);
    };
  }, []);

  useEffect(() => {
    const handleOpenInNewTab = (event: Event) => {
      const { path } = (event as CustomEvent<{ path: string }>).detail;
      if (!path) return;

      const activeShell = tabs.find((tab) => tab.id === activeTabId)?.shell || getDefaultShellLaunch().shell;
      const args = activeShell.includes("powershell") ? ["-NoLogo", "-NoExit"] : [];
      spawnSession(activeShell, args, {}, path).catch(console.error);
    };

    window.addEventListener("sidebar-open-in-new-tab", handleOpenInNewTab);
    return () => window.removeEventListener("sidebar-open-in-new-tab", handleOpenInNewTab);
  }, [activeTabId, spawnSession, tabs]);

  useEffect(() => {
    const handleOpenInTerminal = (event: Event) => {
      const { path } = (event as CustomEvent<{ path: string }>).detail;
      const tabId = activeTabIdRef.current;
      if (!path || !tabId) return;

      const isWin = window.navigator.userAgent.includes("Windows");
      const cdCmd = isWin ? `Set-Location "${path}"` : `cd "${path}"`;
      pty.write(tabId, `${cdCmd}\r`).catch(console.error);
    };

    window.addEventListener("sidebar-open-in-terminal", handleOpenInTerminal);
    return () => window.removeEventListener("sidebar-open-in-terminal", handleOpenInTerminal);
  }, []);

  useEffect(() => {
    if (tabs.length > 0) {
      hasHadTabsRef.current = true;
      return;
    }

    if (hasHadTabsRef.current) {
      getCurrentWindow().close();
    }
  }, [tabs.length]);

  useEffect(() => {
    const handleCwdChange = (event: Event) => {
      const { path, sessionId } = (event as CustomEvent<{ path: string; sessionId: string }>).detail;
      if (!path || !sessionId) return;

      useAppShellStore.getState().setSessionCwd(sessionId, path);
      if (sessionId === activeTabId) {
        useAppShellStore.getState().setIsCwdLoading(false);
      }

      if (sessionId === activeTabId) {
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent("aurora-focus-terminal-input", { detail: { sessionId } }));
        }, 50);
      }
    };

    window.addEventListener("cwd-change", handleCwdChange);
    return () => window.removeEventListener("cwd-change", handleCwdChange);
  }, [activeTabId]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("aurora-focus-terminal-input"));
  }, [activeTabId]);

  return {
    tabs,
    activeTabId,
    spawnSession,
    killSession,
    openFile,
    setActiveTabId,
  };
}