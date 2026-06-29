import { useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { useAICompletion } from "./useAICompletion";
import { usePTY } from "./usePTY";
import { pty, config, state, system, ai as aiIpc, preloadFileContent, AppConfig } from "../lib/ipc";
import { getDefaultShellLaunch } from "../lib/shell";
import { closeAllPopups } from "../lib/popups";
import { useAppShellStore } from "../stores/useAppShellStore";
import { useSessionStore } from "../stores/useSessionStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import { useAIStore } from "../stores/useAIStore";
import { ProviderName, Tab, TabType } from "@aurora/types";

export function applyAppConfig(cfg: AppConfig) {
  // ── Hydrate settings stores from config ──
  const settings = useSettingsStore.getState();

  // Terminal settings
  settings.setFontFamily(cfg.terminal.font_family);
  settings.setFontSize(cfg.terminal.font_size);
  settings.setCursorStyle(cfg.terminal.cursor_style as "block" | "underline" | "bar");
  settings.setCursorBlink(cfg.terminal.cursor_blink);
  settings.setRestoreTabs(cfg.terminal.restore_tabs !== false);

  // Theme
  if (cfg.terminal.theme === "light" || cfg.terminal.theme === "dark") {
    settings.setTheme(cfg.terminal.theme);
  }

  // Appearance
  settings.setCompactUi(cfg.appearance.compact_ui);
  settings.setShowStatusbar(cfg.appearance.show_statusbar);
  settings.setBlurSidebar(cfg.appearance.blur_sidebar);

  // Editor
  settings.setEditorTheme(cfg.editor.theme as any);
  settings.setShowMinimap(cfg.editor.show_minimap);
  settings.setGitGuiMode(cfg.editor.git_gui_mode as "tab" | "window");

  // Keybindings
  const overrides: Record<string, string> = {};
  if (cfg.keybindings.mode === "vim") {
    // Only set non-default overrides
    if (cfg.keybindings.open_palette !== "ctrl+p")
      overrides["command-palette"] = cfg.keybindings.open_palette;
    if (cfg.keybindings.open_ai_bar !== "ctrl+k")
      overrides["toggle-ai-bar"] = cfg.keybindings.open_ai_bar;
    if (cfg.keybindings.new_tab !== "ctrl+t")
      overrides["new-tab"] = cfg.keybindings.new_tab;
    if (cfg.keybindings.close_tab !== "ctrl+w")
      overrides["close-tab"] = cfg.keybindings.close_tab;
    if (cfg.keybindings.split_h !== "ctrl+shift+d")
      overrides["split-horizontal"] = cfg.keybindings.split_h;
    if (cfg.keybindings.split_v !== "ctrl+shift+e")
      overrides["split-vertical"] = cfg.keybindings.split_v;
  }
  // Apply any user-defined overrides from the config
  for (const [id, keys] of Object.entries(cfg.keybindings.overrides)) {
    overrides[id] = keys;
  }
  useSettingsStore.setState({ keybindingOverrides: overrides });

  // AI provider config
  const ai = useAIStore.getState();
  ai.setActiveProvider(cfg.ai.active_provider as ProviderName);
  const providerMap: Record<string, ProviderName> = {
    anthropic: "anthropic", openai: "openai", gemini: "gemini",
    nvidia: "nvidia", ollama: "ollama", groq: "groq",
  };
  for (const [key, name] of Object.entries(providerMap)) {
    const p = (cfg.ai as any)[key];
    if (p) {
      ai.updateProviderConfig(name, {
        enabled: p.enabled,
        fastModel: p.fast_model,
        balancedModel: p.balanced_model,
        powerfulModel: p.powerful_model,
        baseUrl: p.base_url ?? undefined,
      });
    }
  }

  // Refresh provider API key status
  aiIpc.getProviderStatus().catch(() => {});
}

export function useAppBootstrap() {
  useAICompletion();

  const { tabs, activeTabId, spawnSession, killSession, openFile, setActiveTabId } = usePTY();
  const theme = useSettingsStore((state) => state.theme);

  const hasSpawnedRef = useRef(false);
  const hasHadTabsRef = useRef(false);
  const activeTabIdRef = useRef<string | null>(activeTabId);
  activeTabIdRef.current = activeTabId;
  const prevActiveTabIdRef = useRef<string | null>(null);
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

    const prevActiveTabId = prevActiveTabIdRef.current;
    prevActiveTabIdRef.current = activeTabId;

    const currentViewMode = useAppShellStore.getState().viewMode;
    if (currentViewMode !== "agent" || activeTabId !== prevActiveTabId) {
      useAppShellStore.getState().setViewMode(activeTab.type === "terminal" ? "terminal" : "file");
    }
  }, [activeTabId, tabs]);

  useEffect(() => {
    if (hasSpawnedRef.current) return;
    hasSpawnedRef.current = true;

    system.readShellHistory()
      .then((history) => useAppShellStore.getState().setShellHistory(history))
      .catch(() => {});

    // Load merged config + UI state in parallel with a timeout
    // so a hung command never leaves bootstrapReady=false permanently.
    const bootstrapTimeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Bootstrap timeout")), 8000)
    );

    Promise.race([
      Promise.all([
        config.get(),
        state.get(),
      ]),
      bootstrapTimeout,
    ])
      .then(async ([cfg, uiState]) => {
        applyAppConfig(cfg);

        // ── Hydrate UI state from state.json ──
        if (uiState) {
          useAppShellStore.getState().setSidebarCollapsed(uiState.sidebar_collapsed);
          useAppShellStore.getState().setTabBarVisible(uiState.tab_bar_visible);

          if (uiState.section_visibility) {
            useAppShellStore.getState().setSectionVisibility(uiState.section_visibility as any);
          }

          // Restore project dir
          const isMainWindow = getCurrentWindow().label === "main";
          if (isMainWindow && uiState.last_project_dir) {
            useAppShellStore.getState().setProjectDir(uiState.last_project_dir);
          }

          // Restore workspace cwd
          const initialCwd = (isMainWindow && uiState.last_workspace_cwd) || "";
          if (initialCwd) {
            useAppShellStore.getState().setWorkspaceCwd(initialCwd);
          } else {
            try {
              const cwd = await system.getCwd();
              useAppShellStore.getState().setWorkspaceCwd(cwd);
            } catch {
              useAppShellStore.getState().setWorkspaceCwd("");
            }
          }

          // Restore open tabs from state
          const store = useSessionStore.getState();
          const shouldRestoreTabs = isMainWindow && cfg.terminal.restore_tabs !== false;
          let restoredTabs: Tab[] = [];
          if (shouldRestoreTabs && uiState.open_tabs && uiState.open_tabs.length > 0) {
            restoredTabs = uiState.open_tabs
              .filter((t) => t.tab_type !== "terminal") // Only restore files/editor tabs, not terminals
              .map((t) => ({
                id: t.id,
                name: t.title,
                type: t.tab_type as TabType,
                shell: t.shell || undefined,
                cwd: t.cwd || undefined,
                filePath: t.file_path || undefined,
                pinned: !!t.pinned || uiState.pinned_tabs.includes(t.id),
                created_at: Date.now(),
              }));
          }

          if (restoredTabs.length > 0) {
            store.setTabs(restoredTabs);

            // Preload file contents
            for (const t of restoredTabs) {
              if (t.type === "file" && t.filePath) {
                preloadFileContent(t.filePath);
              }
            }

            if (uiState.active_tab_id && restoredTabs.some((t) => t.id === uiState.active_tab_id)) {
              store.setActiveTabId(uiState.active_tab_id);
            } else {
              store.setActiveTabId(restoredTabs[0].id);
            }
          } else {
            // Spawn a default terminal tab instead of restoring (fire-and-forget)
            if (isMainWindow) {
              const { shell, args } = getDefaultShellLaunch();
              const initialCwd = uiState.last_workspace_cwd || useAppShellStore.getState().cwdAbsolute || "";
              spawnSession(shell, args, {}, initialCwd).catch(console.error);
            }
          }
        }
        useAppShellStore.getState().setBootstrapReady(true);
        // Fetch CWD in the background after marking ready so it can't block UI
        if (!uiState?.last_workspace_cwd) {
          system.getCwd()
            .then((cwd) => useAppShellStore.getState().setWorkspaceCwd(cwd))
            .catch(() => {});
        }
      })
      .catch(() => {
        // Fallback: try to get CWD at least (fire-and-forget)
        system.getCwd()
          .then((cwd) => useAppShellStore.getState().setWorkspaceCwd(cwd))
          .catch(() => useAppShellStore.getState().setWorkspaceCwd(""));

        // Spawn a default terminal tab as fallback (fire-and-forget)
        const isMainWindow = getCurrentWindow().label === "main";
        if (isMainWindow) {
          const { shell, args } = getDefaultShellLaunch();
          spawnSession(shell, args, {}, "").catch(console.error);
        }

        useAppShellStore.getState().setBootstrapReady(true);
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

    let unlistenConfig: (() => void) | null = null;
    getCurrentWindow().listen<AppConfig>("config_changed", (event) => {
      applyAppConfig(event.payload);
    }).then((u) => {
      unlistenConfig = u;
    });

    let unlistenUiState: (() => void) | null = null;
    getCurrentWindow().listen<{
      sidebarCollapsed: boolean;
      showAiBar: boolean;
      chatInputOpen: boolean;
      tabBarVisible: boolean;
    }>("ui_state_changed", (event) => {
      const { sidebarCollapsed, showAiBar, chatInputOpen, tabBarVisible } = event.payload;
      const shell = useAppShellStore.getState();
      shell.setSidebarCollapsed(sidebarCollapsed);
      shell.setShowAiBar(showAiBar);
      shell.setChatInputOpen(chatInputOpen);
      shell.setTabBarVisible(tabBarVisible);
    }).then((u) => {
      unlistenUiState = u;
    });

    return () => {
      if (unlistenConfig) unlistenConfig();
      if (unlistenUiState) unlistenUiState();
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

      const projectDir = useAppShellStore.getState().projectDir;
      const cwdAbsolute = useAppShellStore.getState().cwdAbsolute;
      openFileRef.current(path, projectDir || cwdAbsolute);
      useAppShellStore.getState().setViewMode("file");
    };

    window.addEventListener("sidebar-open-file", handleOpenFile);
    window.addEventListener("sidebar-open-file-current-tab", handleOpenFile);

    return () => {
      window.removeEventListener("sidebar-open-file", handleOpenFile);
      window.removeEventListener("sidebar-open-file-current-tab", handleOpenFile);
    };
  }, []);

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
