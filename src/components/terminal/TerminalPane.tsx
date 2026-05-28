import { useEffect, useRef, useState, startTransition, useMemo } from "react";
import { Terminal } from "@xterm/xterm";

import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { useBlockStore } from "../../stores/useBlockStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useSessionStore } from "../../stores/useSessionStore";
import { buildXtermTheme } from "../../lib/xtermTheme";
import { recalculateAnchors, getRowHeight } from "../../lib/terminal/blockAnchors";

import { TerminalBlock } from "./TerminalBlock";
import { pty, system } from "../../lib/ipc";
import { SquareTerminal } from "lucide-react";
import { Block } from "../../types/block";

const EMPTY_BLOCKS: Block[] = [];

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
  const branchRef = useRef<string | null>(null);

  // Read registered blocks for this session from state
  const sessionBlocks = useBlockStore((state) => state.blocks[sessionId] || EMPTY_BLOCKS);
  const runningBlockId = useBlockStore((state) => state.runningBlockId[sessionId]);
  const isCommandRunning = !!runningBlockId;
  const isAlternateActive = useSessionStore((state) => state.alternateBufferActive[sessionId] || false);
  const theme = useSettingsStore((state) => state.theme);
  const fontFamily = useSettingsStore((state) => state.fontFamily);
  const fontSize = useSettingsStore((state) => state.fontSize);

  // Get dynamic cell dimensions to verify layout alignments
  const [lineHeight, setLineHeight] = useState(19.5);

  // Ref to track the pending resize timer to enable cleanups across renders
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
      }, 100); // 100ms debounce ensures ConPTY stability during buffer/padding/font transitions
    };
  }, [sessionId]);

  // Recalculate anchors and update store inside transition boundaries
  const recalc = useMemo(() => {
    let debounceTimer: ReturnType<typeof setTimeout>;
    return () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const term = termRef.current;
        if (!term || !(term as any)._core || !term.buffer) return;
        const anchors = recalculateAnchors(term, sessionId);
        startTransition(() => {
          useBlockStore.getState().setAnchorY(sessionId, anchors);
        });
      }, 16); // Throttled to ~60fps
    };
  }, [sessionId]);

  // Sync theme when dark/light mode switches
  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = buildXtermTheme();
    }
  }, [theme]);

  // Sync font size and family when they change in settings (but NOT dynamically on command run/exit!)
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
        // Re-measure exact row height for dynamic overlay positioning
        const ch = getRowHeight(term);
        if (ch > 0) setLineHeight(ch);
        recalc();
      } catch (err) {
        console.warn("Font refit failed:", err);
      }
    }, 150);

    return () => clearTimeout(timer);
  }, [fontFamily, fontSize, sessionId, recalc, debouncedResize]);

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
        // Force-reset all active mouse tracking protocols to restore standard canvas drag selection
        console.log(`[TerminalPane ${sessionId}] Resetting mouse tracking on alternate buffer exit`);
        termRef.current?.write("\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l");

        const runningId = useBlockStore.getState().runningBlockId[sessionId];
        if (runningId) {
          console.log(`[TerminalPane ${sessionId}] Finalizing running block on alternate buffer exit`);
          useBlockStore.getState().finalizeBlock(sessionId, runningId, 0);
        }
        // Clear running block state and command output flag.
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
      disableStdin: true, // Decoupled input: disable direct keyboard inputs on xterm canvas
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

      // Delegate all synchronization and cleanup logic to syncAlternateBufferState.
      syncAlternateBufferState(isAlternate);
    });

    // Get exact row height from core renderer metrics
    try {
      const core = (term as any)._core;
      const ch = core?.viewport?._rowHeight ?? 19.5;
      if (ch > 0) setLineHeight(ch);
    } catch (_) { }

    // Try to fit, but ignore failures if dimensions are not available yet (e.g. during initial mount display:none)
    try {
      if (xtermRef.current && xtermRef.current.clientWidth > 0 && xtermRef.current.clientHeight > 0) {
        fit.fit();
      }
    } catch (_) { }
    recalc();

    // 4. Hook up ResizeObserver to recalculate character cells on container changes
    const ro = new ResizeObserver(() => {
      if (isDisposed) return;
      const container = xtermRef.current;
      if (!container || !container.clientWidth || !container.clientHeight) return;
      try {
        fit.fit();
        const { cols, rows } = term;
        if (cols > 0 && rows > 0 && (cols !== lastColsRef.current || rows !== lastRowsRef.current)) {
          lastColsRef.current = cols;
          lastRowsRef.current = rows;

          // Skip PTY resizes during the critical alternate buffer transition window (500ms)
          // and defer them to after the window to avoid ConPTY deadlocks while maintaining perfect sizing.
          const timeSinceTransition = Date.now() - lastTransitionTimeRef.current;
          const isTransitioning = timeSinceTransition < 500;
          if (isTransitioning) {
            console.log(`[TerminalPane ${sessionId}] Deferring PTY resize during transition window: ${cols}x${rows}`);
            const remainingTime = 500 - timeSinceTransition + 50; // add 50ms safety margin
            if ((term as any)._deferredResizeTimer) {
              clearTimeout((term as any)._deferredResizeTimer);
            }
            (term as any)._deferredResizeTimer = setTimeout(() => {
              if (!isDisposed) {
                console.log(`[TerminalPane ${sessionId}] Running deferred PTY resize: ${cols}x${rows}`);
                debouncedResize(cols, rows);
              }
            }, remainingTime);
          } else {
            if ((term as any)._deferredResizeTimer) {
              clearTimeout((term as any)._deferredResizeTimer);
            }
            debouncedResize(cols, rows);
          }
          recalc();
        }
      } catch (err) {
        console.warn("Resize fit failed:", err);
      }
    });
    ro.observe(xtermRef.current);

    // 5. Connect scroll calculation hooks
    term.onScroll(() => {
      if (isDisposed) return;
      recalc();
    });

    // 6. Global PTY data stream listener
    let dataBuffer = "";
    let frameId = 0;
    let leftoverBuffer = ""; // To catch sequences split across chunks
    let failsafeTimeout: ReturnType<typeof setTimeout> | null = null;

    const flushBuffer = () => {
      if (isDisposed) return;

      // Clear any pending failsafe timeout
      if (failsafeTimeout) {
        clearTimeout(failsafeTimeout);
        failsafeTimeout = null;
      }

      try {
        // Failsafe: if leftoverBuffer gets too large, force flush it to prevent infinite hang
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



          // Parse workspace CWD sentinels — hide them from terminal output
          // Only parse sentinels if we are NOT inside the alternate screen buffer (TUI running).
          // This prevents files being edited in vim/nano containing sentinel strings from resetting the prompt mode and sidepanel.
          const inAlt = useSessionStore.getState().alternateBufferActive[sessionId] || false;
          let foundSentinel = false;

          if (!inAlt) {
            const sentinelRegex = /__AURORA_CWD__=([^\r\n]+)(?:\r?\n|$)/g;
            let sMatch;
            while ((sMatch = sentinelRegex.exec(cleanData)) !== null) {
              let path = sMatch[1].trim();
              path = path.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, "");
              path = path.replace(/\[K$/, "").trim();

              console.log(`[TerminalPane ${sessionId}] Captured shell sentinel: ${path}`);
              foundSentinel = true;
              setCwd(path);
              setIsCwdLoading(false);

              // Force UI transition out of full-screen/alternate mode if we're at a prompt
              syncAlternateBufferState(false);

              window.dispatchEvent(
                new CustomEvent("cwd-change", { detail: { path, sessionId } })
              );
            }

            // Parse workspace branch sentinels
            const branchRegex = /__AURORA_BRANCH__=([^\r\n]*)(?:\r?\n|$)/g;
            let bMatch;
            while ((bMatch = branchRegex.exec(cleanData)) !== null) {
              let branchName = bMatch[1].trim();
              branchName = branchName.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, "");
              branchName = branchName.replace(/\[K$/, "").trim();
              branchRef.current = branchName || null;
              console.log(`[TerminalPane ${sessionId}] Captured branch sentinel: ${branchName}`);
            }

            // If we found a sentinel but a block is still marked as running, it might mean 
            // the terminal doesn't support OSC 133 D. We should finalize it here as a fallback.
            if (foundSentinel) {
              const activeId = useBlockStore.getState().runningBlockId[sessionId];
              if (activeId) {
                console.log(`[TerminalPane ${sessionId}] Finalizing block via prompt sentinel fallback`);
                useBlockStore.getState().finalizeBlock(sessionId, activeId, 0);
              }
            }
          }

          // Strip automated sentinel echoes (e.g. from manual cd commands)
          cleanData = cleanData.replace(
            /(?:\r?\n)?.*(?:Write-Host|echo)\s+["\x27]?__AURORA_[A-Z_]+__[^\r\n]*/g,
            ""
          );

          // Strip PowerShell prompts and continuation symbols (PS>, >>, etc.)
          cleanData = cleanData.replace(/^\r?PS\s*>\s*/gm, "");  // Strip "PS> " at line start (optional \r prefix)
          cleanData = cleanData.replace(/^\r?>+\s*/gm, "");    // Strip continuation prompts ("> ", ">> ", etc.) — optional \r prefix for PSReadLine
          cleanData = cleanData.replace(/^\r?>+\s*$/gm, "");   // Strip any remaining prompt-only lines

          // Strip individual sentinel lines cleanly from output so they don't print to screen
          cleanData = cleanData.replace(/(?:\r?\n)?__AURORA_PROMPT_START__[^\r\n]*/g, "");
          cleanData = cleanData.replace(/(?:\r?\n)?__AURORA_CWD__[^\r\n]*/g, "");
          cleanData = cleanData.replace(/(?:\r?\n)?__AURORA_BRANCH__[^\r\n]*/g, "");
          cleanData = cleanData.replace(/(?:\r?\n)?__AURORA_PROMPT_END__[^\r\n]*/g, "");

          // Standard OSC 133 sequences logic
          const osc133Regex = /\x1b\]133;([A-D])(?:;(\d+))?\x07/g;
          let match;
          while ((match = osc133Regex.exec(cleanData)) !== null) {
            const [, code, arg] = match;
            const currentProgressId = useBlockStore.getState().runningBlockId[sessionId];
            if (code === "D" && currentProgressId) {
              const codeNum = parseInt(arg || "0", 10);
              useBlockStore.getState().finalizeBlock(sessionId, currentProgressId, codeNum);
            }
          }

          // Check if we ended with a partial sequence to preserve for next chunk
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

            // Failsafe: if we buffered a partial prompt, schedule a force-flush in 250ms
            failsafeTimeout = setTimeout(() => {
              if (leftoverBuffer && !isDisposed) {
                console.warn(`[TerminalPane ${sessionId}] Failsafe triggered: Flushing split prompt buffer after timeout`);
                let failsafeData = leftoverBuffer;
                leftoverBuffer = "";

                // Parse CWD and finalize block in failsafe data if found
                const inAltFailsafe = useSessionStore.getState().alternateBufferActive[sessionId] || false;
                if (!inAltFailsafe) {
                  const failsafeCwdMatch = /__AURORA_CWD__=([^\r\n]+)(?:\r?\n|$)/.exec(failsafeData);
                  if (failsafeCwdMatch) {
                    let path = failsafeCwdMatch[1].trim();
                    path = path.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, "");
                    path = path.replace(/\[K$/, "").trim();
                    setCwd(path);
                    setIsCwdLoading(false);
                    syncAlternateBufferState(false);
                    const activeId = useBlockStore.getState().runningBlockId[sessionId];
                    if (activeId) {
                      useBlockStore.getState().finalizeBlock(sessionId, activeId, 0);
                    }
                    window.dispatchEvent(
                      new CustomEvent("cwd-change", { detail: { path, sessionId } })
                    );
                  }

                  // Parse branch in failsafe data if found
                  const failsafeBranchMatch = /__AURORA_BRANCH__=([^\r\n]*)(?:\r?\n|$)/.exec(failsafeData);
                  if (failsafeBranchMatch) {
                    let branchName = failsafeBranchMatch[1].trim();
                    branchName = branchName.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, "");
                    branchName = branchName.replace(/\[K$/, "").trim();
                    branchRef.current = branchName || null;
                  }
                }

                // Strip PowerShell prompt symbols and sentinel lines from failsafe data
                failsafeData = failsafeData.replace(/^\r?>+\s*/gm, "");
                failsafeData = failsafeData.replace(/^\r?>+\s*$/gm, "");
                failsafeData = failsafeData.replace(/(?:\r?\n)?__AURORA_PROMPT_START__[^\r\n]*/g, "");
                failsafeData = failsafeData.replace(/(?:\r?\n)?__AURORA_CWD__[^\r\n]*/g, "");
                failsafeData = failsafeData.replace(/(?:\r?\n)?__AURORA_BRANCH__[^\r\n]*/g, "");
                failsafeData = failsafeData.replace(/(?:\r?\n)?__AURORA_PROMPT_END__[^\r\n]*/g, "");

                if (failsafeData && termRef.current) {
                  termRef.current.write(failsafeData);
                }
                recalc();
              }
            }, 250);
          }

          // Clean boundary sequences before feed
          cleanData = cleanData.replace(/\x1b\]133;[^\x07]*\x07/g, "");

          // Keep block summary records populated
          const activeBlockId = useBlockStore.getState().runningBlockId[sessionId];
          if (activeBlockId) {
            const plainChunk = cleanData.replace(
              /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
              ""
            );
            useBlockStore.getState().appendBlockOutput(sessionId, activeBlockId, plainChunk);

            if (termRef.current) {
              const activeBuffer = termRef.current.buffer?.active;
              if (activeBuffer) {
                const currentCursorRow = activeBuffer.cursorY + activeBuffer.baseY;
                useBlockStore.getState().updateBlock(sessionId, activeBlockId, {
                  output_row_end: Math.max(currentCursorRow + 1, activeBuffer.baseY + termRef.current.rows),
                });
              }
            }
          }

          if (cleanData && termRef.current) {
            termRef.current.write(cleanData);
          }
          recalc();
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
      // const { cmd } = (e as CustomEvent<{ cmd: string }>).detail;
      const term = termRef.current;
      if (!term || !term.buffer || !term.buffer.active) return;

      // Print thin full-width horizontal divider between commands using UI color
      const E = "\x1b";

      // Determine a suitable color from CSS variables (fallback to gray)
      const cssColor = (typeof window !== "undefined")
        ? getComputedStyle(document.documentElement).getPropertyValue("--color-ui-border")
        : "";
      const parseColor = (s: string) => {
        const str = (s || "").trim();
        if (!str) return null;
        if (str.startsWith("#")) {
          const hex = str.replace("#", "");
          if (hex.length === 6) {
            return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16) };
          }
        }
        const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(str);
        if (m) return { r: +m[1], g: +m[2], b: +m[3] };
        return null;
      };

      const rgb = parseColor(cssColor) || { r: 128, g: 128, b: 128 };
      const colorSeq = `${E}[38;2;${rgb.r};${rgb.g};${rgb.b}m`;
      const cols = (term.cols && term.cols > 0) ? term.cols : 80;
      const line = "─".repeat(Math.max(cols, 1));
      const divider = `\r\n\r\n${colorSeq}${line}${E}[0m\r\n\r\n`;
      term.write(divider);

      // Print the custom styled command header: folder (branch) > 
      const folder = cwdRef.current.split(/[\/\\]/).filter(Boolean).pop() || cwdRef.current;
      const branchStr = branchRef.current ? ` ${E}[1;32m(${branchRef.current})${E}[0m` : "";
      const prefix = `${E}[1;36m${folder}${E}[0m${branchStr} ${E}[1;33m>${E}[0m `;
      term.write(prefix);
      term.scrollToBottom();

      // Transfer focus from GhostInput to xterm so interactive CLI tools
      // receive keystrokes (arrows, letters, etc.) via onData → pty.write.
      // Must also enable stdin immediately — the React effect may lag behind.
      term.focus();
      term.options.disableStdin = false;

      const cursorRow = term.buffer.active.cursorY + term.buffer.active.baseY;
      console.log(`[TerminalPane ${sessionId}] Command run captured. Cursor row: ${cursorRow}`);

      const runningId = useBlockStore.getState().runningBlockId[sessionId];
      if (runningId) {
        useBlockStore.getState().updateBlock(sessionId, runningId, {
          anchor_row: cursorRow,
          output_row_end: cursorRow + 1,
        });
        recalc();
      }
    };

    const handleTerminalClear = (e: Event) => {
      const { sessionId: targetId } = (e as CustomEvent<{ sessionId: string }>).detail;
      if (targetId !== sessionId) return;
      const term = termRef.current;
      if (term) {
        term.clear();
        term.write("\x1b[3J\x1b[H\x1b[2J"); // Wipes screen & scrollback fully, homes cursor
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

    // Subscriptions
    window.addEventListener(`pty-session-data:${sessionId}`, handlePtyData);
    window.addEventListener(`pty-command-run:${sessionId}`, handleCommandRun as EventListener);
    window.addEventListener(`pty-session-exit:${sessionId}`, handleSessionExit);
    window.addEventListener("terminal-clear", handleTerminalClear);
    window.addEventListener("terminal-copy", handleTerminalCopy);

    // Initial folder read
    system
      .getCurrentPwd()
      .then((path) => {
        if (isDisposed) return;
        if (path) {
          setCwd(path);
        }
      })
      .catch(() => { });

    // Focus global input bar by default
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
  }, [sessionId, recalc, debouncedResize]);

  const handleRestartSession = async () => {
    try {
      setIsSessionDead(false);
      setSessionExitCode(null);

      // Force-reset alternate buffer and execution states
      useSessionStore.getState().setAlternateBufferActive(sessionId, false);
      useBlockStore.getState().setRunningBlockId(sessionId, null);
      useBlockStore.getState().setCommandOutputReceived(sessionId, false);

      // Notify the parent App component to reset session interaction state
      window.dispatchEvent(
        new CustomEvent("terminal-session-restart", { detail: { sessionId } })
      );

      if (termRef.current) {
        termRef.current.write("\x1b[?1049l"); // Force exit alternate screen buffer
        termRef.current.clear();
        termRef.current.write("\x1b[3J\x1b[H\x1b[2J"); // Wipes screen & scrollback fully
      }

      // Purge session blocks
      useBlockStore.getState().clearBlocks(sessionId);

      // Respawn process under same session_id!
      const isWin = window.navigator.userAgent.includes("Windows");
      const defaultShell = isWin ? "powershell.exe" : "bash";
      const promptCmd = `function prompt { $cwd = $ExecutionContext.SessionState.Path.CurrentLocation; $branch = (git branch --show-current 2>$null); "__AURORA_PROMPT_START__" + [char]13 + [char]10 + "__AURORA_CWD__=$cwd" + [char]13 + [char]10 + "__AURORA_BRANCH__=$branch" + [char]13 + [char]10 + "__AURORA_PROMPT_END__"; return ' ' }; Clear-Host`;
      const args = isWin ? ["-NoLogo", "-NoExit", "-Command", promptCmd] : [];

      await pty.spawn(defaultShell, args, {}, cwd, sessionId);
      console.log(`[TerminalPane ${sessionId}] Successfully restarted dead PTY session!`);

      // Request focus on bottom command input
      setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent("aurora-focus-terminal-input", { detail: { sessionId } })
        );
      }, 150);
    } catch (err) {
      console.error("Failed to restart dead PTY session:", err);
    }
  };

  // Forward keystrokes to global inputBar editor
  const handleKeyDownCapture = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // If a command is running or alternate buffer is active, let keystrokes flow naturally into xterm.
    if (isCommandRunning || isAlternateActive) return;

    // Escape standard propagation if scrolling or typing in input bar
    const activeEl = document.activeElement;
    if (activeEl?.classList.contains("aurora-ta")) return;

    // Focus global input bar
    window.dispatchEvent(
      new CustomEvent("aurora-focus-terminal-input", { detail: { sessionId } })
    );
  };

  // Dynamically toggle disableStdin based on command execution state and buffer swap states.
  // Also focus xterm to redirect keystrokes away from GhostInput during interactive CLI tools.
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
      {/* ── Terminal Viewer Container (positioned context for layers) ───────────────── */}
      <div className="flex-1 w-full relative select-none bg-transparent">
        {/* ── Layer 0: xterm canvas mount container ─────────────────────────── */}
        <div
          ref={xtermRef}
          className="w-full h-full"
        />

        {/* ── Layer 1: GPU composited React block overlays ─────────────────────── */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            zIndex: 1,
            willChange: "transform",
            transform: "translateZ(0)",
          }}
        >
          {!isAlternateActive && sessionBlocks.map((block) => (
            <TerminalBlock key={block.id} sessionId={sessionId} block={block} />
          ))}
        </div>
      </div>

      {/* ── Layer 2: Glassmorphic Session Terminated Recovery Card ─────────── */}
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
}


