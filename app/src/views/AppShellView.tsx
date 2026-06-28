import { type FormEvent, lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
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
import { NewWindowView } from "./NewWindowView";
import { getDefaultShellLaunch, isWindowsPlatform } from "../lib/shell";
import { classifyInput, setAvailableCommands, type ShellType } from "../lib/nlClassifier";
import { system } from "../lib/ipc";
import { closeAllPopups, onClosePopups } from "../lib/popups";

const FileWorkspaceView = lazy(() => import("./FileWorkspaceView").then(m => ({ default: m.FileWorkspaceView })));
const AgentView = lazy(() => import("./AgentView").then(m => ({ default: m.AgentView })));
const DiffWorkspaceView = lazy(() => import("../components/editor/DiffWorkspaceView").then(m => ({ default: m.DiffWorkspaceView })));
const CommitDiffView = lazy(() => import("../components/editor/CommitDiffView").then(m => ({ default: m.CommitDiffView })));
const GitView = lazy(() => import("../components/git/GitView").then(m => ({ default: m.GitView })));

export function AppShellView() {
  const { tabs, activeTabId, spawnSession, killSession, openFile, setActiveTabId } = useAppBootstrap();
  const theme = useSettingsStore((state) => state.theme);
  const setTheme = useSettingsStore((state) => state.setTheme);
  usePersistUIState();
  useWindowClamp();

  const [visitedTabIds, setVisitedTabIds] = useState<string[]>([]);
  useEffect(() => {
    if (activeTabId && !visitedTabIds.includes(activeTabId)) {
      setVisitedTabIds((prev) => [...prev, activeTabId]);
    }
  }, [activeTabId, visitedTabIds]);

  useEffect(() => {
    system.getAvailableCommands().then(setAvailableCommands).catch(() => { });
  }, []);

  const {
    sidebarCollapsed,
    showMenuDropdown,
    tabBarVisible,
    viewMode,
    contextMenu,
    pendingCloseTabId,
    lastActiveTerminalId,
    lastActiveFileId,
    projectDir,
    projectDirLabel,
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
  } = useAppShellStore(
    useShallow((s) => ({
      sidebarCollapsed: s.sidebarCollapsed,
      showMenuDropdown: s.showMenuDropdown,
      tabBarVisible: s.tabBarVisible,
      viewMode: s.viewMode,
      contextMenu: s.contextMenu,
      pendingCloseTabId: s.pendingCloseTabId,
      lastActiveTerminalId: s.lastActiveTerminalId,
      lastActiveFileId: s.lastActiveFileId,
      projectDir: s.projectDir,
      projectDirLabel: s.projectDirLabel,
      cwd: s.cwd,
      cwdAbsolute: s.cwdAbsolute,
      shellHistory: s.shellHistory,
      interactedSessions: s.interactedSessions,
      isCwdLoading: s.isCwdLoading,
      showAiBar: s.showAiBar,
      chatInputOpen: s.chatInputOpen,
      setShowAiBar: s.setShowAiBar,
      setChatInputOpen: s.setChatInputOpen,
      toggleChatInputOpen: s.toggleChatInputOpen,
      setShowMenuDropdown: s.setShowMenuDropdown,
      toggleSidebarCollapsed: s.toggleSidebarCollapsed,
      toggleShowMenuDropdown: s.toggleShowMenuDropdown,
      toggleTabBarVisible: s.toggleTabBarVisible,
      setViewMode: s.setViewMode,
      clearContextMenu: s.clearContextMenu,
      setPendingCloseTabId: s.setPendingCloseTabId,
      setSessionCwd: s.setSessionCwd,
      appendCommandInput: s.appendCommandInput,
      clearSessionInteracted: s.clearSessionInteracted,
    }))
  );

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
  const isStandaloneView = activeTab?.type === "file" || activeTab?.type === "diff" || activeTab?.type === "git";
  const activeFilePath = (activeTab?.type === "file" || activeTab?.type === "diff") ? activeTab.filePath : undefined;
  const pendingTab = pendingCloseTabId ? tabs.find((tab) => tab.id === pendingCloseTabId) || null : null;
  const hasInteracted = activeTabId ? Boolean(interactedSessions[activeTabId]) : false;

  const handleSelectFolderDirectly = (path: string) => {
    useAppShellStore.getState().setProjectDir(path);
    useAppShellStore.getState().setWorkspaceCwd(path);
    if (activeTabId) {
      setSessionCwd(activeTabId, path);
    } else {
      const { shell, args } = getDefaultShellLaunch();
      spawnSession(shell, args, {}, path).catch(console.error);
    }
  };

  const handleOpenFolder = async () => {
    setShowMenuDropdown(false);
    try {
      const selected = await system.selectFolder();
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
      const selected = await system.selectFile();
      if (selected) {
        openFile(selected, projectDir || cwdAbsolute);
        setViewMode("file");
      }
    } catch (error) {
      console.error("Failed to select file:", error);
    }
  };

  const handleOpenRecentFile = (filePath: string) => {
    setShowMenuDropdown(false);
    const baseCwd = projectDir || cwdAbsolute;
    system.readDir(baseCwd)
      .then(() => {
        const absolutePath = baseCwd ? `${baseCwd}/${filePath}`.replace(/\/\//g, "/") : filePath;
        openFile(absolutePath, baseCwd);
        setViewMode("file");
      })
      .catch(() => {
        openFile(filePath, baseCwd);
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
        minWidth: 800,
        minHeight: 500,
        decorations: false,
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
    const spawnCwd = projectDir || cwdAbsolute;
    try {
      const sessionId = await spawnSession(shell, args, {}, spawnCwd);
      setSessionCwd(sessionId, spawnCwd);
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
    useAppShellStore.getState().setSidebarCollapsed(false);
    useAppShellStore.getState().setChatInputOpen(true);
    const hasTerminal = tabs.some((tab) => tab.type === "terminal");

    if (!hasTerminal) {
      const { shell, args } = getDefaultShellLaunch();
      const spawnCwd = projectDir || cwdAbsolute;
      try {
        const sessionId = await spawnSession(shell, args, {}, spawnCwd);
        setSessionCwd(sessionId, spawnCwd);
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
    useAppShellStore.getState().setSidebarCollapsed(false);
    useAppShellStore.getState().setChatInputOpen(true);
    const fileTabs = tabs.filter((tab) => tab.type === "file");

    if (fileTabs.length === 0) {
      const welcomeTabId = uuidv4();
      const fileCwd = projectDir || cwdAbsolute;
      const newTab: Tab = {
        id: welcomeTabId,
        name: "Workspace",
        type: "file",
        filePath: undefined,
        cwd: fileCwd,
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

  const handleShowAgentView = () => {
    setViewMode("agent");
    useAppShellStore.getState().setSidebarCollapsed(true);
    useAppShellStore.getState().setShowAiBar(false);
    useAppShellStore.getState().setChatInputOpen(false);
  };

  const handleOpenGitView = () => {
    const existing = tabs.find(t => t.type === "git");
    if (existing) {
      setActiveTabId(existing.id);
      setViewMode("file");
      return;
    }
    const id = uuidv4();
    useSessionStore.getState().addTab({
      id,
      name: "Git",
      type: "git" as const,
      cwd: projectDir || cwdAbsolute,
      created_at: Date.now(),
    });
    useSessionStore.getState().setActiveTabId(id);
    setViewMode("file");
  };

  const handleDuplicateTab = (tab: Tab) => {
    if (tab.type === "terminal") {
      const { shell, args } = getDefaultShellLaunch();
      const dupCwd = projectDir || cwdAbsolute;
      spawnSession(shell, args, {}, dupCwd)
        .then((sessionId) => setSessionCwd(sessionId, dupCwd))
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

  const isStandalone = useMemo(() => document.title.includes("Terminal"), []);
  const gitViewActive = tabs.some(t => t.type === "git" && t.id === activeTabId);

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
        isStandalone={isStandalone}
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
        projectName={projectDirLabel.replace(/^~\//, "")}
        cwdAbsolute={projectDir || cwdAbsolute}
        onOpenFileAtPath={(path: string) => { openFile(path, projectDir || cwdAbsolute); setViewMode("file"); }}
        onOpenGitView={handleOpenGitView}
        gitViewActive={gitViewActive}
        noFolder={tabs.length === 0}
      />

      {tabs.length === 0 ? (
        <NewWindowView onOpenFolder={handleOpenFolder} />
      ) : (
        <div className="flex flex-1 overflow-hidden">
          <SidePanel collapsed={sidebarCollapsed} cwd={projectDir || cwdAbsolute} activeFilePath={activeFilePath}
            onKillTab={(id) => {
              const tab = tabs.find((candidate) => candidate.id === id);
              if (tab?.type === "file" && tab.dirty) {
                setPendingCloseTabId(id);
                return;
              }
              killSession(id);
            }}
            onAddTab={async (type: "terminal" | "file") => {
              const baseCwd = projectDir || cwdAbsolute;
              if (type === "terminal") {
                const { shell, args } = getDefaultShellLaunch();
                try {
                  const sessionId = await spawnSession(shell, args, {}, baseCwd);
                  setSessionCwd(sessionId, baseCwd);
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
                cwd: baseCwd,
                created_at: Date.now(),
              };
              useSessionStore.getState().addTab(newTab);
              setActiveTabId(welcomeTabId);
              setViewMode("file");
            }}
          />

          <main className="flex-1 flex flex-col min-w-0 bg-surface-container-low overflow-hidden relative">
            {viewMode === "agent" ? (
              <div className="flex-1 min-h-0 overflow-hidden">
                <Suspense fallback={<div className="flex-1 flex items-center justify-center h-full"><span className="text-sm text-on-surface-variant">Loading...</span></div>}>
                  <AgentView />
                </Suspense>
              </div>
            ) : (
              <>
                {!isStandalone && (
                  <div className={tabBarVisible ? "" : "hidden"}>
                    <TabBar
                      viewMode={viewMode}
                      onSetViewMode={setViewMode}
                      onAddTab={async (type: "terminal" | "file") => {
                        const baseCwd = projectDir || cwdAbsolute;
                        if (type === "terminal") {
                          const { shell, args } = getDefaultShellLaunch();
                          try {
                            const sessionId = await spawnSession(shell, args, {}, baseCwd);
                            setSessionCwd(sessionId, baseCwd);
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
                          cwd: baseCwd,
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
                )}

                <div
                  className={`flex-1 overflow-hidden w-full flex flex-col relative ${(isStandaloneView || isAlternateActive) ? "" : "px-3 pt-3"}`} onMouseDown={(event) => {
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
                      const isVisited = visitedTabIds.includes(tab.id) || isTabActive;

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
                          {isVisited ? (
                            tab.type === "file" ? (
                              <Suspense fallback={<div className="flex-1 flex items-center justify-center h-full"><span className="text-sm text-on-surface-variant">Loading editor...</span></div>}>
                                <FileWorkspaceView tab={tab} onOpenFile={handleOpenFile} onOpenFolder={handleOpenFolder} />
                              </Suspense>
                            ) : tab.type === "diff" && tab.diffContent ? (
                              <Suspense fallback={<div className="flex-1 flex items-center justify-center h-full"><span className="text-sm text-on-surface-variant">Loading diff...</span></div>}>
                                <CommitDiffView
                                  diff={tab.diffContent}
                                  commitHash={tab.diffCommitHash || ""}
                                  collapsible={true}
                                />
                              </Suspense>
                            ) : tab.type === "diff" ? (
                              <Suspense fallback={<div className="flex-1 flex items-center justify-center h-full"><span className="text-sm text-on-surface-variant">Loading diff...</span></div>}>
                                <DiffWorkspaceView
                                  filePath={tab.filePath || ""}
                                  oldContent={tab.diffOldContent || ""}
                                  newContent={tab.diffNewContent || ""}
                                  commitHash={tab.diffCommitHash || ""}
                                />
                              </Suspense>
                            ) : tab.type === "git" ? (
                              <Suspense fallback={<div className="flex-1 flex items-center justify-center h-full"><span className="text-sm text-on-surface-variant">Loading git view...</span></div>}>
                                <GitView cwd={projectDir || cwdAbsolute} tabId={tab.id} />
                              </Suspense>
                            ) : (
                              <TerminalWorkspaceView
                                tab={tab}
                                isVisible={isTabActive}
                                isCommandRunning={isTabActive ? isCommandRunning : undefined}
                                isAlternateActive={isAlternateActive}
                                hasInteracted={hasInteracted}
                              />
                            )
                          ) : null}
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
            </>
          )}
        </main>

        {/* Agent overlay — inside main so it overlays the tab view area */}
        {showAiBar && activeTabId && !isStandalone && (
          <AgentOverlay sessionId={activeTabId} onClose={() => setShowAiBar(false)} />
        )}
      </div>
      )}

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
                await system.writeFileContent(tab.filePath, tab.fileContent);
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

      <StatusBar noFolder={tabs.length === 0} />
    </div>
  );
}

export default AppShellView;