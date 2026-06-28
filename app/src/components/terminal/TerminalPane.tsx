import { useEffect, useRef, useState, useMemo } from "react";
import { Terminal } from "@xterm/xterm";

import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { useBlockStore } from "../../stores/useBlockStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useSessionStore } from "../../stores/useSessionStore";
import { buildXtermTheme } from "../../lib/xtermTheme";
import { getRowHeight } from "../../lib/terminal/blockAnchors";

import { stripAnsi, cleanPtyData } from "../../lib/terminal/cleanup";
import { pty, system } from "../../lib/ipc";
import { SquareTerminal } from "lucide-react";

interface TerminalPaneProps {
  sessionId: string;
  isVisible: boolean;
  isRunning?: boolean;
}

export const TerminalPane: React.FC<TerminalPaneProps> = ({ sessionId, isVisible }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  
  // Layout context parameters
  const [cwd, setCwd] = useState("~/workspace");
  const cwdRef = useRef(cwd);
  useEffect(() => { cwdRef.current = cwd; }, [cwd]);
  const [isCwdLoading, setIsCwdLoading] = useState(false);
  const [isSessionDead, setIsSessionDead] = useState(false);
  const [sessionExitCode, setSessionExitCode] = useState<number | null>(null);

  // Subscribe only to the runningBlockId of this session to keep execution states in sync
  const runningBlockId = useBlockStore((state) => state.runningBlockId[sessionId]);
  const isCommandRunning = !!runningBlockId;
  const isAlternateActive = useSessionStore((state) => state.alternateBufferActive[sessionId] || false);
  const theme = useSettingsStore((state) => state.theme);
  const fontFamily = useSettingsStore((state) => state.fontFamily);
  const fontSize = useSettingsStore((state) => state.fontSize);

  // Get dynamic cell dimensions
  const [lineHeight, setLineHeight] = useState(19.5);

  // Ref to track the pending resize timer
  const resizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastColsRef = useRef<number>(0);
  const lastRowsRef = useRef<number>(0);
  const lastTransitionTimeRef = useRef<number>(0);

  // Sync transition time on alternate active state change
  useEffect(() => {
    lastTransitionTimeRef.current = Date.now();
  }, [isAlternateActive]);

  // Debounced PTY resize helper to prevent Windows ConPTY deadlocks/crashes from rapid concurrent resizes
  const debouncedResize = useMemo(() => {
    return (cols: number, rows: number) => {
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }
      resizeTimeoutRef.current = setTimeout(() => {
        if (cols > 0 && rows > 0) {
          console.log(`[TerminalPane ${sessionId}] Sending debounced resize: ${cols}x${rows}`);
          pty.resize(sessionId, cols, rows).catch((err) => {
            console.warn("PTY resize failed:", err);
          });
        }
      }, 100);
    };
  }, [sessionId]);

  // Sync theme when dark/light mode switches
  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = buildXtermTheme();
    }
  }, [theme]);

  // Sync font size and family when they change in settings
  useEffect(() => {
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term) return;

    term.options.fontFamily = `'${fontFamily}', Consolas, 'Cascadia Code', Menlo, Monaco, monospace`;
    term.options.fontSize = fontSize;

    // Use a small safety delay to ensure DOM has rendered
    const timer = setTimeout(() => {
      try {
        if (fit && xtermRef.current && xtermRef.current.clientWidth > 0 && xtermRef.current.clientHeight > 0) {
          fit.fit();
          const { cols, rows } = term;
          if (cols > 0 && rows > 0 && (cols !== lastColsRef.current || rows !== lastRowsRef.current)) {
            lastColsRef.current = cols;
            lastRowsRef.current = rows;
            debouncedResize(cols, rows);
          }
        }
        const ch = getRowHeight(term);
        if (ch > 0) setLineHeight(ch);
      } catch (err) {
        console.warn("Font refit failed:", err);
      }
    }, 150);

    return () => clearTimeout(timer);
  }, [fontFamily, fontSize, sessionId, debouncedResize]);

  // When alternate buffer toggles, refit xterm to catch up with the layout change
  useEffect(() => {
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !fit) return;
    requestAnimationFrame(() => {
      try {
        fit.fit();
      } catch {
        // silently ignore
      }
    });
  }, [isAlternateActive]);

  useEffect(() => {
    if (!xtermRef.current) return;

    let isDisposed = false;
    let lastAlternateBufferState = useSessionStore.getState().alternateBufferActive[sessionId] || false;

    const syncAlternateBufferState = (active: boolean) => {
      const currentXtermAlternate = termRef.current?.buffer?.active?.type === "alternate";
      if (lastAlternateBufferState === active && currentXtermAlternate === active) return;

      lastAlternateBufferState = active;
      console.log(`[TerminalPane ${sessionId}] Alternate buffer transition: ${!active} -> ${active}`);
      useSessionStore.getState().setAlternateBufferActive(sessionId, active);

      if (!active && currentXtermAlternate) {
        console.log(`[TerminalPane ${sessionId}] Forcing xterm buffer type to normal`);
        termRef.current?.write("\x1b[?1049l");
      } else if (active && !currentXtermAlternate) {
        console.log(`[TerminalPane ${sessionId}] Forcing xterm buffer type to alternate`);
        termRef.current?.write("\x1b[?1049h");
      }

      // When exiting alternate buffer, ensure any running block is finalized and state cleared.
      if (!active) {
        console.log(`[TerminalPane ${sessionId}] Resetting mouse tracking on alternate buffer exit`);
        termRef.current?.write("\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l");

        const runningId = useBlockStore.getState().runningBlockId[sessionId];
        if (runningId) {
          console.log(`[TerminalPane ${sessionId}] Finalizing running block on alternate buffer exit`);
          useBlockStore.getState().finalizeBlock(sessionId, runningId, 0);
        }
        useBlockStore.getState().setRunningBlockId(sessionId, null);
        useBlockStore.getState().setCommandOutputReceived(sessionId, false);
        // Restore focus to input.
        requestAnimationFrame(() => {
          if (isDisposed) return;
          window.dispatchEvent(
            new CustomEvent("aurora-focus-terminal-input", { detail: { sessionId } })
          );
        });
      }
    };

    // 1. Construct the xterm.js instance
    const term = new Terminal({
      allowProposedApi: true,
      allowTransparency: true,
      scrollback: 10000,
      cursorBlink: false,
      cursorStyle: "bar",
      cursorInactiveStyle: "none",
      cursorWidth: 0,
      theme: buildXtermTheme(),
      disableStdin: true, // Decoupled input
    });

    termRef.current = term;

    // 2. Instantiate addons
    const fit = new FitAddon();
    const search = new SearchAddon();
    const weblinks = new WebLinksAddon();
    fitRef.current = fit;

    term.loadAddon(fit);
    term.loadAddon(search);
    term.loadAddon(weblinks);
    term.open(xtermRef.current);

    // Load WebGL addon for GPU hardware-accelerated rendering
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => {
        console.warn(`[TerminalPane ${sessionId}] WebGL context lost, disposing WebGL addon...`);
        webgl.dispose();
      });
      term.loadAddon(webgl);
      console.log(`[TerminalPane ${sessionId}] WebGL GPU acceleration enabled successfully`);
    } catch (err) {
      console.warn(`[TerminalPane ${sessionId}] WebGL addon failed to load, falling back to standard canvas renderer:`, err);
    }

    // Connect xterm onData to PTY write for interactive sub-processes
    const dataDisposable = term.onData((data) => {
      if (
        useBlockStore.getState().runningBlockId[sessionId] ||
        useSessionStore.getState().alternateBufferActive[sessionId]
      ) {
        pty.write(sessionId, data).catch(console.error);
      }
    });

    const bufferDisposable = term.buffer.onBufferChange((buffer) => {
      const isAlternate = buffer.type === "alternate";
      console.log(`[TerminalPane ${sessionId}] xterm buffer changed to: ${buffer.type} (isAlternate=${isAlternate})`);
      syncAlternateBufferState(isAlternate);
    });

    // Get exact row height from core renderer metrics
    try {
      const core = (term as any)._core;
      const ch = core?.viewport?._rowHeight ?? 19.5;
      if (ch > 0) setLineHeight(ch);
    } catch (_) { }

    try {
      if (xtermRef.current && xtermRef.current.clientWidth > 0 && xtermRef.current.clientHeight > 0) {
        fit.fit();
      }
    } catch (_) { }

    // 4. Hook up ResizeObserver with rAF batching
    let resizeRafId = 0;
    const ro = new ResizeObserver(() => {
      if (isDisposed) return;
      if (resizeRafId) return;
      resizeRafId = requestAnimationFrame(() => {
        resizeRafId = 0;
        if (isDisposed) return;
        const container = xtermRef.current;
        if (!container || !container.clientWidth || !container.clientHeight) return;
        try {
          fit.fit();
          const { cols, rows } = term;
          if (cols > 0 && rows > 0 && (cols !== lastColsRef.current || rows !== lastRowsRef.current)) {
            lastColsRef.current = cols;
            lastRowsRef.current = rows;

            const timeSinceTransition = Date.now() - lastTransitionTimeRef.current;
            const isTransitioning = timeSinceTransition < 500;
            if (isTransitioning) {
              const remainingTime = 500 - timeSinceTransition + 50;
              if ((term as any)._deferredResizeTimer) {
                clearTimeout((term as any)._deferredResizeTimer);
              }
              (term as any)._deferredResizeTimer = setTimeout(() => {
                if (!isDisposed) {
                  debouncedResize(cols, rows);
                }
              }, remainingTime);
            } else {
              if ((term as any)._deferredResizeTimer) {
                clearTimeout((term as any)._deferredResizeTimer);
              }
              debouncedResize(cols, rows);
            }
          }
        } catch (err) {
          console.warn("Resize fit failed:", err);
        }
      });
    });
    ro.observe(xtermRef.current);

    // 5. Connect scroll calculation hooks
    term.onScroll(() => {
      // Coordinate calculations removed
    });

    // 6. Global PTY data stream listener
    let dataBuffer = "";
    let frameId = 0;
    let leftoverBuffer = "";
    let failsafeTimeout: ReturnType<typeof setTimeout> | null = null;

    const flushBuffer = () => {
      if (isDisposed) return;

      if (failsafeTimeout) {
        clearTimeout(failsafeTimeout);
        failsafeTimeout = null;
      }

      try {
        if (leftoverBuffer.length > 2000) {
          console.warn(`[TerminalPane ${sessionId}] Leftover buffer too large (${leftoverBuffer.length} chars). Force flushing.`);
          if (termRef.current) {
            termRef.current.write(leftoverBuffer);
          }
          leftoverBuffer = "";
        }

        if (dataBuffer) {
          let cleanData = leftoverBuffer + dataBuffer;
          leftoverBuffer = "";
          dataBuffer = "";

          const inAlt = useSessionStore.getState().alternateBufferActive[sessionId] || false;

          if (!inAlt) {
            const { cwdValue, cleanData: stripped, exitCode } = cleanPtyData(cleanData);
            cleanData = stripped;

            if (cwdValue) {
              console.log(`[TerminalPane ${sessionId}] Captured shell sentinel: ${cwdValue}`);
              setCwd(cwdValue);
              setIsCwdLoading(false);
              syncAlternateBufferState(false);

              window.dispatchEvent(
                new CustomEvent("cwd-change", { detail: { path: cwdValue, sessionId } })
              );

              const activeId = useBlockStore.getState().runningBlockId[sessionId];
              if (activeId) {
                const finalExitCode = exitCode !== null ? exitCode : 0;
                useBlockStore.getState().finalizeBlock(sessionId, activeId, finalExitCode);
              }
            }
          }

          const lastEsc = cleanData.lastIndexOf("\x1b");
          const lastAurora = cleanData.lastIndexOf("__AURORA_");
          let splitIndex = -1;

          if (lastEsc !== -1 && cleanData.length - lastEsc <= 6) {
            splitIndex = lastEsc;
          }
          if (lastAurora !== -1 && cleanData.indexOf("\n", lastAurora) === -1) {
            if (splitIndex === -1 || lastAurora < splitIndex) {
              splitIndex = lastAurora;
            }
          }

          if (splitIndex !== -1) {
            leftoverBuffer = cleanData.slice(splitIndex);
            cleanData = cleanData.slice(0, splitIndex);

            failsafeTimeout = setTimeout(() => {
              if (leftoverBuffer && !isDisposed) {
                console.warn(`[TerminalPane ${sessionId}] Failsafe triggered: Flushing split prompt buffer after timeout`);
                let failsafeData = leftoverBuffer;
                leftoverBuffer = "";

                const inAltFailsafe = useSessionStore.getState().alternateBufferActive[sessionId] || false;
                if (!inAltFailsafe) {
                  const { cwdValue: failsafeCwdValue, cleanData: failsafeStripped, exitCode: failsafeExitCode } = cleanPtyData(failsafeData);
                  failsafeData = failsafeStripped;

                  if (failsafeCwdValue) {
                    setCwd(failsafeCwdValue);
                    setIsCwdLoading(false);
                    syncAlternateBufferState(false);
                    const activeId = useBlockStore.getState().runningBlockId[sessionId];
                    if (activeId) {
                      const finalExitCode = failsafeExitCode !== null ? failsafeExitCode : 0;
                      useBlockStore.getState().finalizeBlock(sessionId, activeId, finalExitCode);
                    }
                    window.dispatchEvent(
                      new CustomEvent("cwd-change", { detail: { path: failsafeCwdValue, sessionId } })
                    );
                  }
                }

                if (failsafeData && termRef.current) {
                  termRef.current.write(failsafeData);
                }
              }
            }, 250);
          }

          const activeBlockId = useBlockStore.getState().runningBlockId[sessionId];
          if (activeBlockId) {
            const plainChunk = stripAnsi(cleanData);
            useBlockStore.getState().appendBlockOutput(sessionId, activeBlockId, plainChunk);
          }

          if (cleanData && termRef.current) {
            termRef.current.write(cleanData);
          }
        }
      } catch (err) {
        console.error(`[TerminalPane ${sessionId}] Error inside flushBuffer:`, err);
      } finally {
        frameId = 0;
      }
    };

    const handlePtyData = (e: Event) => {
      if (isDisposed) return;
      const chunk = (e as CustomEvent<string>).detail;
      dataBuffer += chunk;
      if (!frameId) {
        frameId = requestAnimationFrame(flushBuffer);
      }
    };

    const handleCommandRun = (e: Event) => {
      if (isDisposed) return;
      const term = termRef.current;
      if (!term || !term.buffer || !term.buffer.active) return;

      term.focus();
      term.options.disableStdin = false;
      term.scrollToBottom();
    };

    const handleTerminalClear = (e: Event) => {
      const { sessionId: targetId } = (e as CustomEvent<{ sessionId: string }>).detail;
      if (targetId !== sessionId) return;
      const term = termRef.current;
      if (term) {
        term.clear();
        term.write("\x1b[3J\x1b[H\x1b[2J");
      }
    };

    const handleTerminalCopy = (e: Event) => {
      const { sessionId: targetId } = (e as CustomEvent<{ sessionId: string }>).detail;
      if (targetId !== sessionId) return;
      const term = termRef.current;
      if (term) {
        const sel = term.getSelection();
        if (sel) {
          navigator.clipboard.writeText(sel).catch(console.error);
        }
      }
    };

    const handleSessionExit = (e: Event) => {
      if (isDisposed) return;
      const code = (e as CustomEvent<number>).detail;
      console.warn(`[TerminalPane ${sessionId}] PTY session exited with code: ${code}`);
      setIsSessionDead(true);
      setSessionExitCode(code);
      if (termRef.current) {
        termRef.current.write("\r\n\x1b[1;31m[Process completed (exit code " + code + ")]\x1b[0m\r\n");
      }
      syncAlternateBufferState(false);
    };

    window.addEventListener(`pty-session-data:${sessionId}`, handlePtyData);
    window.addEventListener(`pty-command-run:${sessionId}`, handleCommandRun as EventListener);
    window.addEventListener(`pty-session-exit:${sessionId}`, handleSessionExit);
    window.addEventListener("terminal-clear", handleTerminalClear);
    window.addEventListener("terminal-copy", handleTerminalCopy);

    system
      .getCurrentPwd()
      .then((path) => {
        if (isDisposed) return;
        if (path) {
          setCwd(path);
        }
      })
      .catch(() => { });

    setTimeout(() => {
      if (isDisposed) return;
      window.dispatchEvent(
        new CustomEvent("aurora-focus-terminal-input", { detail: { sessionId } })
      );
    }, 150);

    return () => {
      isDisposed = true;
      termRef.current = null;
      ro.disconnect();
      if ((term as any)._deferredResizeTimer) {
        clearTimeout((term as any)._deferredResizeTimer);
      }
      try {
        term.dispose();
      } catch (err) {
        console.warn("Failed to dispose terminal cleanly:", err);
      }
      window.removeEventListener(`pty-session-data:${sessionId}`, handlePtyData);
      window.removeEventListener(`pty-command-run:${sessionId}`, handleCommandRun as EventListener);
      window.removeEventListener(`pty-session-exit:${sessionId}`, handleSessionExit);
      window.removeEventListener("terminal-clear", handleTerminalClear);
      window.removeEventListener("terminal-copy", handleTerminalCopy);
      dataDisposable.dispose();
      bufferDisposable.dispose();
      cancelAnimationFrame(frameId);
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }
      if (failsafeTimeout) {
        clearTimeout(failsafeTimeout);
      }
    };
  }, [sessionId, debouncedResize]);

  const handleRestartSession = async () => {
    try {
      setIsSessionDead(false);
      setSessionExitCode(null);

      useSessionStore.getState().setAlternateBufferActive(sessionId, false);
      useBlockStore.getState().setRunningBlockId(sessionId, null);
      useBlockStore.getState().setCommandOutputReceived(sessionId, false);

      window.dispatchEvent(
        new CustomEvent("terminal-session-restart", { detail: { sessionId } })
      );

      if (termRef.current) {
        termRef.current.write("\x1b[?1049l");
        termRef.current.clear();
        termRef.current.write("\x1b[3J\x1b[H\x1b[2J");
      }

      useBlockStore.getState().clearBlocks(sessionId);

      const isWin = window.navigator.userAgent.includes("Windows");
      const defaultShell = isWin ? "powershell.exe" : "bash";
      const args = isWin ? ["-NoLogo"] : [];

      await pty.spawn(defaultShell, args, {}, cwd, sessionId);
      console.log(`[TerminalPane ${sessionId}] Successfully restarted dead PTY session!`);

      setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent("aurora-focus-terminal-input", { detail: { sessionId } })
        );
      }, 150);
    } catch (err) {
      console.error("Failed to restart dead PTY session:", err);
    }
  };

  const handleKeyDownCapture = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (isCommandRunning || isAlternateActive) return;

    const activeEl = document.activeElement;
    if (activeEl?.classList.contains("aurora-ta")) return;

    window.dispatchEvent(
      new CustomEvent("aurora-focus-terminal-input", { detail: { sessionId } })
    );
  };

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;

    const active = isCommandRunning || isAlternateActive;
    term.options.disableStdin = !active;
    if (active) {
      term.focus();
    }
  }, [isCommandRunning, isAlternateActive]);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const term = termRef.current;
    const selectedText = term ? term.getSelection() : "";
    window.dispatchEvent(
      new CustomEvent("show-context-menu", {
        detail: { x: e.clientX, y: e.clientY, selectedText, source: "terminal" },
      })
    );
  };

  return (
    <div
      ref={containerRef}
      onKeyDownCapture={handleKeyDownCapture}
      onContextMenu={handleContextMenu}
      className="relative flex flex-col h-full w-full"
      style={{
        display: isVisible ? "flex" : "none",
        contain: "layout size style",
        isolation: "isolate",
      }}
    >
      {/* ── Terminal Viewer Container ───────────────── */}
      <div className="flex-1 w-full relative select-none bg-transparent overflow-hidden">
        {/* ── Layer 0: xterm canvas mount container ─────────────────────────── */}
        <div
          ref={xtermRef}
          className="w-full h-full pb-3"
        />
      </div>

      {/* ── Glassmorphic Session Terminated Recovery Card ─────────── */}
      {isSessionDead && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/60 backdrop-blur-md z-30 animate-in fade-in duration-200">
          <div className="bg-surface border border-outline-variant/30 rounded-2xl p-6 max-w-sm w-full text-center shadow-2xl flex flex-col items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center text-red-400">
              <SquareTerminal size={20} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-on-surface">Terminal Session Terminated</h3>
              <p className="text-xs text-on-surface-variant/70 mt-1 leading-relaxed">
                The background shell process exited or crashed (exit code {sessionExitCode}).
              </p>
            </div>
            <button
              onClick={handleRestartSession}
              className="py-2 px-4 rounded-xl bg-primary text-on-primary font-semibold text-xs cursor-pointer hover:opacity-90 active:scale-[0.98] transition-all shadow-md shadow-primary/10"
            >
              Restart Session
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
