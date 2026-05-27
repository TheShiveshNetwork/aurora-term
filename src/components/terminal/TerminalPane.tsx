import { useEffect, useRef, useState, startTransition, useMemo } from "react";
import { Terminal } from "@xterm/xterm";

import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { useBlockStore } from "../../stores/useBlockStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useSessionStore } from "../../stores/useSessionStore";
import { buildXtermTheme } from "../../lib/xtermTheme";
import { recalculateAnchors } from "../../lib/terminal/blockAnchors";
// PromptBar and InputBar decoupled to App level
import { TerminalBlock } from "./TerminalBlock";
import { pty, system } from "../../lib/ipc";
import { SquareTerminal, ShieldCheck } from "lucide-react";
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
  const [isCwdLoading, setIsCwdLoading] = useState(false);

  // Read registered blocks for this session from state
  const sessionBlocks = useBlockStore((state) => state.blocks[sessionId] || EMPTY_BLOCKS);
  const runningBlockId = useBlockStore((state) => state.runningBlockId[sessionId]);
  const isCommandRunning = !!runningBlockId;
  const isAlternateActive = useSessionStore((state) => state.alternateBufferActive[sessionId] || false);
  const theme = useSettingsStore((state) => state.theme);

  // Get dynamic cell dimensions to verify layout alignments
  const [lineHeight, setLineHeight] = useState(19.5);

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

  // Dynamically toggle font family based on running state or alternate screen buffer state (Option A)
  const isRunningOrAlt = isCommandRunning || isAlternateActive;
  useEffect(() => {
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term) return;

    term.options.fontFamily = isRunningOrAlt
      ? "Consolas, 'Cascadia Code', Menlo, Monaco, monospace" // clean system sans-serif monospace for perfect gapless TUI borders
      : "'JetBrains Mono', monospace"; // custom font for sleek prompt view

    // Allow xterm.js to apply the new font styles to its DOM elements,
    // then re-measure cell size, re-fit the layout, resize the PTY, and recalculate coordinates.
    const timer = setTimeout(() => {
      try {
        if (fit && xtermRef.current && xtermRef.current.clientWidth > 0 && xtermRef.current.clientHeight > 0) {
          fit.fit();
          const { cols, rows } = term;
          if (cols > 0 && rows > 0) {
            pty.resize(sessionId, cols, rows).catch(console.error);
          }
        }
        // Re-measure exact core row height for dynamic overlay positioning
        const core = (term as any)._core;
        const ch = core?.viewport?._rowHeight ?? 19.5;
        if (ch > 0) setLineHeight(ch);
        recalc();
      } catch (err) {
        console.warn("Dynamic font refit failed:", err);
      }
    }, 60);

    return () => clearTimeout(timer);
  }, [isRunningOrAlt, sessionId, recalc]);

  useEffect(() => {
    if (!xtermRef.current) return;

    let isDisposed = false;

    // 1. Construct the xterm.js instance
    const term = new Terminal({
      allowProposedApi: true,
      allowTransparency: true,
      scrollback: 10000,
      cursorBlink: true,
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

      // Failsafe: If we are leaving the alternate buffer, check if a block is running and finalize it!
      if (!isAlternate) {
        const activeId = useBlockStore.getState().runningBlockId[sessionId];
        if (activeId) {
          console.log(`[TerminalPane ${sessionId}] Finalizing block via alternate buffer exit failsafe`);
          useBlockStore.getState().finalizeBlock(sessionId, activeId, 0);
        }
      }

      useSessionStore.getState().setAlternateBufferActive(sessionId, isAlternate);
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
        if (cols > 0 && rows > 0) {
          pty.resize(sessionId, cols, rows).catch(console.error);
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
    let lastAlternateBufferState = useSessionStore.getState().alternateBufferActive[sessionId] || false;
    let leftoverBuffer = ""; // To catch sequences split across chunks

    const syncAlternateBufferState = (active: boolean) => {
      if (lastAlternateBufferState === active) return;
      lastAlternateBufferState = active;
      console.log(`[TerminalPane ${sessionId}] Alternate buffer transition: ${!active} -> ${active}`);
      useSessionStore.getState().setAlternateBufferActive(sessionId, active);

      if (!active && !useBlockStore.getState().runningBlockId[sessionId]) {
        console.log(`[TerminalPane ${sessionId}] Restoring focus to input bar (no running command)`);
        requestAnimationFrame(() => {
          if (isDisposed) return;
          window.dispatchEvent(
            new CustomEvent("aurora-focus-terminal-input", { detail: { sessionId } })
          );
        });
      }
    };

    const flushBuffer = () => {
      if (isDisposed) return;
      if (dataBuffer) {
        let cleanData = leftoverBuffer + dataBuffer;
        leftoverBuffer = "";

        // Match alternate screen buffer escape sequences
        const enterAltBuffer = /\x1b\[\??(?:1049|47|1047)h/.test(cleanData);
        const leaveAltBuffer = /\x1b\[\??(?:1049|47|1047)l/.test(cleanData);

        if (enterAltBuffer) {
          console.log(`[TerminalPane ${sessionId}] Detected: Enter alternate buffer`);
          syncAlternateBufferState(true);
        }
        if (leaveAltBuffer) {
          console.log(`[TerminalPane ${sessionId}] Detected: Leave alternate buffer`);
          syncAlternateBufferState(false);
          // When leaving alternate buffer, the app is likely done or returning to shell.
          // We should force a check for a new prompt soon if one isn't already here.
        }

        // Parse workspace CWD sentinels — hide them from terminal output
        // We use a broader match that handles various line endings and potential split chunks
        const sentinelRegex = /__AURORA_CWD__=([^\r\n]+)(?:\r?\n|$)/g;
        let sMatch;
        let foundSentinel = false;
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

        // If we found a sentinel but a block is still marked as running, it might mean 
        // the terminal doesn't support OSC 133 D. We should finalize it here as a fallback.
        if (foundSentinel) {
          const activeId = useBlockStore.getState().runningBlockId[sessionId];
          if (activeId) {
            console.log(`[TerminalPane ${sessionId}] Finalizing block via prompt sentinel fallback`);
            useBlockStore.getState().finalizeBlock(sessionId, activeId, 0);
          }
        }

        // Hide the entire sentinel lines from xterm, but preserve a newline to keep vertical spacing.
        cleanData = cleanData.replace(/(?:\r?\n)?__AURORA_PROMPT_START__[\s\S]*?__AURORA_PROMPT_END__/g, "\r\n");

        // Strip automated sentinel echoes (e.g. from manual cd commands)
        cleanData = cleanData.replace(
          /(?:\r?\n)?.*(?:Write-Host|echo)\s+["\x27]?__AURORA_[A-Z_]+__[^\r\n]*/g,
          ""
        );

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
        if (lastEsc !== -1 && cleanData.length - lastEsc <= 2) {
          splitIndex = lastEsc;
        }
        if (lastAurora !== -1 && lastAurora > cleanData.length - 55) {
          if (splitIndex === -1 || lastAurora < splitIndex) {
            splitIndex = lastAurora;
          }
        }
        // Also buffer if we see a START but no END
        const startPrompt = cleanData.lastIndexOf("__AURORA_PROMPT_START__");
        if (startPrompt !== -1 && cleanData.indexOf("__AURORA_PROMPT_END__", startPrompt) === -1) {
          if (splitIndex === -1 || startPrompt < splitIndex) {
            splitIndex = startPrompt;
          }
        }

        if (splitIndex !== -1) {
          leftoverBuffer = cleanData.slice(splitIndex);
          cleanData = cleanData.slice(0, splitIndex);
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

          const currentCursorRow = term.buffer.active.cursorY + term.buffer.active.baseY;
          useBlockStore.getState().updateBlock(sessionId, activeBlockId, {
            output_row_end: Math.max(currentCursorRow + 1, term.buffer.active.baseY + term.rows),
          });
        }

        term.write(cleanData);
        recalc();
      }
      dataBuffer = "";
      frameId = 0;
    };

    const handlePtyData = (e: Event) => {
      if (isDisposed) return;
      const chunk = (e as CustomEvent<string>).detail;
      dataBuffer += chunk;
      if (!frameId) {
        frameId = requestAnimationFrame(flushBuffer);
      }
    };

    // Subscriptions
    window.addEventListener(`pty-session-data:${sessionId}`, handlePtyData);

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
      try {
        term.dispose();
      } catch (err) {
        console.warn("Failed to dispose terminal cleanly:", err);
      }
      window.removeEventListener(`pty-session-data:${sessionId}`, handlePtyData);
      dataDisposable.dispose();
      bufferDisposable.dispose();
      cancelAnimationFrame(frameId);
    };
  }, [sessionId, recalc]);

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

  // Dynamically toggle disableStdin based on command execution state and buffer swap states
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;

    // Enable direct stdin inside xterm when a command is running OR when alternate screen buffer is active.
    // Otherwise disable direct stdin to force typing into the custom input bar.
    term.options.disableStdin = !isCommandRunning && !isAlternateActive;
  }, [isCommandRunning, isAlternateActive]);

  return (
    <div
      ref={containerRef}
      onKeyDownCapture={handleKeyDownCapture}
      className="relative flex flex-col h-full w-full"
      style={{
        display: isVisible ? "flex" : "none",
        contain: "layout size style",
        isolation: "isolate",
      }}
    >
      {/* ── Layer 0: xterm canvas container ─────────────────────────────────── */}
      <div
        ref={xtermRef}
        className="flex-1 w-full relative select-text bg-transparent"
      >
        {/* ── Layer 1: GPU composited React block overlays ─────────────────────── */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            zIndex: 1,
            willChange: "transform",
            transform: "translateZ(0)",
          }}
        >
          {sessionBlocks.map((block) => (
            <TerminalBlock key={block.id} sessionId={sessionId} block={block} />
          ))}
        </div>
      </div>
    </div>
  );
}


