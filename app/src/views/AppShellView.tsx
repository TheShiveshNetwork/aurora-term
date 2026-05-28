import { type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { v4 as uuidv4 } from "uuid";
import { Tab } from "@aurora/types";

import { useAppBootstrap } from "../hooks/useAppBootstrap";
import { useCommandExecution } from "../hooks/useCommandExecution";
import { usePersistUIState } from "../hooks/usePersistUIState";
import { useAppShellStore } from "../stores/useAppShellStore";
import { useBlockStore } from "../stores/useBlockStore";
import { useSessionStore } from "../stores/useSessionStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import { TabBar } from "../components/ui/TabBar";
import { SidePanel } from "../components/ui/SidePanel";
import { StatusBar } from "../components/ui/StatusBar";
import { SettingsModal } from "../components/settings/SettingsModal";
import { AppHeader } from "../components/layout/AppHeader";
import { AppContextMenu } from "../components/layout/AppContextMenu";
import { SaveChangesModal } from "../components/layout/SaveChangesModal";
import { CommandInputBar } from "../components/layout/CommandInputBar";
import { TerminalWorkspaceView } from "./TerminalWorkspaceView";
import { FileWorkspaceView } from "./FileWorkspaceView";
import { getDefaultShellLaunch } from "../lib/shell";

export function AppShellView() {
  const { tabs, activeTabId, spawnSession, killSession, openFile, setActiveTabId } = useAppBootstrap();
  const { theme, setTheme } = useSettingsStore();
  usePersistUIState();
  const { blocks } = useBlockStore();

  const {
    sidebarCollapsed,
    showSettings,
    showMenuDropdown,
    tabBarVisible,
    viewMode,
    contextMenu,
    pendingCloseTabId,
    lastActiveTerminalId,
    lastActiveFileId,
    cwd,
    cwdAbsolute,
    shellHistory,
    interactedSessions,
    isCwdLoading,
    setShowSettings,
    setShowAiBar,
    setShowMenuDropdown,
    toggleSidebarCollapsed,
    toggleShowMenuDropdown,
    toggleTabBarVisible,
    setViewMode,
    clearContextMenu,
    setPendingCloseTabId,
    setSessionCwd,
    appendCommandInput,
    clearSessionInteracted,
  } = useAppShellStore();

  const {
    activeCommandInput,
    setCommandInput,
    handleExecuteCommand,
    handleStopCurrentCommand,
    isCommandRunning,
    isAlternateActive,
    activeTabBlocks,
    targetSessionId,
  } = useCommandExecution(tabs, activeTabId);

  const handleFileCommandSubmit = (event: FormEvent) => {
    event.preventDefault();
  };

  const activeTab = tabs.find((tab) => tab.id === activeTabId) || null;
  const activeFilePath = activeTab?.type === "file" ? activeTab.filePath : undefined;
  const pendingTab = pendingCloseTabId ? tabs.find((tab) => tab.id === pendingCloseTabId) || null : null;
  const currentTerminalBlocks = targetSessionId ? blocks[targetSessionId] || [] : [];
  const hasInteracted = activeTabId ? Boolean(interactedSessions[activeTabId]) : false;

  const handleSelectFolderDirectly = (path: string) => {
    useAppShellStore.getState().setWorkspaceCwd(path);
    if (activeTabId) {
      setSessionCwd(activeTabId, path);
    }
  };

  const handleOpenFolder = async () => {
    setShowMenuDropdown(false);
    try {
      const selected = await invoke<string | null>("select_folder");
      if (selected) {
        handleSelectFolderDirectly(selected);
      }
    } catch (error) {
      console.error("Failed to select folder:", error);
    }
  };

  const handleOpenFile = async () => {
    setShowMenuDropdown(false);
    try {
      const selected = await invoke<string | null>("select_file");
      if (selected) {
        openFile(selected, cwdAbsolute);
        setViewMode("file");
      }
    } catch (error) {
      console.error("Failed to select file:", error);
    }
  };

  const handleOpenRecentFile = (filePath: string) => {
    setShowMenuDropdown(false);
    invoke("read_dir", { path: cwdAbsolute })
      .then(() => {
        const absolutePath = cwdAbsolute ? `${cwdAbsolute}/${filePath}`.replace(/\/\//g, "/") : filePath;
        openFile(absolutePath, cwdAbsolute);
        setViewMode("file");
      })
      .catch(() => {
        openFile(filePath, cwdAbsolute);
        setViewMode("file");
      });
  };

  const handleNewWindow = async () => {
    setShowMenuDropdown(false);
    try {
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      new WebviewWindow(`aurora_${Date.now()}`, {
        title: "Aurora Terminal",
        width: 1024,
        height: 768,
      });
    } catch (error) {
      console.error("Failed to spawn new window:", error);
    }
  };

  const handleNewTab = async () => {
    setShowMenuDropdown(false);
    const { shell, args } = getDefaultShellLaunch();
    try {
      const sessionId = await spawnSession(shell, args, {}, cwdAbsolute);
      setSessionCwd(sessionId, cwdAbsolute);
    } catch (error) {
      console.error("Failed to spawn session:", error);
    }
  };

  const handleCloseSession = () => {
    setShowMenuDropdown(false);
    if (activeTabId) {
      killSession(activeTabId);
    }
  };

  const handleCloseTab = () => {
    setShowMenuDropdown(false);
    if (!activeTabId) return;

    const tab = tabs.find((candidate) => candidate.id === activeTabId);
    if (tab?.type === "file" && tab.dirty) {
      setPendingCloseTabId(activeTabId);
      return;
    }

    killSession(activeTabId);
  };

  const handleCloseOtherTabs = () => {
    setShowMenuDropdown(false);
    if (!activeTabId) return;

    tabs.forEach((tab) => {
      if (tab.id !== activeTabId) {
        killSession(tab.id);
      }
    });
  };

  const handleToggleTheme = () => {
    setShowMenuDropdown(false);
    setTheme(theme === "dark" ? "light" : "dark");
  };

  const handleExit = () => {
    setShowMenuDropdown(false);
    getCurrentWindow().close();
  };

  const handleShowTerminalView = async () => {
    setViewMode("terminal");
    const hasTerminal = tabs.some((tab) => tab.type === "terminal");

    if (!hasTerminal) {
      const { shell, args } = getDefaultShellLaunch();
      try {
        const sessionId = await spawnSession(shell, args, {}, cwdAbsolute);
        setSessionCwd(sessionId, cwdAbsolute);
      } catch (error) {
        console.error("Failed to spawn session:", error);
      }
      return;
    }

    const targetId = lastActiveTerminalId && tabs.some((tab) => tab.id === lastActiveTerminalId)
      ? lastActiveTerminalId
      : tabs.find((tab) => tab.type === "terminal")?.id;

    if (targetId) {
      setActiveTabId(targetId);
    }
  };

  const handleShowFileView = async () => {
    setViewMode("file");
    const fileTabs = tabs.filter((tab) => tab.type === "file");

    if (fileTabs.length === 0) {
      const welcomeTabId = uuidv4();
      const newTab: Tab = {
        id: welcomeTabId,
        name: "Workspace",
        type: "file",
        filePath: undefined,
        cwd: cwdAbsolute,
        created_at: Date.now(),
      };

      useSessionStore.getState().addTab(newTab);
      setActiveTabId(welcomeTabId);
      return;
    }

    const targetId = lastActiveFileId && tabs.some((tab) => tab.id === lastActiveFileId)
      ? lastActiveFileId
      : tabs.find((tab) => tab.type === "file")?.id;

    if (targetId) {
      setActiveTabId(targetId);
    }
  };

  const handleShowAgentView = () => {};

  const handleDuplicateTab = (tab: Tab) => {
    if (tab.type === "terminal") {
      const { shell, args } = getDefaultShellLaunch();
      spawnSession(shell, args, {}, tab.cwd || cwdAbsolute)
        .then((sessionId) => setSessionCwd(sessionId, tab.cwd || cwdAbsolute))
        .catch(console.error);
      return;
    }

    if (tab.filePath) {
      const fileName = tab.filePath.split(/[/\\]/).pop() || tab.name;
      const newTab: Tab = {
        id: uuidv4(),
        name: fileName,
        type: "file",
        filePath: tab.filePath,
        created_at: Date.now(),
      };
      useSessionStore.getState().addTab(newTab);
      setActiveTabId(newTab.id);
    }
  };

  return (
    <div
      data-tauri-drag-region
      className="bg-background text-on-surface font-body-base overflow-hidden h-screen flex flex-col select-none"
      onContextMenu={(event) => event.preventDefault()}
      onClick={() => {
        clearContextMenu();
        setShowMenuDropdown(false);
      }}
    >
      <AppHeader
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={toggleSidebarCollapsed}
        menuOpen={showMenuDropdown}
        onToggleMenu={toggleShowMenuDropdown}
        onOpenFolder={handleOpenFolder}
        onOpenFile={handleOpenFile}
        onOpenRecentFile={handleOpenRecentFile}
        onNewWindow={handleNewWindow}
        onNewTab={handleNewTab}
        onCloseSession={handleCloseSession}
        onCloseTab={handleCloseTab}
        onCloseOtherTabs={handleCloseOtherTabs}
        onOpenSettings={() => setShowSettings(true)}
        onToggleTheme={handleToggleTheme}
        onToggleTabBar={toggleTabBarVisible}
        onShowTerminalView={handleShowTerminalView}
        onShowFileView={handleShowFileView}
        onShowAgentView={handleShowAgentView}
        onExit={handleExit}
        theme={theme}
        tabBarVisible={tabBarVisible}
        viewMode={viewMode}
      />

      <div className="flex flex-1 overflow-hidden">
        <SidePanel collapsed={sidebarCollapsed} cwd={cwdAbsolute} activeFilePath={activeFilePath} />

        <main className="flex-1 flex flex-col min-w-0 bg-surface-container-low overflow-hidden relative">
          <div className={tabBarVisible ? "" : "hidden"}>
            <TabBar
              viewMode={viewMode}
              onSetViewMode={setViewMode}
              onAddTab={async (type: "terminal" | "file") => {
                if (type === "terminal") {
                  const { shell, args } = getDefaultShellLaunch();
                  try {
                    const sessionId = await spawnSession(shell, args, {}, cwdAbsolute);
                    setSessionCwd(sessionId, cwdAbsolute);
                  } catch (error) {
                    console.error("Failed to spawn session:", error);
                  }
                  return;
                }

                const welcomeTabId = uuidv4();
                const newTab: Tab = {
                  id: welcomeTabId,
                  name: "Workspace",
                  type: "file",
                  filePath: undefined,
                  cwd: cwdAbsolute,
                  created_at: Date.now(),
                };
                useSessionStore.getState().addTab(newTab);
                setActiveTabId(welcomeTabId);
                setViewMode("file");
              }}
              onKillTab={(id) => {
                const tab = tabs.find((candidate) => candidate.id === id);
                if (tab?.type === "file" && tab.dirty) {
                  setPendingCloseTabId(id);
                  return;
                }

                killSession(id);
              }}
              onDuplicateTab={handleDuplicateTab}
            />
          </div>

          <div
            className={`flex-1 overflow-hidden w-full flex flex-col relative ${(activeTab?.type === "file" || isAlternateActive) ? "" : "px-3 pt-3"}`}
            onMouseDown={(event) => {
              const target = event.target as HTMLElement;
              if (target.closest(".xterm")) {
                return;
              }

              if (activeTab?.type === "terminal" && !isCommandRunning && !isAlternateActive) {
                window.dispatchEvent(new CustomEvent("aurora-focus-terminal-input", { detail: { sessionId: activeTabId } }));
              }
            }}
          >
            <div className="flex-1 min-h-0 w-full relative">
              {tabs.map((tab) => {
                const isTabActive = tab.id === activeTabId;

                return (
                  <div
                    key={tab.id}
                    className="absolute inset-0"
                    style={{
                      visibility: isTabActive ? "visible" : "hidden",
                      pointerEvents: isTabActive ? "auto" : "none",
                      zIndex: isTabActive ? 10 : 0,
                    }}
                  >
                    {tab.type === "file" ? (
                      <FileWorkspaceView tab={tab} onOpenFile={handleOpenFile} onOpenFolder={handleOpenFolder} />
                    ) : (
                      <TerminalWorkspaceView
                        tab={tab}
                        isVisible={isTabActive}
                        isCommandRunning={isTabActive ? isCommandRunning : undefined}
                        isAlternateActive={isAlternateActive}
                        hasInteracted={hasInteracted}
                        activeBlocksCount={tab.id === targetSessionId ? currentTerminalBlocks.length : 0}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Terminal view: command variant (default) */}
          {activeTab?.type === "terminal" && !isAlternateActive && (
            <CommandInputBar
              sessionId={targetSessionId}
              cwd={cwd}
              isLoading={isCwdLoading}
              isRunning={isCommandRunning}
              value={activeCommandInput}
              history={[
                ...activeTabBlocks.filter((block) => block.command && block.command !== "init-aurora").map((block) => block.command as string),
                ...shellHistory.slice().reverse(),
              ]}
              onChange={setCommandInput}
              onSubmit={handleExecuteCommand}
              onStop={handleStopCurrentCommand}
              onOpenAiBar={() => setShowAiBar(true)}
            />
          )}

          {/* File view: prompt variant (absolute, glassmorphism, independent state) */}
          {activeTab?.type === "file" && (
            <CommandInputBar
              variant="prompt"
              sessionId={null}
              cwd={cwd}
              isLoading={false}
              isRunning={false}
              value={activeCommandInput}
              history={[]}
              onChange={setCommandInput}
              onSubmit={handleFileCommandSubmit}
              onOpenAiBar={() => setShowAiBar(true)}
            />
          )}
        </main>
      </div>

      <SaveChangesModal
        tab={pendingTab}
        onDiscard={() => {
          if (pendingCloseTabId) {
            killSession(pendingCloseTabId);
          }
          setPendingCloseTabId(null);
        }}
        onCancel={() => setPendingCloseTabId(null)}
        onSave={async () => {
          if (pendingCloseTabId) {
            const tab = useSessionStore.getState().tabs.find((candidate) => candidate.id === pendingCloseTabId);
            if (tab?.fileContent && tab.filePath) {
              try {
                await invoke("write_file_content", { path: tab.filePath, content: tab.fileContent });
              } catch (error) {
                console.error("Failed to save file:", error);
              }
            }
            killSession(pendingCloseTabId);
          }
          setPendingCloseTabId(null);
        }}
      />

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}

      <AppContextMenu
        contextMenu={contextMenu}
        onPaste={async () => {
          try {
            const text = await navigator.clipboard.readText();
            if (text && activeTabId) {
              appendCommandInput(activeTabId, text);
            }
          } catch (error) {
            console.error("Failed to read from clipboard:", error);
          }
          clearContextMenu();
        }}
        onCopySelection={() => {
          if (contextMenu?.selectedText) {
            navigator.clipboard.writeText(contextMenu.selectedText).catch(console.error);
          } else if (contextMenu?.source === "terminal") {
            window.dispatchEvent(new CustomEvent("terminal-copy", { detail: { sessionId: activeTabId } }));
          }
          clearContextMenu();
        }}
        onClearTerminal={() => {
          if (activeTabId) {
            window.dispatchEvent(new CustomEvent("terminal-clear", { detail: { sessionId: activeTabId } }));
            useBlockStore.getState().clearBlocks(activeTabId);
            clearSessionInteracted(activeTabId);
          }
          clearContextMenu();
        }}
        onSelectAll={() => {
          if (activeTabId) {
            window.dispatchEvent(new CustomEvent("file-select-all", { detail: { tabId: activeTabId } }));
          }
          clearContextMenu();
        }}
      />

      <StatusBar cwd={cwdAbsolute} />
    </div>
  );
}

export default AppShellView;