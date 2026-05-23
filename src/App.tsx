import React, { useEffect, useState, useRef, useLayoutEffect } from "react";
import { FolderOpen, Settings, User, Command, Mic, Plus, Menu, Terminal, Search, Copy, Scissors, Trash2, SplitSquareHorizontal, PanelLeftClose, PanelLeft, SquareTerminal, RefreshCw } from "lucide-react";
import { usePTY } from "./hooks/usePTY";
import { pty } from "./lib/ipc";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useBlockStore } from "./stores/useBlockStore";
import { useSettingsStore } from "./stores/useSettingsStore";
import { useAICompletion } from "./hooks/useAICompletion";
import { useAIStore } from "./stores/useAIStore";
import { TabBar } from "./components/ui/TabBar";
import { SidePanel } from "./components/ui/SidePanel";
import { TerminalPane } from "./components/terminal/TerminalPane";
import { AICommandBar } from "./components/ai/AICommandBar";
import { SettingsModal } from "./components/settings/SettingsModal";
import { StatusBar } from "./components/ui/StatusBar";
import { WindowControls } from "./components/ui/WindowControls";
import { Block } from "./types/block";

export default function App() {
  const { tabs, activeTabId, spawnSession, killSession, setActiveTabId } = usePTY();
  const { blocks, addBlock, updateBlock, setAIExplain, toggleBookmark } = useBlockStore();
  const { mode, setMode } = useSettingsStore();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAiBar, setShowAiBar] = useState(false);
  const [commandInput, setCommandInput] = useState("");
  const [cwd, setCwd] = useState("~/workspace");
  const [cwdAbsolute, setCwdAbsolute] = useState("");
  const [sessionCwds, setSessionCwds] = useState<Record<string, string>>({});
  const [isCwdLoading, setIsCwdLoading] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, selectedText?: string } | null>(null);
  const [adjustedPos, setAdjustedPos] = useState<{ x: number, y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!contextMenu) {
      setAdjustedPos(null);
      return;
    }
    const menuEl = menuRef.current;
    if (!menuEl) return;

    const rect = menuEl.getBoundingClientRect();
    const menuWidth = rect.width || 200;
    const menuHeight = rect.height || 180;

    const screenWidth = window.innerWidth;
    const screenHeight = window.innerHeight;

    let targetX = contextMenu.x;
    let targetY = contextMenu.y;

    if (targetX + menuWidth > screenWidth) {
      targetX = Math.max(8, screenWidth - menuWidth - 8);
    }
    if (targetY + menuHeight > screenHeight) {
      targetY = Math.max(8, screenHeight - menuHeight - 8);
    }

    setAdjustedPos({ x: targetX, y: targetY });
  }, [contextMenu]);

  const [interactedSessions, setInteractedSessions] = useState<Set<string>>(new Set());
  const hasSpawnedRef = useRef(false);
  const hasHadTabsRef = useRef(false);

  // Initialize AI token receiver hooks
  useAICompletion();

  // Spawns default shell on startup
  useEffect(() => {
    if (hasSpawnedRef.current) return;
    hasSpawnedRef.current = true;

    // Fetch initial workspace directory
    invoke<string>("get_cwd").then(dir => {
      setCwdAbsolute(dir);
      const parts = dir.split(/[\\/]/);
      setCwd("~/" + (parts[parts.length - 1] || dir));

      const isWin = window.navigator.userAgent.includes("Windows");
      const defaultShell = isWin ? "powershell.exe" : "bash";
      const promptCmd = `function prompt { $cwd = $ExecutionContext.SessionState.Path.CurrentLocation; $branch = (git branch --show-current 2>$null); "__AURORA_CWD__=$cwd" + [char]13 + [char]10 + "__AURORA_BRANCH__=$branch" + [char]13 + [char]10 + "PS> " }; Clear-Host`;
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
        };
        addBlock(sessionId, initBlock);
      }).catch(console.error);
    }).catch(console.error);

    // Capture global keyboard overrides
    const handleToggleCommandPalette = () => {
      setShowSettings((prev) => !prev);
    };

    const handleToggleAiBar = () => {
      setShowAiBar((prev) => !prev);
    };

    const handleShowContextMenu = (e: Event) => {
      const { x, y, selectedText } = (e as CustomEvent<{ x: number; y: number; selectedText?: string }>).detail;
      setContextMenu({ x, y, selectedText });
    };

    window.addEventListener("toggle-command-palette", handleToggleCommandPalette);
    window.addEventListener("toggle-ai-bar", handleToggleAiBar);
    window.addEventListener("show-context-menu", handleShowContextMenu);

    return () => {
      window.removeEventListener("toggle-command-palette", handleToggleCommandPalette);
      window.removeEventListener("toggle-ai-bar", handleToggleAiBar);
      window.removeEventListener("show-context-menu", handleShowContextMenu);
    };
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
    };
    window.addEventListener("cwd-change", handler);
    return () => window.removeEventListener("cwd-change", handler);
  }, [activeTabId]);

  // Update active tab CWD when activeTabId or sessionCwds changes
  useEffect(() => {
    if (!activeTabId) return;
    const currentPath = sessionCwds[activeTabId];
    if (currentPath) {
      setCwdAbsolute(currentPath);
      const parts = currentPath.split(/[\/\\]/);
      setCwd("~/" + (parts[parts.length - 1] || currentPath));
    }
  }, [activeTabId, sessionCwds]);

  // Helper uuid generator
  const uuidv4 = () => {
    return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
      (+c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (+c / 4)))).toString(16)
    );
  };

  const handleExecuteCommand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commandInput.trim() || !activeTabId) return;

    const cmd = commandInput;
    setCommandInput("");

    // Create a new block metadata in useBlockStore to track history
    const blockId = uuidv4();
    const newBlock: Block = {
      id: blockId,
      session_id: activeTabId,
      command: cmd,
      started_at: Date.now(),
      status: "running",
      output_type: "plain",
      collapsed: false,
      bookmarked: false,
      output_summary: "",
    };

    // Track executing block in blockStore
    useBlockStore.getState().setRunningBlockId(activeTabId, blockId);
    addBlock(activeTabId, newBlock);

    // Send command directly to background PTY shell for execution
    try {
      setInteractedSessions((prev) => new Set(prev).add(activeTabId));

      // Notify TerminalPane about command run
      window.dispatchEvent(
        new CustomEvent(`pty-command-run:${activeTabId}`, { detail: { cmd } })
      );

      await pty.write(activeTabId, cmd + "\r\n");

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
          pty.write(activeTabId, echoCmd).catch(console.error);
        }, 150);
      }
    } catch (err) {
      console.error("Failed to write command to shell:", err);
      // Mark command block as failed
      updateBlock(activeTabId, blockId, {
        status: "error",
        finished_at: Date.now(),
        output_summary: `Error writing command to shell: ${err}`,
      });
      useBlockStore.getState().setRunningBlockId(activeTabId, null);
    }
  };

  const activeTabBlocks = activeTabId ? blocks[activeTabId] || [] : [];

  return (
    <div
      className="bg-background text-on-surface font-body-base overflow-hidden h-screen flex flex-col select-none"
      onContextMenu={(e) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY });
      }}
      onClick={() => setContextMenu(null)}
    >

      {/* Sleek Stitch Header with custom drag region and system window pips */}
      <header
        data-tauri-drag-region
        className="flex justify-between items-center w-full px-4 h-toolbar-height bg-surface-container-lowest border-b border-outline-variant/5 z-50 shadow-sm select-none"
      >
        <div data-tauri-no-drag className="flex items-center gap-2 h-full">
          <button
            data-tauri-no-drag
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="p-2 hover:bg-surface-variant/30 rounded-lg transition-colors text-on-surface-variant cursor-pointer"
            title="Toggle Sidebar"
          >
            {sidebarCollapsed
              ? <PanelLeft size={16} />
              : <PanelLeftClose size={16} />
            }
          </button>
          <div className="flex items-center gap-1 ml-1">
            <button data-tauri-no-drag className="p-2 hover:text-on-surface-variant bg-surface hover:bg-surface-bright/60 rounded-md transition-colors text-on-surface-variant/70 cursor-pointer" title="Folder View">
              <SquareTerminal size={14} />
            </button>
            <button data-tauri-no-drag className="p-2 hover:text-on-surface-variant bg-surface hover:bg-surface-bright/60 rounded-md transition-colors text-on-surface-variant/70 cursor-pointer" title="Folder View">
              <FolderOpen size={14} />
            </button>
            <button data-tauri-no-drag className="p-2 hover:text-on-surface-variant bg-surface hover:bg-surface-bright/60 rounded-md transition-colors text-on-surface-variant/70 cursor-pointer" title="Folder View">
              <Command size={14} />
            </button>
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
              className="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-xl h-8 pl-9 pr-4 text-code-sm font-code-sm placeholder:text-outline/40 outline-none input-glow transition-all shadow-inner"
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
        <SidePanel collapsed={sidebarCollapsed} cwd={cwdAbsolute} />

        {/* Terminal Workspace area */}
        <main className="flex-1 flex flex-col min-w-0 bg-surface-container-low overflow-hidden relative">

          {/* Safari Tab Bar */}
          <TabBar
            onAddTab={async () => {
              const isWin = window.navigator.userAgent.includes("Windows");
              const defaultShell = isWin ? "powershell.exe" : "bash";
              const promptCmd = `function prompt { $cwd = $ExecutionContext.SessionState.Path.CurrentLocation; $branch = (git branch --show-current 2>$null); "__AURORA_CWD__=$cwd" + [char]13 + [char]10 + "__AURORA_BRANCH__=$branch" + [char]13 + [char]10 + "PS> " }; Clear-Host`;
              const args = isWin ? ["-NoLogo", "-NoExit", "-Command", promptCmd] : [];
              try {
                const sessionId = await spawnSession(defaultShell, args, {}, cwdAbsolute);
                setSessionCwds((prev) => ({ ...prev, [sessionId]: cwdAbsolute }));
              } catch (err) {
                console.error("Failed to spawn session:", err);
              }
            }}
            onKillTab={(id) => killSession(id)}
          />

          {/* Terminal output area (Full Height) */}
          <div className="flex-1 overflow-hidden px-6 md:px-12 lg:px-20 max-w-6xl mx-auto w-full flex flex-col relative pt-6">
            {/* Single Xterm Pane (Mounts all but only shows active) */}
            <div className="flex-1 min-h-0 w-full relative">
              {tabs.map((tab) => {
                const isTabActive = tab.id === activeTabId;
                const hasInteracted = interactedSessions.has(tab.id);
                const isTabVisible = isTabActive && hasInteracted;

                return (
                  <div
                    key={tab.id}
                    className="absolute inset-0"
                    style={{
                      visibility: isTabVisible ? "visible" : "hidden",
                      pointerEvents: isTabVisible ? "auto" : "none",
                      zIndex: isTabVisible ? 10 : 0
                    }}
                  >
                    <TerminalPane
                      isVisible={isTabVisible}
                      sessionId={tab.id}
                    />
                  </div>
                );
              })}

              {/* Empty State Overlay */}
              {activeTabId && !interactedSessions.has(activeTabId) && activeTabBlocks.length <= 1 && (
                <div className="absolute inset-0 flex flex-col items-center justify-center opacity-30 pointer-events-none select-none z-10 pb-12">
                  <Terminal size={48} className="mb-4 text-primary" />
                  <span className="font-label-caps uppercase text-[10px] tracking-widest text-on-surface-variant">
                    Ready for commands or AI prompts
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Warp-Style Glowing Command input */}
          <div className="p-6 md:px-12 lg:px-20 max-w-6xl mx-auto w-full">
            <div className="warp-input-glow flex flex-col bg-surface-container-high/20 border border-outline-variant/20 transition-all overflow-hidden shadow-2xl rounded-lg">
              <div className="flex items-center px-4 py-1.5 bg-surface-container-high/30 border-b border-outline-variant/10 select-none h-[29px]">
                {isCwdLoading ? (
                  <span className="text-[10px] font-code-sm text-primary tracking-widest flex items-center gap-1.5 select-none animate-spin pr-1">
                    <RefreshCw size={10} />
                  </span>
                ) : (
                  <span className="text-[10px] font-code-sm text-outline/50 tracking-widest flex items-center gap-1.5">
                    <FolderOpen size={10} />
                    {cwd}
                  </span>
                )}
              </div>

              <form onSubmit={handleExecuteCommand} className="flex items-center">
                <input
                  type="text"
                  value={commandInput}
                  onChange={(e) => setCommandInput(e.target.value)}
                  placeholder="Type a command or describe goal..."
                  className="flex-1 bg-transparent border-none focus:ring-0 text-body-base font-code-base h-12 px-5 placeholder:text-outline/30 outline-none text-on-surface"
                />
                <div className="flex items-center gap-1 pr-3">
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
              </form>
            </div>
          </div>

          {/* AI overlay Command Bar */}
          {showAiBar && (
            <AICommandBar
              sessionId={activeTabId}
              onClose={() => setShowAiBar(false)}
            />
          )}

        </main>
      </div>

      {/* Floating System Settings dashboard */}
      {showSettings && (
        <SettingsModal onClose={() => setShowSettings(false)} />
      )}

      {/* Custom Context Menu */}
      {contextMenu && (
        <div
          ref={menuRef}
          onMouseDown={(e) => e.preventDefault()}
          className="fixed z-50 min-w-[200px] glass-panel border border-outline-variant/20 rounded-xl shadow-2xl py-1 overflow-hidden"
          style={{
            top: adjustedPos ? adjustedPos.y : contextMenu.y,
            left: adjustedPos ? adjustedPos.x : contextMenu.x,
            opacity: adjustedPos ? 1 : 0,
            visibility: adjustedPos ? "visible" : "hidden"
          }}
        >
          <button
            onClick={() => {
              if (contextMenu.selectedText) {
                navigator.clipboard.writeText(contextMenu.selectedText).catch(console.error);
              } else {
                window.dispatchEvent(
                  new CustomEvent("terminal-copy", { detail: { sessionId: activeTabId } })
                );
              }
              setContextMenu(null);
            }}
            className="w-full flex items-center gap-3 px-3 py-2 text-[13px] hover:bg-surface-variant/30 text-on-surface transition-colors text-left group"
          >
            <Copy size={14} className="text-outline/70 group-hover:text-primary transition-colors" />
            Copy
          </button>
          <button
            onClick={async () => {
              try {
                const text = await navigator.clipboard.readText();
                if (text) {
                  setCommandInput((prev) => prev + text);
                }
              } catch (err) {
                console.error("Failed to read from clipboard:", err);
              }
              setContextMenu(null);
            }}
            className="w-full flex items-center gap-3 px-3 py-2 text-[13px] hover:bg-surface-variant/30 text-on-surface transition-colors text-left group"
          >
            <Scissors size={14} className="text-outline/70 group-hover:text-primary transition-colors" />
            Paste
          </button>
          <div className="h-px bg-outline-variant/20 my-1 mx-2" />
          <button
            onClick={() => {
              if (activeTabId) {
                window.dispatchEvent(
                  new CustomEvent("terminal-clear", { detail: { sessionId: activeTabId } })
                );
                useBlockStore.getState().clearBlocks(activeTabId);
              }
              setContextMenu(null);
            }}
            className="w-full flex items-center gap-3 px-3 py-2 text-[13px] hover:bg-red-500/10 text-red-400 transition-colors text-left group"
          >
            <Trash2 size={14} className="text-red-400/70 group-hover:text-red-400 transition-colors" />
            Clear Terminal
          </button>
        </div>
      )}

      {/* Footer Status pips */}
      <StatusBar />
    </div>
  );
}
