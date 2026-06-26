import { type FormEvent, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { v4 as uuidv4 } from "uuid";
import { Tab } from "@aurora/types";

import { useAppBootstrap } from "../hooks/useAppBootstrap";
import { useCommandExecution } from "../hooks/useCommandExecution";
import { useAgentExecution } from "../hooks/useAgentExecution";
import { usePersistUIState } from "../hooks/usePersistUIState";
import { useWindowClamp } from "../hooks/useWindowClamp";
import { useAppShellStore } from "../stores/useAppShellStore";
import { useBlockStore } from "../stores/useBlockStore";
import { useSessionStore } from "../stores/useSessionStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import { TabBar } from "../components/ui/TabBar";
import { SidePanel } from "../components/ui/SidePanel";
import { StatusBar } from "../components/ui/StatusBar";
import { AppHeader } from "../components/layout/AppHeader";
import { AppContextMenu } from "../components/layout/AppContextMenu";
import { AgentOverlay } from "../components/terminal/AgentOverlay";
import { SaveChangesModal } from "../components/layout/SaveChangesModal";
import { CommandInputBar } from "../components/layout/CommandInputBar";
import { TerminalWorkspaceView } from "./TerminalWorkspaceView";
import { FileWorkspaceView } from "./FileWorkspaceView";
import { DiffWorkspaceView } from "../components/editor/DiffWorkspaceView";
import { CommitDiffView } from "../components/editor/CommitDiffView";
import { getDefaultShellLaunch, isWindowsPlatform } from "../lib/shell";
import { classifyInput, setAvailableCommands, type ShellType } from "../lib/nlClassifier";
import { system } from "../lib/ipc";
import { closeAllPopups, onClosePopups } from "../lib/popups";

export function AppShellView() {
  const { tabs, activeTabId, spawnSession, killSession, openFile, setActiveTabId } = useAppBootstrap();
  const { theme, setTheme } = useSettingsStore();
  usePersistUIState();
  useWindowClamp();

  useEffect(() => {
    system.getAvailableCommands().then(setAvailableCommands).catch(() => { });
  }, []);

  const { blocks } = useBlockStore();

  const {
    sidebarCollapsed,
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
    showAiBar,
    setShowAiBar,
    chatInputOpen,
    setChatInputOpen,
    toggleChatInputOpen,
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

  useEffect(() => {
    if (viewMode === "file") {
      useAppShellStore.getState().setSectionVisibility({
        folders: true,
        outline: true,
        timeline: true,
        git: true,
      });
    }
  }, [viewMode]);

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

  const { startTask } = useAgentExecution(targetSessionId);

  const shellType: ShellType = useMemo(() => isWindowsPlatform() ? "powershell" : "bash", []);
  const inputMode = useMemo(() => classifyInput(activeCommandInput, shellType), [activeCommandInput, shellType]);

  const handleInterceptedSubmit = (event: FormEvent, defaultSubmit: (e: FormEvent) => void, isFilePrompt = false) => {
    event.preventDefault();
    const input = activeCommandInput.trim();
    if (!input) return;

    // Explicit prefix overrides take priority over the classifier
    const hasExplicitNL = input.startsWith("? ") || input.startsWith("/ai ");
    const isNlQuery = hasExplicitNL || inputMode === "natural-language" || isFilePrompt;

    if (isNlQuery) {
      const cleanGoal = hasExplicitNL
        ? input.startsWith("? ")
          ? input.slice(2).trim()
          : input.slice(4).trim()
        : input;

      if (!cleanGoal) return;

      setCommandInput("");
      setShowAiBar(true);
      startTask(cleanGoal);
    } else {
      defaultSubmit(event);
    }
  };

  const handleFileCommandSubmit = (event: FormEvent) => {
    event.preventDefault();
  };

  const activeTab = tabs.find((tab) => tab.id === activeTabId) || null;
  const activeFilePath = (activeTab?.type === "file" || activeTab?.type === "diff") ? activeTab.filePath : undefined;
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

  const handleOpenSettings = async () => {
    setShowMenuDropdown(false);
    try {
      const { openSettingsWindow } = await import("../lib/settings");
      await openSettingsWindow();
    } catch (error) {
      console.error("Failed to open settings window:", error);
    }
  };

  useEffect(() => {
    return onClosePopups(() => {
      clearContextMenu();
      setShowMenuDropdown(false);
    });
  }, [clearContextMenu]);

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
      closeAllPopups();
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

  const handleShowAgentView = () => { };

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
        agentOverlayOpen={showAiBar}
        onToggleAgentOverlay={() => {
          const current = useAppShellStore.getState().showAiBar;
          useAppShellStore.getState().setShowAiBar(!current);
        }}
        chatInputOpen={chatInputOpen}
        onToggleChatInput={toggleChatInputOpen}
        menuOpen={showMenuDropdown}
        onToggleMenu={() => { closeAllPopups(); toggleShowMenuDropdown(); }}
        onOpenFolder={handleOpenFolder}
        onOpenFile={handleOpenFile}
        onOpenRecentFile={handleOpenRecentFile}
        onNewWindow={handleNewWindow}
        onNewTab={handleNewTab}
        onCloseSession={handleCloseSession}
        onCloseTab={handleCloseTab}
        onCloseOtherTabs={handleCloseOtherTabs}
        onOpenSettings={() => { closeAllPopups(); handleOpenSettings(); }}
        onToggleTheme={handleToggleTheme}
        onToggleTabBar={toggleTabBarVisible}
        onShowTerminalView={handleShowTerminalView}
        onShowFileView={handleShowFileView}
        onShowAgentView={handleShowAgentView}
        onExit={handleExit}
        theme={theme}
        tabBarVisible={tabBarVisible}
        viewMode={viewMode}
        projectName={cwd.replace(/^~\//, "")}
        cwdAbsolute={cwdAbsolute}
        onOpenFileAtPath={(path: string) => { openFile(path, cwdAbsolute); setViewMode("file"); }}
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
            className={`flex-1 overflow-hidden w-full flex flex-col relative ${(activeTab?.type === "file" || activeTab?.type === "diff" || isAlternateActive) ? "" : "px-3 pt-3"}`} onMouseDown={(event) => {
              const target = event.target as HTMLElement;
              if (target.closest(".xterm")) {
                return;
              }

              if (activeTab?.type === "terminal" && !isCommandRunning && !isAlternateActive) {
                window.dispatchEvent(new CustomEvent("aurora-focus-terminal-input", { detail: { sessionId: activeTabId } }));
              }
            }}
          >
            <div className="flex-1 min-h-0 w-full relative overflow-hidden">
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
                    ) : tab.type === "diff" && tab.diffContent ? (
                      <CommitDiffView
                        diff={tab.diffContent}
                        commitHash={tab.diffCommitHash || ""}
                      />
                    ) : tab.type === "diff" ? (
                      <DiffWorkspaceView
                        filePath={tab.filePath || ""}
                        oldContent={tab.diffOldContent || ""}
                        newContent={tab.diffNewContent || ""}
                        commitHash={tab.diffCommitHash || ""}
                      />
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
          {chatInputOpen && activeTab?.type === "terminal" && !isAlternateActive && (
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
              onSubmit={(e) => handleInterceptedSubmit(e, handleExecuteCommand, false)}
              onStop={handleStopCurrentCommand}
              onOpenAiBar={() => setShowAiBar(true)}
              inputMode={inputMode}
            />
          )}

          {/* File view: prompt variant (absolute, glassmorphism, independent state) */}
          {chatInputOpen && activeTab?.type === "file" && (
            <CommandInputBar
              variant="prompt"
              sessionId={null}
              cwd={cwd}
              isLoading={false}
              isRunning={false}
              value={activeCommandInput}
              history={[]}
              onChange={setCommandInput}
              onSubmit={(e) => handleInterceptedSubmit(e, handleFileCommandSubmit, true)}
              onOpenAiBar={() => setShowAiBar(true)}
              inputMode={inputMode}
            />
          )}
        </main>

        {/* Agent overlay — inside main so it overlays the tab view area */}
        {showAiBar && activeTabId && (
          <AgentOverlay sessionId={activeTabId} onClose={() => setShowAiBar(false)} />
        )}
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

      <AppContextMenu
        contextMenu={contextMenu}
        onPaste={async () => {
          try {
            const text = await navigator.clipboard.readText();
            if (text) {
              if (contextMenu?.source === "file") {
                window.dispatchEvent(new CustomEvent("file-paste", { detail: { text } }));
              } else if (activeTabId) {
                appendCommandInput(activeTabId, text);
              }
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
          } else if (contextMenu?.source === "file") {
            window.dispatchEvent(new CustomEvent("file-copy-line"));
          }
          clearContextMenu();
        }}
        onCutSelection={() => {
          if (contextMenu?.selectedText && contextMenu?.source === "file") {
            navigator.clipboard.writeText(contextMenu.selectedText).catch(console.error);
            window.dispatchEvent(new CustomEvent("file-cut-selection", { detail: { text: contextMenu.selectedText } }));
          } else if (contextMenu?.source === "file") {
            window.dispatchEvent(new CustomEvent("file-cut-line"));
          } else if (contextMenu?.source === "terminal" && activeTabId) {
            window.dispatchEvent(new CustomEvent("terminal-cut", { detail: { sessionId: activeTabId } }));
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
        onGoToDefinition={() => {
          window.dispatchEvent(new CustomEvent("file-go-to-definition", { detail: { tabId: activeTabId, filePath: contextMenu?.filePath, selectedText: contextMenu?.selectedText } }));
          clearContextMenu();
        }}
        onPeekDefinition={() => {
          window.dispatchEvent(new CustomEvent("file-peek-definition", { detail: { tabId: activeTabId, filePath: contextMenu?.filePath, selectedText: contextMenu?.selectedText } }));
          clearContextMenu();
        }}
        onFindReferences={() => {
          window.dispatchEvent(new CustomEvent("file-find-references", { detail: { tabId: activeTabId, filePath: contextMenu?.filePath, selectedText: contextMenu?.selectedText } }));
          clearContextMenu();
        }}
        onRenameSymbol={() => {
          window.dispatchEvent(new CustomEvent("file-rename-symbol", { detail: { tabId: activeTabId, filePath: contextMenu?.filePath, selectedText: contextMenu?.selectedText } }));
          clearContextMenu();
        }}
        onFormatDocument={() => {
          window.dispatchEvent(new CustomEvent("file-format-document", { detail: { tabId: activeTabId, filePath: contextMenu?.filePath } }));
          clearContextMenu();
        }}
        onRunFile={() => {
          window.dispatchEvent(new CustomEvent("file-run", { detail: { tabId: activeTabId, filePath: contextMenu?.filePath } }));
          clearContextMenu();
        }}
      />

      <StatusBar cwd={cwdAbsolute} />
    </div>
  );
}

export default AppShellView;