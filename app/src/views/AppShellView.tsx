import { type SubmitEvent, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { openSettingsWindow } from "../lib/settings";
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
import { useSettingsStore } from "../stores/useSettingsStore";
import { useAgentStore, CONST_DEFAULT_SESSION_STATE } from "../stores/useAgentStore";
import { useNotificationStore } from "../stores/useToastStore";
import { TabBar } from "../components/ui/TabBar";
import { SidePanel } from "../components/ui/SidePanel";
import { StatusBar } from "../components/ui/StatusBar";
import { AppHeader } from "../components/layout/AppHeader";
import { AppContextMenu } from "../components/layout/AppContextMenu";
import { RightPanel } from "../components/layout/RightPanel";
import { SaveChangesModal } from "../components/layout/SaveChangesModal";
import { CommandInputBar, type AttachedFile } from "../components/layout/CommandInputBar";
import { system } from "../lib/ipc";
import { openGitViewWindow } from "../lib/gitWindow";
import { GIT_DIFF_TAB_EVENT, type GitDiffTabPayload } from "../lib/gitDiffBridge";
import { TerminalWorkspaceView } from "./TerminalWorkspaceView";
import { NewWindowView } from "./NewWindowView";
import { getDefaultShellLaunch, isWindowsPlatform } from "../lib/shell";
import { fileNameFromPath } from "../lib/pathUtils";
import { classifyInput, setAvailableCommands, type ShellType } from "../lib/nlClassifier";
import { resolveSlashCommand } from "../lib/agentSlash";
import { closeAllPopups, onClosePopups } from "../lib/popups";

import { FileWorkspaceView } from "./FileWorkspaceView";
import { AgentView } from "./AgentView";
import { DiffWorkspaceView } from "../components/editor/DiffWorkspaceView";
import { CommitDiffView } from "../components/editor/CommitDiffView";
import { GitView } from "../components/git/GitView";
import { MergeWorkspaceView } from "./MergeWorkspaceView";

export function AppShellView() {
  const { tabs, activeTabId, spawnSession, killSession, openFile, setActiveTabId } = useAppBootstrap();
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
    sessionCwds,
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

  const activeAgentSessionId = useAgentStore((state) => state.activeAgentSessionId);
  const createAgentSession = useAgentStore((state) => state.createAgentSession);

  useEffect(() => {
    const store = useAgentStore.getState();
    const sessionsList = Object.entries(store.sessions).filter(([_, s]) => s.isAgentViewSession);
    if (!store.activeAgentSessionId) {
      if (sessionsList.length > 0) {
        store.setActiveAgentSessionId(sessionsList[0][0]);
      } else {
        createAgentSession("Welcome Chat");
      }
    }
  }, [createAgentSession]);

  // Surface settings save/apply failures forwarded from the settings window.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listen("aurora:settings-error", (event) => {
      useNotificationStore.getState().addNotification(event.payload, "error");
    }).then((u) => {
      unlisten = u;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    const handleOpen = (e: Event) => {
      const { path, options } = (e as CustomEvent).detail;
      openFile(path, projectDir || cwdAbsolute, options);
      setViewMode("file");
    };
    window.addEventListener("aurora-open-file-path", handleOpen);
    return () => window.removeEventListener("aurora-open-file-path", handleOpen);
  }, [openFile, projectDir, cwdAbsolute, setViewMode]);

  useEffect(() => {
    const unlisten = listen<GitDiffTabPayload>(GIT_DIFF_TAB_EVENT, (event) => {
      const payload = event.payload;
      const existing = useSessionStore.getState().tabs.find(
        t => t.type === "diff" && (
          (payload.filePath && t.filePath === payload.filePath && !t.diffCommitHash) ||
          (!payload.filePath && t.name === payload.name)
        )
      );
      if (existing) {
        useSessionStore.getState().setActiveTabId(existing.id);
        return;
      }
      useSessionStore.getState().addTab(payload);
      useSessionStore.getState().setActiveTabId(payload.id);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);



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

  const { startTask, stopAgentRun } = useAgentExecution(activeTabId);

  const agentStatus = useAgentStore((state) =>
    activeTabId ? (state.sessions[activeTabId]?.status ?? "idle") : "idle"
  );
  const isAiRunning = agentStatus === "planning" || agentStatus === "executing" || agentStatus === "paused";
  const isRunning = isCommandRunning || isAiRunning;

  // Red stop — stops the terminal command only.
  const handleStopCommand = useCallback(() => {
    handleStopCurrentCommand();
  }, [handleStopCurrentCommand]);

  // Blue stop — stops the AI response/task, interrupting any running tool call,
  // but never kills the terminal session (that is the red button's job).
  const handleStopAi = useCallback(() => {
    stopAgentRun();
  }, [stopAgentRun]);

  // Command history for the input bar: this session's executed blocks (chronological)
  // merged with the shell's history. Dedupe keeping the most recent occurrence and
  // order oldest → newest so ArrowUp starts at the newest entry without repeats.
  const commandHistory = useMemo(() => {
    const blockCommands = activeTabBlocks
      .filter((block) => block.command && block.command !== "init-aurora")
      .map((block) => block.command as string);

    const newestFirst: string[] = [];
    const seen = new Set<string>();
    const pushUnique = (raw: string) => {
      const clean = raw.replace(/[`\\]+$/, "").trim();
      if (!clean) return;
      const key = clean.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      newestFirst.push(clean);
    };

    // Blocks (this session) are more recent than identical entries in the shell
    // history, so scan them first. shellHistory is newest-first from read_shell_history.
    for (let i = blockCommands.length - 1; i >= 0; i--) pushUnique(blockCommands[i]);
    for (const cmd of shellHistory) pushUnique(cmd);

    return [...newestFirst].reverse();
  }, [activeTabBlocks, shellHistory]);

  const shellType: ShellType = useMemo(() => isWindowsPlatform() ? "powershell" : "bash", []);
  const inputMode = useMemo(() => classifyInput(activeCommandInput, shellType), [activeCommandInput, shellType]);

  useEffect(() => {
    system.getAvailableCommands().then(setAvailableCommands).catch(() => { });
  }, []);

  const handleInterceptedSubmit = async (
    event: SubmitEvent<HTMLFormElement>,
    defaultSubmit: (e: SubmitEvent<HTMLFormElement>, commandOverride?: string) => void,
    isFilePrompt = false,
    attachedFiles: AttachedFile[] = [],
    forceAi = false
  ) => {
    event.preventDefault();

    const agentStatus = activeTabId
      ? (useAgentStore.getState().sessions[activeTabId]?.status ?? "idle")
      : "idle";

    // While the AI model is producing a response (or awaiting approval), no
    // commands can be sent to the agent OR the terminal. The input stays
    // typable; the blue send button shows the loading indicator and is
    // disabled. This matches the send button's disabled state exactly so Enter
    // can never submit while the button is disabled.
    if (agentStatus === "planning" || agentStatus === "paused") {
      return;
    }

    const input = activeCommandInput.trim();
    if (!input && attachedFiles.length === 0) return;

    // Slash-command dispatch (/skills /mcp /btw /file) takes priority over
    // NL/command classification.
    const slash = await resolveSlashCommand(input, {
      cwd: cwdAbsolute,
      sessionId: activeTabId,
      isTaskRunning: agentStatus === "executing",
    });
    if (slash.handled) {
      if (slash.assistantMessage) {
        if (activeTabId) {
          const store = useAgentStore.getState();
          store.addChatMessage(activeTabId, { role: "user", content: input, agentType: "terminal" });
          store.addChatMessage(activeTabId, { role: "assistant", content: slash.assistantMessage, agentType: "terminal" });
        }
        setCommandInput("");
        setShowAiBar(true);
      } else if (slash.goal) {
        setCommandInput("");
        setShowAiBar(true);
        startTask(slash.goal, isFilePrompt ? undefined : "terminal");
      }
      return;
    }

    // Explicit prefix overrides take priority over the classifier
    const hasExplicitNL = input.startsWith("? ") || input.startsWith("/ai ");
    // The blue send button always routes to AI. While a terminal command is
    // running, submitting also routes to AI directly — never to the shell.
    const isNlQuery = forceAi || hasExplicitNL || isFilePrompt || isCommandRunning || (inputMode === "natural-language");

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

  const inputCwdAbsolute = targetSessionId
    ? sessionCwds[targetSessionId] || projectDir || cwdAbsolute
    : projectDir || cwdAbsolute;
  const inputCwdLabel = inputCwdAbsolute ? fileNameFromPath(inputCwdAbsolute) : "";


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
    const mode = useSettingsStore.getState().gitGuiMode;
    if (mode === "window") {
      openGitViewWindow(projectDir || cwdAbsolute);
      return;
    }
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
  const gitGuiMode = useSettingsStore(s => s.gitGuiMode);
  const gitViewActive = gitGuiMode === "tab" && tabs.some(t => t.type === "git" && t.id === activeTabId);

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
        onOpenCommandPalette={() => { closeAllPopups(); window.dispatchEvent(new CustomEvent("focus-search-bar")); }}
        onNewWindow={handleNewWindow}
        onNewTab={handleNewTab}
        onCloseSession={handleCloseSession}
        onCloseTab={handleCloseTab}
        onCloseOtherTabs={handleCloseOtherTabs}
        onOpenSettings={() => { closeAllPopups(); handleOpenSettings(); }}
        onToggleTabBar={toggleTabBarVisible}
        onShowTerminalView={handleShowTerminalView}
        onShowFileView={handleShowFileView}
        onShowAgentView={handleShowAgentView}
        onExit={handleExit}
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
            {/* Tab views — always mounted, hidden when agent view is active */}
            <div
              className="flex flex-col flex-1 min-h-0 min-w-0 overflow-hidden"
              style={{
                visibility: viewMode === "agent" ? "hidden" : "visible",
                pointerEvents: viewMode === "agent" ? "none" : "auto",
              }}
            >
              {!isStandalone && (
                <div className={tabBarVisible ? "" : "hidden"}>
                  <TabBar
                    viewMode={viewMode === "terminal" ? "terminal" : "file"}
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
                              onOpenFile={(path) => {
                                const base = projectDir || cwdAbsolute;
                                const isAbs = /^[A-Z]:[/\\]|^[/\\]|^~/i.test(path);
                                const abs = isAbs ? path : (base ? `${base}/${path}`.replace(/\/\//g, "/") : path);
                                openFile(abs, base);
                                setViewMode("file");
                              }}
                            />
                          ) : tab.type === "diff" ? (
                            <DiffWorkspaceView
                              tabId={tab.id}
                              filePath={tab.filePath || ""}
                              oldContent={tab.diffOldContent || ""}
                              newContent={tab.diffNewContent || ""}
                              commitHash={tab.diffCommitHash || ""}
                              onOpenFile={(path) => {
                                const base = projectDir || cwdAbsolute;
                                const isAbs = /^[A-Z]:[/\\]|^[/\\]|^~/i.test(path);
                                const abs = isAbs ? path : (base ? `${base}/${path}`.replace(/\/\//g, "/") : path);
                                openFile(abs, base);
                                setViewMode("file");
                              }}
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

              {/* Terminal view: command variant (default) — keep the bar (Stop only) visible
                  while a command runs even if it enters the alternate screen buffer */}
              {chatInputOpen && activeTab?.type === "terminal" && (!isAlternateActive || isRunning) && (
                <CommandInputBar
                  sessionId={targetSessionId}
                  cwd={inputCwdLabel}
                  isLoading={isCwdLoading}
                  isCommandRunning={isCommandRunning}
                  isAiRunning={isAiRunning}
                  value={activeCommandInput}
                  history={commandHistory}
                  hideCwdBreadcrumb={false}
                  onChange={setCommandInput}
                  onSubmit={(e, files, forceAi) => handleInterceptedSubmit(e, handleExecuteCommand, false, files, !!forceAi)}
                  onStopCommand={handleStopCommand}
                  onStopAi={handleStopAi}
                  onOpenAiBar={() => setShowAiBar(true)}
                  inputMode={inputMode}
                />
              )}

              {/* File view: prompt variant — AI-only, no classifier. No terminal
                  commands show here (they run in the background), so only the
                  blue AI-stop is ever visible. */}
              {fileChatInputOpen && activeTab?.type === "file" && (
                <CommandInputBar
                  variant="prompt"
                  sessionId={null}
                  cwd={inputCwdLabel}
                  isLoading={false}
                  isCommandRunning={false}
                  isAiRunning={isAiRunning}
                  value={activeCommandInput}
                  history={[]}
                  onChange={setCommandInput}
                  onSubmit={(e, files) => handleInterceptedSubmit(e, handleFileCommandSubmit, true, files)}
                  onStopCommand={handleStopCommand}
                  onStopAi={handleStopAi}
                  onOpenAiBar={() => setShowAiBar(true)}
                />
              )}
            </div>

            {/* Agent view — always mounted, hidden when tab view is active */}
            <div
              className="flex-1 min-h-0 overflow-hidden absolute inset-0"
              style={{
                visibility: viewMode === "agent" ? "visible" : "hidden",
                pointerEvents: viewMode === "agent" ? "auto" : "none",
                zIndex: viewMode === "agent" ? 20 : 0,
              }}
            >
              <AgentView />
            </div>
        </main>

        {/* Right Panel */}
        {showAiBar && !isStandalone && (viewMode === "agent" || activeTabId) && (
          <RightPanel
            viewMode={viewMode}
            sessionId={viewMode === "agent" ? activeAgentSessionId : activeTabId!}
            onClose={() => setShowAiBar(false)}
          />
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
      />

      <StatusBar noFolder={tabs.length === 0} />
    </div>
  );
}

export default AppShellView;