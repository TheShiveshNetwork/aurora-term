import { type SubmitEvent, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { v4 as uuidv4 } from "uuid";
import { Tab } from "@aurora/types";

import { useAppBootstrap } from "../hooks/useAppBootstrap";
import { useCommandExecution } from "../hooks/useCommandExecution";
import { useAgentExecution } from "../hooks/useAgentExecution";
import { usePersistUIState } from "../hooks/usePersistUIState";
import { useWindowClamp } from "../hooks/useWindowClamp";
import { useKeybindings } from "../hooks/useKeybindings";
import { useAppShellStore } from "../stores/useAppShellStore";
import { useBlockStore } from "../stores/useBlockStore";
import { useSessionStore } from "../stores/useSessionStore";
import { useAgentStore, CONST_DEFAULT_SESSION_STATE } from "../stores/useAgentStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import { TabBar } from "../components/ui/TabBar";
import { SidePanel } from "../components/ui/SidePanel";
import { StatusBar } from "../components/ui/StatusBar";
import { AppHeader } from "../components/layout/AppHeader";
import { AppContextMenu } from "../components/layout/AppContextMenu";
import { AgentOverlay } from "../components/terminal/AgentOverlay";
import { SaveChangesModal } from "../components/layout/SaveChangesModal";
import { CommandInputBar, type AttachedFile } from "../components/layout/CommandInputBar";
import { system } from "../lib/ipc";
import { TerminalWorkspaceView } from "./TerminalWorkspaceView";
import { NewWindowView } from "./NewWindowView";
import { getDefaultShellLaunch, isWindowsPlatform } from "../lib/shell";
import { classifyInput, setAvailableCommands, type ShellType } from "../lib/nlClassifier";
import { closeAllPopups, onClosePopups } from "../lib/popups";

import { FileWorkspaceView } from "./FileWorkspaceView";
import { AgentView } from "./AgentView";
import { DiffWorkspaceView } from "../components/editor/DiffWorkspaceView";
import { CommitDiffView } from "../components/editor/CommitDiffView";
import { GitView } from "../components/git/GitView";
import { MergeWorkspaceView } from "./MergeWorkspaceView";
import { NotificationContainer } from "../components/ui/NotificationContainer";

export function AppShellView() {
  const { tabs, activeTabId, spawnSession, killSession, openFile, setActiveTabId } = useAppBootstrap();
  const theme = useSettingsStore((state) => state.theme);
  const setTheme = useSettingsStore((state) => state.setTheme);
  const bootstrapReady = useAppShellStore((s) => s.bootstrapReady);
  usePersistUIState();
  useWindowClamp();
  useKeybindings();


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
    fileChatInputOpen,
    setFileChatInputOpen,
    toggleFileChatInputOpen,
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
  } = useAppShellStore(s => s);

  const layoutBackupRef = useRef<{
    sidebarCollapsed: boolean;
    chatInputOpen: boolean;
    fileChatInputOpen: boolean;
    showAiBar: boolean;
  } | null>(null);

  useEffect(() => {
    const store = useAppShellStore.getState();
    if (viewMode === "agent") {
      if (!layoutBackupRef.current) {
        layoutBackupRef.current = {
          sidebarCollapsed: store.sidebarCollapsed,
          chatInputOpen: store.chatInputOpen,
          fileChatInputOpen: store.fileChatInputOpen,
          showAiBar: store.showAiBar,
        };
      }
      store.setSidebarCollapsed(true);
      store.setChatInputOpen(false);
      store.setFileChatInputOpen(false);
      store.setShowAiBar(false);
    } else {
      if (layoutBackupRef.current) {
        store.setSidebarCollapsed(layoutBackupRef.current.sidebarCollapsed);
        store.setChatInputOpen(layoutBackupRef.current.chatInputOpen);
        store.setFileChatInputOpen(layoutBackupRef.current.fileChatInputOpen);
        store.setShowAiBar(layoutBackupRef.current.showAiBar);
        layoutBackupRef.current = null;
      }
    }
  }, [viewMode]);

  const [isGitRepo, setIsGitRepo] = useState(false);
  useEffect(() => {
    const dir = projectDir || cwdAbsolute;
    if (!dir) { setIsGitRepo(false); return; }
    system.gitIsRepo(dir).then(setIsGitRepo).catch(() => setIsGitRepo(false));
  }, [projectDir, cwdAbsolute]);

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

  const { startTask } = useAgentExecution(activeTabId);

  const agentStatus = useAgentStore((state) =>
    activeTabId ? (state.sessions[activeTabId]?.status ?? "idle") : "idle"
  );
  const isAiRunning = agentStatus === "planning" || agentStatus === "executing" || agentStatus === "paused";
  const isRunning = isCommandRunning || isAiRunning;

  const handleStop = useCallback(() => {
    if (isCommandRunning) {
      handleStopCurrentCommand();
    }
    if (isAiRunning && activeTabId) {
      const store = useAgentStore.getState();
      store.setPendingToolCall(activeTabId, null);
      store.setCurrentCommandIndex(activeTabId, -1);
      store.failTask(activeTabId, "Cancelled by user");
      const snap = store.sessions[activeTabId];
      store.addChatMessage(activeTabId, {
        role: "assistant",
        content: "Task cancelled by user.",
        chainNodes: snap?.chainNodes ?? [],
        agentType: snap?.agentType,
      });
    }
  }, [isCommandRunning, isAiRunning, activeTabId, handleStopCurrentCommand]);

  const shellType: ShellType = useMemo(() => isWindowsPlatform() ? "powershell" : "bash", []);
  const inputMode = useMemo(() => classifyInput(activeCommandInput, shellType), [activeCommandInput, shellType]);

  useEffect(() => {
    system.getAvailableCommands().then(setAvailableCommands).catch(() => { });
  }, []);

  const handleInterceptedSubmit = async (
    event: SubmitEvent<HTMLFormElement>,
    defaultSubmit: (e: SubmitEvent<HTMLFormElement>, commandOverride?: string) => void,
    isFilePrompt = false,
    attachedFiles: AttachedFile[] = []
  ) => {
    event.preventDefault();
    const input = activeCommandInput.trim();
    if (!input && attachedFiles.length === 0) return;

    // Explicit prefix overrides take priority over the classifier
    const hasExplicitNL = input.startsWith("? ") || input.startsWith("/ai ");
    // Route to agent if explicitly prefixed, or if classified as natural language
    const isNlQuery = hasExplicitNL || isFilePrompt || (inputMode === "natural-language");

    if (isNlQuery) {
      const cleanGoal = hasExplicitNL
        ? input.startsWith("? ")
          ? input.slice(2).trim()
          : input.slice(4).trim()
        : input;

      let goalWithFiles = cleanGoal;
      if (attachedFiles.length > 0) {
        const filesContext = attachedFiles.map(file => {
          return `\n\n[Attached File: ${file.name}]\n${file.content}`;
        }).join("\n");
        goalWithFiles = (cleanGoal || "Review attached files") + filesContext;
      }

      setCommandInput("");
      setShowAiBar(true);
      startTask(goalWithFiles, isFilePrompt ? undefined : "terminal");
    } else {
      // It's a PTY command!
      // 1. Copy files to CWD
      if (attachedFiles.length > 0) {
        for (const file of attachedFiles) {
          try {
            await system.copyPath(file.path, cwd);
          } catch (err) {
            console.error("Failed to copy file to CWD:", err);
          }
        }
      }

      // 2. Append filenames to command input
      let finalCommand = input;
      if (attachedFiles.length > 0) {
        const filenames = attachedFiles.map(f => f.name).join(" ");
        finalCommand = finalCommand ? `${finalCommand} ${filenames}` : filenames;
        setCommandInput(finalCommand);
      }

      defaultSubmit(event, finalCommand);
    }
  };

  const handleFileCommandSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
  };

  const activeTab = tabs.find((tab) => tab.id === activeTabId) || null;
  const isStandaloneView = activeTab?.type === "file" || activeTab?.type === "diff" || activeTab?.type === "git" || activeTab?.type === "merge";
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
        url: "/",
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
        everChanged: false,
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

  if (!bootstrapReady) {
    return <div className="h-screen w-screen" style={{ background: "#0A0D14" }} />;
  }

  return (
    <div
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
        chatInputOpen={activeTab?.type === "terminal" ? chatInputOpen : fileChatInputOpen}
        onToggleChatInput={() => {
          if (activeTab?.type === "file") {
            toggleFileChatInputOpen();
          } else {
            toggleChatInputOpen();
          }
        }}
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
        onOpenFileAtPath={(path: string, options?: { lineNumber?: number; matchStart?: number; matchEnd?: number }) => { openFile(path, projectDir || cwdAbsolute, options); setViewMode("file"); }}
        onOpenGitView={handleOpenGitView}
        gitViewActive={gitViewActive}
        noFolder={tabs.length === 0}
        isGitRepo={isGitRepo}
      />

      {tabs.length === 0 ? (
        <NewWindowView onOpenFolder={handleOpenFolder} />
      ) : (
        <div className="flex flex-1 overflow-hidden">
          <SidePanel collapsed={sidebarCollapsed} cwd={projectDir || cwdAbsolute} activeFilePath={activeFilePath}
            onOpenFileAtPath={(path: string, options?: { lineNumber?: number; matchStart?: number; matchEnd?: number }) => { openFile(path, projectDir || cwdAbsolute, options); setViewMode("file"); }}
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
                everChanged: false,
              };
              useSessionStore.getState().addTab(newTab);
              setActiveTabId(welcomeTabId);
              setViewMode("file");
            }}
          />

          <main className="flex-1 flex flex-col min-w-0 bg-surface-container-low overflow-hidden relative">
            {viewMode === "agent" ? (
              <div className="flex-1 min-h-0 overflow-hidden">
                <AgentView />
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
                          useAppShellStore.getState().setChatInputOpen(true);
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
                          everChanged: false,
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
                            ) : tab.type === "merge" ? (
                              <MergeWorkspaceView tab={tab} />
                            ) : tab.type === "diff" && tab.diffContent ? (
                              <CommitDiffView
                                diff={tab.diffContent}
                                commitHash={tab.diffCommitHash || ""}
                                filePath={tab.filePath || ""}
                                collapsible={true}
                              />
                            ) : tab.type === "diff" ? (
                              <DiffWorkspaceView
                                filePath={tab.filePath || ""}
                                oldContent={tab.diffOldContent || ""}
                                newContent={tab.diffNewContent || ""}
                                commitHash={tab.diffCommitHash || ""}
                              />
                            ) : tab.type === "git" ? (
                              <GitView cwd={projectDir || cwdAbsolute} tabId={tab.id} />
                            ) : (
                              <TerminalWorkspaceView
                                tab={tab}
                                isVisible={isTabActive}
                                isCommandRunning={isTabActive ? isCommandRunning : undefined}
                                isAlternateActive={isAlternateActive}
                                hasInteracted={hasInteracted}
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
                  isRunning={isRunning}
                  value={activeCommandInput}
                  history={[
                    ...activeTabBlocks.filter((block) => block.command && block.command !== "init-aurora").map((block) => block.command as string),
                    ...shellHistory.slice().reverse(),
                  ]}
                  onChange={setCommandInput}
                  onSubmit={(e, files) => handleInterceptedSubmit(e, handleExecuteCommand, false, files)}
                  onStop={handleStop}
                  onOpenAiBar={() => setShowAiBar(true)}
                  inputMode={inputMode}
                />
              )}

              {/* File view: prompt variant — AI-only, no classifier */}
              {fileChatInputOpen && activeTab?.type === "file" && (
                <CommandInputBar
                  variant="prompt"
                  sessionId={null}
                  cwd={cwd}
                  isLoading={false}
                  isRunning={false}
                  value={activeCommandInput}
                  history={[]}
                  onChange={setCommandInput}
                  onSubmit={(e, files) => handleInterceptedSubmit(e, handleFileCommandSubmit, true, files)}
                  onStop={handleStop}
                  onOpenAiBar={() => setShowAiBar(true)}
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
        onChangeAllOccurrences={() => {
          window.dispatchEvent(new CustomEvent("file-change-all-occurrences"));
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
        onAiImprovement={() => {
          if (activeTabId) {
            window.dispatchEvent(new CustomEvent("file-ai-improvement", { detail: { tabId: activeTabId } }));
          }
          clearContextMenu();
        }}
      />

      <StatusBar noFolder={tabs.length === 0} />
      <NotificationContainer />
    </div>
  );
}

export default AppShellView;