import React, { useEffect, useState, useRef, useCallback } from "react";
import { FolderOpen, Settings, User, Command, Mic, Plus, Menu, Terminal, Search, Copy, Scissors, Trash2, SplitSquareHorizontal, PanelLeftClose, PanelLeft, SquareTerminal, RefreshCw, Clipboard, Square, Globe, History, FileText, ChevronRight, Folder, ExternalLink, LogOut, PinIcon, PinOff } from "lucide-react";
import { usePTY } from "./hooks/usePTY";
import { pty } from "./lib/ipc";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useBlockStore } from "./stores/useBlockStore";
import { useSessionStore } from "./stores/useSessionStore";
import { useSettingsStore } from "./stores/useSettingsStore";
import { useAICompletion } from "./hooks/useAICompletion";
import { useAIStore } from "./stores/useAIStore";
import { TabBar } from "./components/ui/TabBar";
import { SidePanel } from "./components/ui/SidePanel";
import { TerminalPane } from "./components/terminal/TerminalPane";
import { FileViewer } from "./components/editor/FileViewer";
import { AICommandBar } from "./components/ai/AICommandBar";
import { GhostInput } from "./components/terminal/GhostInput";
import { SettingsModal } from "./components/settings/SettingsModal";
import { StatusBar } from "./components/ui/StatusBar";
import { WindowControls } from "./components/ui/WindowControls";
import {
  RightClickMenuItem,
  RightClickMenuPanel,
  RightClickMenuSeparator,
} from "./components/ui/RightClickMenu";
import { Block, Tab } from "@aurora/types";

export default function App() {
  const { tabs, activeTabId, spawnSession, killSession, setActiveTabId, openFile } = usePTY();
  const { blocks, runningBlockId, addBlock, updateBlock, setAIExplain, toggleBookmark } = useBlockStore();
  const { theme, setTheme } = useSettingsStore();
  const alternateBufferActive = useSessionStore((state) => state.alternateBufferActive);
  const isAlternateActive = activeTabId ? alternateBufferActive[activeTabId] || false : false;

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAiBar, setShowAiBar] = useState(false);
  const [commandInputs, setCommandInputs] = useState<Record<string, string>>({});
  const activeCommandInput = activeTabId ? commandInputs[activeTabId] ?? "" : "";
  const setCommandInput = useCallback((value: string | ((prev: string) => string)) => {
    if (!activeTabId) return;
    setCommandInputs(prev => {
      const current = prev[activeTabId] ?? "";
      const next = typeof value === "function" ? value(current) : value;
      if (next === "" && !(activeTabId in prev)) return prev;
      return { ...prev, [activeTabId]: next };
    });
  }, [activeTabId]);
  const [cwd, setCwd] = useState("~/workspace");
  const [cwdAbsolute, setCwdAbsolute] = useState("");
  const [sessionCwds, setSessionCwds] = useState<Record<string, string>>({});
  const lastSentCwdRef = useRef("");
  const [isCwdLoading, setIsCwdLoading] = useState(false);
  const [shellHistory, setShellHistory] = useState<string[]>([]);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; selectedText?: string; source?: "terminal" | "input" | "file" } | null>(null);

  const [interactedSessions, setInteractedSessions] = useState<Set<string>>(new Set());
  const [pendingCloseTabId, setPendingCloseTabId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"terminal" | "file">("terminal");
  const hasSpawnedRef = useRef(false);
  const hasHadTabsRef = useRef(false);

  const [showMenuDropdown, setShowMenuDropdown] = useState(false);
  const [tabBarVisible, setTabBarVisible] = useState(true);
  const [localDirNodes, setLocalDirNodes] = useState<any[]>([]);

  const [lastActiveTerminalId, setLastActiveTerminalId] = useState<string | null>(null);
  const [lastActiveFileId, setLastActiveFileId] = useState<string | null>(null);

  // Sync last active tab per type
  useEffect(() => {
    if (!activeTabId) return;
    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (activeTab) {
      if (activeTab.type === "terminal") {
        setLastActiveTerminalId(activeTab.id);
      } else if (activeTab.type === "file") {
        setLastActiveFileId(activeTab.id);
      }
    }
  }, [activeTabId, tabs]);

  // Reload empty tab directory browser on CWD changes
  useEffect(() => {
    if (cwdAbsolute) {
      invoke<any[]>("read_dir", { path: cwdAbsolute })
        .then(setLocalDirNodes)
        .catch(console.error);
    }
  }, [cwdAbsolute]);

  // Click outside to close dropdown
  useEffect(() => {
    const handleOutsideClick = () => setShowMenuDropdown(false);
    window.addEventListener("click", handleOutsideClick);
    return () => window.removeEventListener("click", handleOutsideClick);
  }, []);

  // Listen for terminal session restarts to clear interaction state
  useEffect(() => {
    const handleSessionRestart = (e: Event) => {
      const { sessionId } = (e as CustomEvent<{ sessionId: string }>).detail;
      setInteractedSessions((prev) => {
        const next = new Set(prev);
        next.delete(sessionId);
        return next;
      });
    };
    window.addEventListener("terminal-session-restart", handleSessionRestart as EventListener);
    return () => window.removeEventListener("terminal-session-restart", handleSessionRestart as EventListener);
  }, []);


  const handleSelectFolderDirectly = (path: string) => {
    setCwdAbsolute(path);
    const parts = path.split(/[\\/]/);
    setCwd("~/" + (parts[parts.length - 1] || path));
    // Save to session cwds
    if (activeTabId) {
      setSessionCwds((prev) => ({ ...prev, [activeTabId]: path }));
    }
  };

  const handleOpenFolder = async () => {
    setShowMenuDropdown(false);
    try {
      const selected = await invoke<string | null>("select_folder");
      if (selected) {
        handleSelectFolderDirectly(selected);
      }
    } catch (err) {
      console.error("Failed to select folder:", err);
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
    } catch (err) {
      console.error("Failed to select file:", err);
    }
  };

  const handleOpenRecentFile = (filePath: string) => {
    setShowMenuDropdown(false);
    // Open in current workspace context
    invoke("read_dir", { path: cwdAbsolute })
      .then(async () => {
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
      const win = new WebviewWindow("aurora_" + Date.now(), {
        title: "Aurora Terminal",
        width: 1024,
        height: 768,
      });
    } catch (err) {
      console.error("Failed to spawn new window:", err);
    }
  };

  const handleNewTab = async () => {
    setShowMenuDropdown(false);
    const isWin = window.navigator.userAgent.includes("Windows");
    const defaultShell = isWin ? "powershell.exe" : "bash";
    const promptCmd = `function prompt { $cwd = $ExecutionContext.SessionState.Path.CurrentLocation; $branch = (git branch --show-current 2>$null); "__AURORA_PROMPT_START__" + [char]13 + [char]10 + "__AURORA_CWD__=$cwd" + [char]13 + [char]10 + "__AURORA_BRANCH__=$branch" + [char]13 + [char]10 + "__AURORA_PROMPT_END__"; return ' ' }; Clear-Host`;
    const args = isWin ? ["-NoLogo", "-NoExit", "-Command", promptCmd] : [];
    try {
      const sessionId = await spawnSession(defaultShell, args, {}, cwdAbsolute);
      setSessionCwds((prev) => ({ ...prev, [sessionId]: cwdAbsolute }));
    } catch (err) {
      console.error("Failed to spawn session:", err);
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
    if (activeTabId) {
      const activeTab = tabs.find(t => t.id === activeTabId);
      if (activeTab?.type === "file" && activeTab.dirty) {
        setPendingCloseTabId(activeTabId);
      } else {
        killSession(activeTabId);
      }
    }
  };

  const handleCloseAllTabsExceptThis = () => {
    setShowMenuDropdown(false);
    if (activeTabId) {
      tabs.forEach((tab) => {
        if (tab.id !== activeTabId) {
          killSession(tab.id);
        }
      });
    }
  };

  const handleToggleMode = () => {
    setShowMenuDropdown(false);
    setTheme(theme === "dark" ? "light" : "dark");
  };

  const handleExit = () => {
    setShowMenuDropdown(false);
    getCurrentWindow().close();
  };

  // Initialize AI token receiver hooks
  useAICompletion();

  // Spawns default shell on startup
  useEffect(() => {
    if (hasSpawnedRef.current) return;
    hasSpawnedRef.current = true;

    // Load real shell history from PSReadLine / bash / zsh history file
    invoke<string[]>("read_shell_history")
      .then((cmds) => setShellHistory(cmds))
      .catch(() => {/* silently ignore — history is best-effort */ });

    // Fetch initial workspace directory
    invoke<string>("get_cwd").then(dir => {
      setCwdAbsolute(dir);
      const parts = dir.split(/[\\/]/);
      setCwd("~/" + (parts[parts.length - 1] || dir));

      const isWin = window.navigator.userAgent.includes("Windows");
      const defaultShell = isWin ? "powershell.exe" : "bash";
      const promptCmd = `function prompt { $cwd = $ExecutionContext.SessionState.Path.CurrentLocation; $branch = (git branch --show-current 2>$null); "__AURORA_PROMPT_START__" + [char]13 + [char]10 + "__AURORA_CWD__=$cwd" + [char]13 + [char]10 + "__AURORA_BRANCH__=$branch" + [char]13 + [char]10 + "__AURORA_PROMPT_END__"; return ' ' }; Clear-Host`;
      const args = isWin ? ["-NoLogo", "-NoExit", "-Command", promptCmd] : [];

      spawnSession(defaultShell, args, {}, dir).then((sessionId) => {
        setActiveTabId(sessionId);
        setSessionCwds((prev) => ({ ...prev, [sessionId]: dir }));
        // Create initial terminal command welcome block
        const initBlock: Block = {
          id: uuidv4(),
          session_id: sessionId,
          command: "init-aurora",
          started_at: Date.now(),
          status: "success",
          output_type: "plain",
          collapsed: false,
          bookmarked: false,
          output_summary: "Welcome to Aurora Terminal. Interactive AI console active.",
          anchor_row: 0,
          output_row_end: 0,
          anchor_y: 0,
        };
        addBlock(sessionId, initBlock);
      }).catch(console.error);
    }).catch(console.error);

    // Capture global keyboard overrides
    const handleToggleCommandPalette = () => setShowSettings((prev) => !prev);
    const handleToggleAiBar = () => setShowAiBar((prev) => !prev);

    window.addEventListener("toggle-command-palette", handleToggleCommandPalette);
    window.addEventListener("toggle-ai-bar", handleToggleAiBar);

    return () => {
      window.removeEventListener("toggle-command-palette", handleToggleCommandPalette);
      window.removeEventListener("toggle-ai-bar", handleToggleAiBar);
    };
  }, []);

  // ── File-open event listeners (separate effect to avoid StrictMode double-mount issue) ──
  const openFileRef = useRef(openFile);
  openFileRef.current = openFile;
  const cwdAbsoluteRef = useRef(cwdAbsolute);
  cwdAbsoluteRef.current = cwdAbsolute;

  useEffect(() => {
    const handleOpenFile = (e: Event) => {
      const { path } = (e as CustomEvent<{ path: string }>).detail;
      if (!path) return;
      openFileRef.current(path, cwdAbsoluteRef.current);
      setViewMode("file");
    };

    window.addEventListener("sidebar-open-file", handleOpenFile);
    window.addEventListener("sidebar-open-file-current-tab", handleOpenFile);

    return () => {
      window.removeEventListener("sidebar-open-file", handleOpenFile);
      window.removeEventListener("sidebar-open-file-current-tab", handleOpenFile);
    };
  }, []);

  // ── Show-context-menu listener — separate effect so StrictMode double-mount
  // doesn't kill it (the spawn guard above blocks re-registration there).
  useEffect(() => {
    const handler = (e: Event) => {
      const { x, y, selectedText, source } = (
        e as CustomEvent<{ x: number; y: number; selectedText?: string; source?: "terminal" | "input" | "file" }>
      ).detail;
      setContextMenu({ x, y, selectedText, source });
    };
    window.addEventListener("show-context-menu", handler);
    return () => window.removeEventListener("show-context-menu", handler);
  }, []);

  useEffect(() => {
    const handler = () => setContextMenu(null);
    window.addEventListener("aurora-right-click-menu-close", handler);
    return () => window.removeEventListener("aurora-right-click-menu-close", handler);
  }, []);

  useEffect(() => {
    const handleOpenInNewTab = (e: Event) => {
      const { path } = (e as CustomEvent<{ path: string }>).detail;
      if (!path) return;

      const isWin = window.navigator.userAgent.includes("Windows");
      const defaultShell = isWin ? "powershell.exe" : "bash";
      const activeShell = tabs.find((tab) => tab.id === activeTabId)?.shell || defaultShell;
      const args = activeShell.includes("powershell") ? ["-NoLogo", "-NoExit"] : [];

      spawnSession(activeShell, args, {}, path).catch(console.error);
    };

    window.addEventListener("sidebar-open-in-new-tab", handleOpenInNewTab);
    return () => window.removeEventListener("sidebar-open-in-new-tab", handleOpenInNewTab);
  }, [activeTabId, spawnSession, tabs]);

  // ── Sidebar "Open in Terminal" — use a ref so we always read the live activeTabId
  const activeTabIdRef = useRef<string | null>(null);
  activeTabIdRef.current = activeTabId ?? null;

  useEffect(() => {
    const handler = (e: Event) => {
      const { path } = (e as CustomEvent<{ path: string }>).detail;
      const tabId = activeTabIdRef.current;
      if (!path || !tabId) return;
      const isWin = window.navigator.userAgent.includes("Windows");
      const cdCmd = isWin ? `Set-Location "${path}"` : `cd "${path}"`;
      pty.write(tabId, cdCmd + "\r\n").catch(console.error);
    };
    window.addEventListener("sidebar-open-in-terminal", handler);
    return () => window.removeEventListener("sidebar-open-in-terminal", handler);
  }, []);

  // Close window only when user has closed all tabs (not on initial empty state)
  useEffect(() => {
    if (tabs.length > 0) {
      hasHadTabsRef.current = true;
    } else if (hasHadTabsRef.current) {
      getCurrentWindow().close();
    }
  }, [tabs.length]);

  // Listen for cwd-change events fired by TerminalPane's sentinel detection
  useEffect(() => {
    const handler = (e: Event) => {
      const { path, sessionId } = (e as CustomEvent<{ path: string; sessionId: string }>).detail;
      if (!path || !sessionId) return;
      setSessionCwds((prev) => ({ ...prev, [sessionId]: path }));
      if (sessionId === activeTabId) {
        setIsCwdLoading(false);
      }

      // Ensure focus is restored to input bar once terminal is back to shell
      if (sessionId === activeTabId) {
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent("aurora-focus-terminal-input", { detail: { sessionId } }));
        }, 50);
      }
    };
    window.addEventListener("cwd-change", handler);
    return () => window.removeEventListener("cwd-change", handler);
  }, [activeTabId]);

  // Update active tab CWD when activeTabId or sessionCwds changes.
  // For terminal tabs: use the session's detected CWD.
  // For file tabs: use the CWD that was stored when the file was opened.
  // Only propagate to SidePanel when the path actually differs.
  useEffect(() => {
    if (!activeTabId) return;

    const activeTab = tabs.find(t => t.id === activeTabId);
    let currentPath: string | undefined;

    if (activeTab?.type === "file") {
      currentPath = activeTab.cwd;
    } else {
      currentPath = sessionCwds[activeTabId];
    }

    if (currentPath) {
      if (currentPath !== lastSentCwdRef.current) {
        lastSentCwdRef.current = currentPath;
        setCwdAbsolute(currentPath);
      }
      const parts = currentPath.split(/[\/\\]/);
      setCwd("~/" + (parts[parts.length - 1] || currentPath));
    }
  }, [activeTabId, sessionCwds, tabs]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("aurora-focus-terminal-input"));
  }, [activeTabId]);

  // Sync viewMode with the active tab's type on tab switch / open
  useEffect(() => {
    if (!activeTabId) return;
    const activeTab = tabs.find(t => t.id === activeTabId);
    if (activeTab) {
      setViewMode(activeTab.type);
    }
  }, [activeTabId]);

  // Helper uuid generator
  const uuidv4 = () => {
    return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
      (+c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (+c / 4)))).toString(16)
    );
  };

  const handleExecuteCommand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCommandInput.trim() || !activeTabId) return;

    const activeTab = tabs.find(t => t.id === activeTabId);
    // If the active tab is a file, route the command to the first terminal session
    const targetId = activeTab?.type === "file"
      ? tabs.find(t => t.type === "terminal")?.id
      : activeTabId;

    if (!targetId) return;

    const cmd = activeCommandInput;
    setCommandInput("");

    // Special handling to fully reset UI on clear command
    const cmdLower = cmd.trim().toLowerCase();
    if (cmdLower === "clear" || cmdLower === "cls" || cmdLower === "clear-host") {
      useBlockStore.getState().clearBlocks(targetId);
      setInteractedSessions((prev) => {
        const next = new Set(prev);
        next.delete(targetId);
        return next;
      });

      // Clear the frontend xterm.js instance fully
      window.dispatchEvent(
        new CustomEvent("terminal-clear", { detail: { sessionId: targetId } })
      );

      // Send a fixed clear command to the PTY so the shell actually executes
      // it and xterm receives the escape sequences to clear its buffer.
      // Do not write the original user input here.
      const isWindows = window.navigator.userAgent.toLowerCase().includes("windows");
      const clearCommand = isWindows ? "cls\r\n" : "clear\r\n";
      await pty.write(targetId, clearCommand);
      return;
    }

    // Create a new block metadata in useBlockStore to track history
    const blockId = uuidv4();
    const newBlock: Block = {
      id: blockId,
      session_id: targetId,
      command: cmd,
      started_at: Date.now(),
      status: "running",
      output_type: "plain",
      collapsed: false,
      bookmarked: false,
      output_summary: "",
      anchor_row: 0,
      output_row_end: 0,
      anchor_y: 0,
    };

    // Track executing block in blockStore
    useBlockStore.getState().setRunningBlockId(targetId, blockId);
    useBlockStore.getState().setCommandOutputReceived(targetId, false);
    addBlock(targetId, newBlock);

    // Send command directly to background PTY shell for execution
    try {
      setInteractedSessions((prev) => new Set(prev).add(targetId));

      // Notify TerminalPane about command run
      window.dispatchEvent(
        new CustomEvent(`pty-command-run:${targetId}`, { detail: { cmd } })
      );

      await pty.write(targetId, cmd + "\r\n");

      // After any directory-changing command, write a sentinel echo to the PTY.
      // TerminalPane intercepts __AURORA_CWD__=<path> in the output stream,
      // fires a cwd-change event with the shell's real path, and strips the line.
      const isCdCommand = /^(?:cd|chdir|pushd|popd|Set-Location|sl)(\s|$)/i.test(cmd.trim());
      if (isCdCommand) {
        setIsCwdLoading(true);
        const isWin = window.navigator.userAgent.includes("Windows");
        // Wait for the shell to finish cd, then echo real cwd with sentinel
        const echoCmd = isWin
          ? `Write-Host "__AURORA_CWD__=$PWD"\r\n`
          : `echo "__AURORA_CWD__=$(pwd)"\n`;
        setTimeout(() => {
          // Double-check if the session has transitioned to alternate buffer mode during the 150ms delay window.
          // Writing echoCmd while a TUI is active would inject keys directly into the TUI process stdin.
          const inAlt = useSessionStore.getState().alternateBufferActive[targetId] || false;
          if (inAlt) {
            console.log(`[App] Skipping delayed CWD sentinel echo: session ${targetId} is in alternate screen buffer`);
            setIsCwdLoading(false);
            return;
          }
          pty.write(targetId, echoCmd).catch(console.error);
        }, 150);
      }
    } catch (err) {
      console.error("Failed to write command to shell:", err);
      // Mark command block as failed
      updateBlock(targetId, blockId, {
        status: "error",
        finished_at: Date.now(),
        output_summary: `Error writing command to shell: ${err}`,
      });
      useBlockStore.getState().setRunningBlockId(targetId, null);
    }
  };

  const activeTab = tabs.find(t => t.id === activeTabId);
  const activeFilePath = activeTab?.type === "file" ? activeTab.filePath : undefined;
  const targetSessionId = activeTab?.type === "file"
    ? (tabs.find(t => t.type === "terminal")?.id ?? activeTabId)
    : activeTabId;

  const activeTabBlocks = targetSessionId ? blocks[targetSessionId] || [] : [];
  const activeRunningBlockId = targetSessionId ? runningBlockId[targetSessionId] : null;
  const activeRunningBlock = activeRunningBlockId
    ? activeTabBlocks.find((block) => block.id === activeRunningBlockId)
    : null;
  const isCommandRunning = activeRunningBlock?.status === "running";

  useEffect(() => {
    if (!activeTabId || !activeRunningBlockId) return;
    if (activeRunningBlock?.status === "running") return;

    useBlockStore.getState().setRunningBlockId(activeTabId, null);
    useBlockStore.getState().setCommandOutputReceived(activeTabId, false);
  }, [activeRunningBlock?.status, activeRunningBlockId, activeTabId]);

  // Auto-focus terminal input when command finishes or switching to terminal tab
  useEffect(() => {
    if (!isCommandRunning && activeTab?.type === "terminal") {
      // Small timeout ensures GhostInput is rendered before focusing
      const t = setTimeout(() => {
        window.dispatchEvent(new CustomEvent("aurora-focus-terminal-input", { detail: { sessionId: activeTabId } }));
      }, 50);
      return () => clearTimeout(t);
    }
  }, [isCommandRunning, activeTabId, activeTab?.type]);

  const handleStopCurrentCommand = () => {
    if (!targetSessionId || !activeRunningBlockId || !isCommandRunning) return;

    pty.write(targetSessionId, "\u0003").catch(console.error);
    useBlockStore.getState().updateBlock(targetSessionId, activeRunningBlockId, {
      status: "cancelled",
      finished_at: Date.now(),
    });
    useBlockStore.getState().setRunningBlockId(targetSessionId, null);
    useBlockStore.getState().setCommandOutputReceived(targetSessionId, false);
  };

  return (
    <div
      data-tauri-drag-region
      className="bg-background text-on-surface font-body-base overflow-hidden h-screen flex flex-col select-none"
      onContextMenu={(e) => e.preventDefault()} // suppress browser default everywhere
      onClick={() => setContextMenu(null)}
    >

      {/* Sleek Stitch Header with custom drag region and system window pips */}
      <header
        id="aurora-tab-bar"
        data-tauri-drag-region
        className="flex justify-between items-center w-full px-4 h-toolbar-height bg-surface-container-lowest border-b border-outline-variant/5 z-50 shadow-sm select-none"
      >
        <div data-tauri-no-drag className="flex items-center gap-2 h-full">
          <div className="flex items-center gap-1">
            <button
              data-tauri-no-drag
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="p-2 hover:bg-surface rounded-lg transition-colors text-on-surface-variant cursor-pointer"
              title="Toggle Sidebar"
            >
              {sidebarCollapsed
                ? <PanelLeft size={16} />
                : <PanelLeftClose size={16} />
              }
            </button>
            <div className="relative">
              <button
                data-tauri-no-drag
                onClick={(e) => {
                  e.stopPropagation();
                  setShowMenuDropdown(!showMenuDropdown);
                }}
                className={`p-2 hover:bg-surface rounded-lg transition-colors text-on-surface-variant cursor-pointer ${showMenuDropdown ? "bg-surface text-primary" : ""}`}
                title="Toggle Menu"
              >
                <Menu size={14} />
              </button>
              {showMenuDropdown && (
                <div
                  className="absolute left-0 mt-1.5 w-60 bg-surface-container-lowest border border-outline-variant/20 rounded-md shadow-2xl py-1 z-[999] text-on-surface font-body-base animate-in fade-in slide-in-from-top-1 duration-150"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={handleOpenFolder}
                    className="w-full flex items-center gap-3 px-3 py-2 text-[12px] hover:bg-surface-variant/30 hover:text-primary transition-colors text-left cursor-pointer"
                  >
                    <FolderOpen size={13} className="text-outline/65" />
                    <span className="flex-1">Open Folder</span>
                    <span className="text-[10px] text-outline/40">Ctrl+O</span>
                  </button>
                  <button
                    onClick={handleOpenFile}
                    className="w-full flex items-center gap-3 px-3 py-2 text-[12px] hover:bg-surface-variant/30 hover:text-primary transition-colors text-left cursor-pointer"
                  >
                    <FileText size={13} className="text-outline/65" />
                    <span className="flex-1">Open File</span>
                    <span className="text-[10px] text-outline/40">Ctrl+P</span>
                  </button>

                  <div className="relative group/recent">
                    <button
                      className="w-full flex items-center gap-3 px-3 py-2 text-[12px] hover:bg-surface-variant/30 hover:text-primary transition-colors text-left cursor-pointer"
                    >
                      <History size={13} className="text-outline/65" />
                      <span className="flex-1">Open Recent...</span>
                      <ChevronRight size={10} className="text-outline/40" />
                    </button>
                    <div className="absolute left-full top-0 ml-0.5 w-48 bg-surface-container-lowest border border-outline-variant/20 rounded-md shadow-2xl py-1 hidden group-hover/recent:block">
                      <button onClick={() => handleOpenRecentFile("package.json")} className="w-full px-3 py-1.5 text-[11px] hover:bg-surface-variant/30 hover:text-primary transition-colors text-left truncate cursor-pointer">package.json</button>
                      <button onClick={() => handleOpenRecentFile("src/App.tsx")} className="w-full px-3 py-1.5 text-[11px] hover:bg-surface-variant/30 hover:text-primary transition-colors text-left truncate cursor-pointer">src/App.tsx</button>
                      <button onClick={() => handleOpenRecentFile("src/styles/globals.css")} className="w-full px-3 py-1.5 text-[11px] hover:bg-surface-variant/30 hover:text-primary transition-colors text-left truncate cursor-pointer">globals.css</button>
                    </div>
                  </div>

                  <div className="h-px bg-outline-variant/20 my-1 mx-2" />

                  <button
                    onClick={handleNewWindow}
                    className="w-full flex items-center gap-3 px-3 py-2 text-[12px] hover:bg-surface-variant/30 hover:text-primary transition-colors text-left cursor-pointer"
                  >
                    <Plus size={13} className="text-outline/65" />
                    <span className="flex-1">New Window</span>
                    <span className="text-[10px] text-outline/40">Ctrl+Shift+N</span>
                  </button>
                  <button
                    onClick={handleNewTab}
                    className="w-full flex items-center gap-3 px-3 py-2 text-[12px] hover:bg-surface-variant/30 hover:text-primary transition-colors text-left cursor-pointer"
                  >
                    <SquareTerminal size={13} className="text-outline/65" />
                    <span className="flex-1">New Tab</span>
                    <span className="text-[10px] text-outline/40">Ctrl+T</span>
                  </button>

                  <div className="h-px bg-outline-variant/20 my-1 mx-2" />

                  <button
                    onClick={handleCloseSession}
                    className="w-full flex items-center gap-3 px-3 py-2 text-[12px] hover:bg-surface-variant/30 hover:text-primary transition-colors text-left cursor-pointer"
                  >
                    <Terminal size={13} className="text-outline/65" />
                    <span className="flex-1">Close Session</span>
                  </button>
                  <button
                    onClick={handleCloseTab}
                    className="w-full flex items-center gap-3 px-3 py-2 text-[12px] hover:bg-surface-variant/30 hover:text-primary transition-colors text-left cursor-pointer"
                  >
                    <Trash2 size={13} className="text-outline/65" />
                    <span className="flex-1">Close Tab</span>
                    <span className="text-[10px] text-outline/40">Ctrl+W</span>
                  </button>
                  <button
                    onClick={handleCloseAllTabsExceptThis}
                    className="w-full flex items-center gap-3 px-3 py-2 text-[12px] hover:bg-surface-variant/30 hover:text-primary transition-colors text-left cursor-pointer"
                  >
                    <SplitSquareHorizontal size={13} className="text-outline/65" />
                    <span className="flex-1">Close Other Tabs</span>
                  </button>

                  <div className="h-px bg-outline-variant/20 my-1 mx-2" />

                  <button
                    onClick={() => {
                      setShowMenuDropdown(false);
                      setShowSettings(true);
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2 text-[12px] hover:bg-surface-variant/30 hover:text-primary transition-colors text-left cursor-pointer"
                  >
                    <Command size={13} className="text-outline/65" />
                    <span className="flex-1">Command Palette</span>
                    <span className="text-[10px] text-outline/40">Ctrl+Shift+P</span>
                  </button>
                  <button
                    onClick={handleToggleMode}
                    className="w-full flex items-center gap-3 px-3 py-2 text-[12px] hover:bg-surface-variant/30 hover:text-primary transition-colors text-left cursor-pointer"
                  >
                    <Settings size={13} className="text-outline/65" />
                    <span className="flex-1">Switch Mode ({theme})</span>
                  </button>
                  <button
                    onClick={handleExit}
                    className="w-full flex items-center gap-3 px-3 py-2 text-[12px] hover:bg-red-500/10 hover:text-red-400 transition-colors text-left cursor-pointer"
                  >
                    <ExternalLink size={13} className="text-red-400/70" />
                    <span className="flex-1 font-semibold">Exit</span>
                  </button>
                </div>
              )}
              <button
                onClick={() => setTabBarVisible((v) => !v)}
                className={`p-2 hover:bg-surface rounded-lg transition-colors text-on-surface-variant cursor-pointer ${!tabBarVisible ? "bg-surface text-primary" : ""}`}
                title={tabBarVisible ? "Hide Tab Bar" : "Show Tab Bar"}
              >
                {tabBarVisible ? <PinIcon size={14} /> : <PinOff size={14} />}
              </button>
            </div>
          </div>
          <div className="flex items-center gap-1 ml-1">
            <button
              data-tauri-no-drag
              onClick={async () => {
                setViewMode("terminal");
                const hasTerminal = tabs.some(t => t.type === "terminal");
                if (!hasTerminal) {
                  const isWin = window.navigator.userAgent.includes("Windows");
                  const defaultShell = isWin ? "powershell.exe" : "bash";
                  const promptCmd = `function prompt { $cwd = $ExecutionContext.SessionState.Path.CurrentLocation; $branch = (git branch --show-current 2>$null); "__AURORA_PROMPT_START__" + [char]13 + [char]10 + "__AURORA_CWD__=$cwd" + [char]13 + [char]10 + "__AURORA_BRANCH__=$branch" + [char]13 + [char]10 + "__AURORA_PROMPT_END__"; return ' ' }; Clear-Host`;
                  const args = isWin ? ["-NoLogo", "-NoExit", "-Command", promptCmd] : [];
                  try {
                    const sessionId = await spawnSession(defaultShell, args, {}, cwdAbsolute);
                    setSessionCwds((prev) => ({ ...prev, [sessionId]: cwdAbsolute }));
                  } catch (err) {
                    console.error("Failed to spawn session:", err);
                  }
                } else {
                  const targetId = lastActiveTerminalId && tabs.some(t => t.id === lastActiveTerminalId)
                    ? lastActiveTerminalId
                    : (tabs.find(t => t.type === "terminal")?.id);
                  if (targetId) {
                    setActiveTabId(targetId);
                  }
                }
              }}
              className={`p-2 rounded-md transition-colors cursor-pointer ${viewMode === "terminal" ? "bg-primary/10 text-primary" : "bg-surface hover:bg-surface-bright/60 text-on-surface-variant/70 hover:text-on-surface-variant"}`}
              title="Terminal View"
            >
              <SquareTerminal size={14} />
            </button>
            <button
              data-tauri-no-drag
              onClick={async () => {
                setViewMode("file");
                const fileTabs = tabs.filter(t => t.type === "file");
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
                } else {
                  const targetId = lastActiveFileId && tabs.some(t => t.id === lastActiveFileId)
                    ? lastActiveFileId
                    : (tabs.find(t => t.type === "file")?.id);
                  if (targetId) {
                    setActiveTabId(targetId);
                  }
                }
              }}
              className={`p-2 rounded-md transition-colors cursor-pointer ${viewMode === "file" ? "bg-primary/10 text-primary" : "bg-surface hover:bg-surface-bright/60 text-on-surface-variant/70 hover:text-on-surface-variant"}`}
              title="Workspace View"
            >
              <FolderOpen size={14} />
            </button>
            <button data-tauri-no-drag className="p-2 hover:text-on-surface-variant bg-surface hover:bg-surface-bright/60 rounded-md transition-colors text-on-surface-variant/70 cursor-pointer" title="Agent View">
              <Command size={14} />
            </button>
            {/* <button data-tauri-no-drag className="p-2 hover:text-on-surface-variant bg-surface hover:bg-surface-bright/60 rounded-md transition-colors text-on-surface-variant/70 cursor-pointer" title="Browser View">
              <Globe size={14} />
            </button> */}
          </div>
        </div>

        {/* Sleek Central Search Bar */}
        <div className="flex-1 max-w-xl mx-8" data-tauri-drag-region>
          <div className="relative group">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-outline/50 group-focus-within:text-primary transition-colors font-bold select-none">
              <Search size={16} />
            </span>
            <input
              type="text"
              placeholder="Search sessions, chats, agents, files..."
              className="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-xl h-8 pl-9 pr-4 text-sm placeholder:text-outline/40 outline-none focus:border-primary/20 transition-all shadow-inner"
            />
          </div>
        </div>

        {/* Header Right utilities */}
        <div data-tauri-no-drag className="flex items-center gap-2 h-full">
          <button
            data-tauri-no-drag
            onClick={() => setShowSettings(true)}
            className="p-2 hover:bg-surface-variant/30 rounded-lg transition-colors text-on-surface-variant cursor-pointer"
            title="Settings"
          >
            <Settings size={14} />
          </button>
          <button data-tauri-no-drag className="p-1 hover:ring-2 ring-primary/20 rounded-full transition-all cursor-pointer mr-2">
            <div className="w-7 h-7 rounded-full bg-secondary-container/30 flex items-center justify-center text-secondary border border-secondary/20">
              <User size={14} />
            </div>
          </button>

          {<WindowControls />}
        </div>
      </header>

      {/* Main Workspace split */}
      <div className="flex flex-1 overflow-hidden">

        {/* Collapsible Sidebar — receives absolute cwd so tree refreshes on cd */}
        <SidePanel collapsed={sidebarCollapsed} cwd={cwdAbsolute} activeFilePath={activeFilePath} />

        {/* Terminal Workspace area */}
        <main className="flex-1 flex flex-col min-w-0 bg-surface-container-low overflow-hidden relative">

          {/* Safari Tab Bar */}
          <div className={tabBarVisible ? "" : "hidden"}>
          <TabBar
            viewMode={viewMode}
            onSetViewMode={setViewMode}
            onAddTab={async (type: "terminal" | "file") => {
              if (type === "terminal") {
                const isWin = window.navigator.userAgent.includes("Windows");
                const defaultShell = isWin ? "powershell.exe" : "bash";
                const promptCmd = `function prompt { $cwd = $ExecutionContext.SessionState.Path.CurrentLocation; $branch = (git branch --show-current 2>$null); "__AURORA_PROMPT_START__" + [char]13 + [char]10 + "__AURORA_CWD__=$cwd" + [char]13 + [char]10 + "__AURORA_BRANCH__=$branch" + [char]13 + [char]10 + "__AURORA_PROMPT_END__"; return ' ' }; Clear-Host`;
                const args = isWin ? ["-NoLogo", "-NoExit", "-Command", promptCmd] : [];
                try {
                  const sessionId = await spawnSession(defaultShell, args, {}, cwdAbsolute);
                  setSessionCwds((prev) => ({ ...prev, [sessionId]: cwdAbsolute }));
                } catch (err) {
                  console.error("Failed to spawn session:", err);
                }
              } else {
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
              }
            }}
            onKillTab={(id) => {
              const tab = tabs.find(t => t.id === id);
              if (tab?.type === "file" && tab.dirty) {
                setPendingCloseTabId(id);
              } else {
                killSession(id);
              }
            }}
            onDuplicateTab={(tab: Tab) => {
              if (tab.type === "terminal") {
                const isWin = window.navigator.userAgent.includes("Windows");
                const defaultShell = isWin ? "powershell.exe" : "bash";
                const promptCmd = `function prompt { $cwd = $ExecutionContext.SessionState.Path.CurrentLocation; $branch = (git branch --show-current 2>$null); "__AURORA_PROMPT_START__" + [char]13 + [char]10 + "__AURORA_CWD__=$cwd" + [char]13 + [char]10 + "__AURORA_BRANCH__=$branch" + [char]13 + [char]10 + "__AURORA_PROMPT_END__"; return ' ' }; Clear-Host`;
                const args = isWin ? ["-NoLogo", "-NoExit", "-Command", promptCmd] : [];
                spawnSession(defaultShell, args, {}, tab.cwd || cwdAbsolute)
                  .then((sessionId) => setSessionCwds((prev) => ({ ...prev, [sessionId]: tab.cwd || cwdAbsolute })))
                  .catch(console.error);
              } else if (tab.filePath) {
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
            }}
          />
          </div>

          {/* Content Area — Terminal or File Editor (Full Height) */}
          <div
            className={`flex-1 overflow-hidden w-full flex flex-col relative ${(tabs.find(t => t.id === activeTabId)?.type === "file" || isAlternateActive)
              ? ""
              : "px-3 pt-3"
              }`}
            onMouseDown={(e) => {
              const activeTab = tabs.find(t => t.id === activeTabId);

              // Do not steal focus if they clicked inside the xterm terminal viewport, preserving text selection
              const target = e.target as HTMLElement;
              if (target.closest(".xterm")) {
                return;
              }

              // Only auto-focus GhostInput if no block is running and we're not in a full-screen app.
              // This allows direct interaction with TUI/full-screen CLI apps.
              if (activeTab?.type === "terminal" && !isCommandRunning && !isAlternateActive) {
                window.dispatchEvent(new CustomEvent("aurora-focus-terminal-input", { detail: { sessionId: activeTabId } }));
              }
            }}
          >
            <div className="flex-1 min-h-0 w-full relative">
              {tabs.map((tab) => {
                const isTabActive = tab.id === activeTabId;
                const hasInteracted = interactedSessions.has(tab.id);
                const isTabVisible = isTabActive;
                const shouldDisplay = isTabVisible;

                return (
                  <div
                    key={tab.id}
                    className="absolute inset-0"
                    style={{
                      visibility: shouldDisplay ? "visible" : "hidden",
                      pointerEvents: shouldDisplay ? "auto" : "none",
                      zIndex: shouldDisplay ? 10 : 0
                    }}
                  >
                    {tab.type === "file" ? (
                      <div className="relative h-full flex flex-col bg-surface-container-low">
                        {tab.filePath ? (
                          <div className="relative h-full">
                            <FileViewer tabId={tab.id} filePath={tab.filePath} fileName={tab.name} />

                          </div>
                        ) : (
                          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center max-w-sm mx-auto w-full text-on-surface select-text">
                            {/* Welcome Banner */}
                            <div className="mb-6 flex flex-col items-center">
                              <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mb-4 text-primary">
                                <FolderOpen size={24} />
                              </div>
                              <h2 className="text-xl font-bold tracking-tight text-primary">
                                Aurora Workspace
                              </h2>
                              <p className="text-[11px] text-on-surface-variant/60 mt-1.5 leading-relaxed max-w-[240px]">
                                No files are open. Select an option to start editing in this workspace.
                              </p>
                            </div>

                            {/* Core Action Buttons (Vertical Stack) */}
                            <div className="flex flex-col gap-2.5 w-full">
                              <button
                                onClick={handleOpenFile}
                                className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-on-primary active:scale-[0.98] transition-all font-semibold text-xs cursor-pointer shadow-md shadow-primary/10"
                              >
                                <FileText size={14} className="text-on-primary" />
                                <span>Open File</span>
                              </button>

                              <button
                                onClick={handleOpenFolder}
                                className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-secondary text-on-secondary active:scale-[0.98] transition-all font-semibold text-xs cursor-pointer shadow-md shadow-secondary/10"
                              >
                                <FolderOpen size={14} className="text-on-secondary" />
                                <span>Open Folder</span>
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <TerminalPane
                        isVisible={isTabVisible}
                        sessionId={tab.id}
                        isRunning={isTabActive ? isCommandRunning : undefined}
                      />
                    )}
                  </div>
                );
              })}

              {/* Empty State Overlay — only for terminal tabs */}
              {activeTabId && !interactedSessions.has(activeTabId) && activeTabBlocks.length <= 1 && tabs.find(t => t.id === activeTabId)?.type === "terminal" && (
                <div className="absolute inset-0 flex flex-col items-center justify-center opacity-30 pointer-events-none select-none z-10 pb-12">
                  <Terminal size={48} className="mb-4 text-primary" />
                  <span className="font-label-caps uppercase text-[10px] tracking-widest text-on-surface-variant">
                    Ready for commands or AI prompts
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Terminal command input — conditionally hidden for full-screen CLI apps (alternate buffer) */}
          {activeTabId && tabs.some((t) => t.type === "terminal") && !isAlternateActive && (
            <div
              className="p-3 w-full"
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                window.dispatchEvent(new CustomEvent("aurora-right-click-menu-close"));
                window.dispatchEvent(
                  new CustomEvent("show-context-menu", {
                    detail: { x: e.clientX, y: e.clientY, source: "input" },
                  })
                );
              }}
            >
              <div className="warp-input-glow flex flex-col bg-surface-container-high/20 border border-outline-variant/20 overflow-hidden shadow-2xl rounded-lg">
                <div className="flex items-center px-4 py-1.5 bg-surface-container-high/30 border-b border-outline-variant/10 select-none h-[29px]">
                  {isCwdLoading ? (
                    <span className="text-[10px] text-primary tracking-widest flex items-center gap-1.5 select-none animate-spin pr-1">
                      <RefreshCw size={10} />
                    </span>
                  ) : (
                    <span className="text-[10px] text-outline/50 tracking-widest flex items-center gap-1.5">
                      <FolderOpen size={10} />
                      {cwd}
                    </span>
                  )}
                </div>

                {isCommandRunning ? (
                  /* Running command status bar */
                  <div className="flex items-center justify-between px-4 py-3 bg-surface-container-high/10">
                    <div className="flex items-center gap-2 text-on-surface text-sm">
                      <RefreshCw size={14} className="animate-spin text-primary" />
                      <span className="text-primary">Executing command...</span>
                      <span className="text-outline/50 text-xs">Ctrl + C to cancel</span>
                    </div>
                    <button
                      onClick={handleStopCurrentCommand}
                      className="px-3 py-1.5 text-xs bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg transition-colors cursor-pointer border border-red-500/20"
                      title="Stop Command (Ctrl+C)"
                    >
                      <span className="flex items-center gap-1">
                        <Square size={10} />
                        Stop
                      </span>
                    </button>
                  </div>
                ) : (
                  /* Normal input mode */
                  <div className="flex items-start">
                    <GhostInput
                      sessionId={targetSessionId}
                      value={activeCommandInput}
                      onChange={setCommandInput}
                      onSubmit={handleExecuteCommand}
                      history={[
                        // Current-session commands (highest relevance, newest last → reversed inside GhostInput)
                        ...activeTabBlocks
                          .filter((b) => b.command && b.command !== "init-aurora")
                          .map((b) => b.command as string),
                        ...shellHistory.slice().reverse(),
                      ]}
                      placeholder="Type a command or describe goal..."
                      className="flex-1"
                    />
                    <div className="flex items-center gap-1 pr-3 py-3 self-end">
                      <button
                        type="button"
                        className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface-variant/30 text-outline/50 hover:text-primary transition-all cursor-pointer"
                        title="Add File"
                      >
                        <Plus size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowAiBar(true)}
                        className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface-variant/30 text-outline/50 hover:text-primary transition-all cursor-pointer"
                        title="Ask AI"
                      >
                        <Command size={14} />
                      </button>
                      <button
                        type="button"
                        className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface-variant/30 text-outline/50 hover:text-secondary transition-all cursor-pointer"
                        title="Audio Mode"
                      >
                        <Mic size={14} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* AI overlay Command Bar */}
          {showAiBar && (
            <AICommandBar
              sessionId={activeTabId}
              onClose={() => setShowAiBar(false)}
            />
          )}

        </main>
      </div>
      {/* Save confirmation modal for dirty file tabs */}
      {pendingCloseTabId && (() => {
        const pendingTab = tabs.find(t => t.id === pendingCloseTabId);
        if (!pendingTab || !pendingTab.filePath) return null;
        return (
          <div
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm"
            onClick={() => setPendingCloseTabId(null)}
          >
            <div
              className="bg-surface-container-high border border-outline-variant/20 rounded-xl shadow-2xl w-[420px] overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-5 pt-5 pb-3">
                <h3 className="text-sm font-semibold text-on-surface mb-2">Save changes?</h3>
                <p className="text-xs text-on-surface-variant/80 leading-relaxed">
                  Do you want to save the changes you made to <span className="text-primary font-medium">{pendingTab.name}</span>?
                </p>
                <p className="text-[10px] text-on-surface-variant/50 mt-1">Your changes will be lost if you don't save them.</p>
              </div>
              <div className="flex justify-end gap-2 px-5 pb-4 pt-2">
                <button
                  className="px-3 py-1.5 text-[11px] rounded-lg border border-outline-variant/20 text-on-surface-variant hover:bg-surface-variant/20 transition-colors cursor-pointer"
                  onClick={() => {
                    killSession(pendingCloseTabId);
                    setPendingCloseTabId(null);
                  }}
                >
                  Don't Save
                </button>
                <button
                  className="px-3 py-1.5 text-[11px] rounded-lg text-on-surface-variant hover:bg-surface-variant/20 transition-colors cursor-pointer"
                  onClick={() => setPendingCloseTabId(null)}
                >
                  Cancel
                </button>
                <button
                  className="px-3 py-1.5 text-[11px] rounded-lg bg-primary text-on-primary hover:bg-primary/90 transition-colors cursor-pointer font-semibold"
                  onClick={async () => {
                    const tab = useSessionStore.getState().tabs.find(t => t.id === pendingCloseTabId);
                    if (tab?.fileContent && tab.filePath) {
                      try {
                        await invoke("write_file_content", { path: tab.filePath, content: tab.fileContent });
                      } catch (err) {
                        console.error("Failed to save file:", err);
                      }
                    }
                    killSession(pendingCloseTabId);
                    setPendingCloseTabId(null);
                  }}
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Floating System Settings dashboard */}
      {showSettings && (
        <SettingsModal onClose={() => setShowSettings(false)} />
      )}

      {/* Custom Context Menu */}
      {contextMenu && (
        <RightClickMenuPanel anchorX={contextMenu.x} anchorY={contextMenu.y} open={true}>
          {/* Copy — terminal: copies selection; input: no-op text copy */}
          <RightClickMenuItem icon={<Copy size={14} />} onClick={() => {
            if (contextMenu?.selectedText) {
              navigator.clipboard.writeText(contextMenu.selectedText).catch(console.error);
            } else if (contextMenu?.source === "terminal") {
              window.dispatchEvent(
                new CustomEvent("terminal-copy", { detail: { sessionId: activeTabId } })
              );
            }
            setContextMenu(null);
          }}>
            Copy
          </RightClickMenuItem>
          <RightClickMenuItem icon={<Clipboard size={14} />} onClick={async () => {
            try {
              const text = await navigator.clipboard.readText();
              if (text) setCommandInput((prev) => prev + text);
            } catch (err) {
              console.error("Failed to read from clipboard:", err);
            }
            setContextMenu(null);
          }}>
            Paste
          </RightClickMenuItem>
          {/* Clear Terminal — only shown when right-clicked inside the xterm view */}
          {contextMenu?.source === "terminal" && (
            <>
              <RightClickMenuSeparator />
              <RightClickMenuItem danger icon={<Trash2 size={14} />} onClick={() => {
                if (activeTabId) {
                  window.dispatchEvent(
                    new CustomEvent("terminal-clear", { detail: { sessionId: activeTabId } })
                  );
                  useBlockStore.getState().clearBlocks(activeTabId);
                  setInteractedSessions((prev) => {
                    const next = new Set(prev);
                    next.delete(activeTabId);
                    return next;
                  });
                }
                setContextMenu(null);
              }}>
                Clear Terminal
              </RightClickMenuItem>
            </>
          )}

          {/* Select All — only shown when right-clicked in the file editor */}
          {contextMenu?.source === "file" && (
            <>
              <RightClickMenuSeparator />
              <RightClickMenuItem icon={<Copy size={14} />} onClick={() => {
                if (activeTabId) {
                  window.dispatchEvent(
                    new CustomEvent("file-select-all", { detail: { tabId: activeTabId } })
                  );
                }
                setContextMenu(null);
              }}>
                Select All
              </RightClickMenuItem>
            </>
          )}
        </RightClickMenuPanel>
      )}

      {/* Footer Status pips */}
      <StatusBar cwd={cwdAbsolute} />
    </div>
  );
}

