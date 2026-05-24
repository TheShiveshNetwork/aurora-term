/**
 * OutputRenderer.tsx
 *
 * Custom React-based PTY output renderer — replaces the xterm.js canvas/DOM
 * terminal for display. The Rust PTY backend and Tauri IPC remain unchanged;
 * this component is purely a display layer that consumes the same
 * `pty-session-data:${sessionId}` DOM events that TerminalPane used to consume.
 *
 * Architecture:
 *  - Lines are accumulated in a mutable ref (never Zustand) → zero Zustand
 *    re-renders during streaming.
 *  - A requestAnimationFrame loop flushes the ref → React state at ~60fps.
 *  - A lightweight virtual scroll window renders only ~100 lines at a time.
 *  - Selection and copy work via native browser behaviour.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { parseAnsiInto, createParserState, StyledLine, AnsiSpan, ParserState } from "../../lib/ansiParser";
import { pty, system } from "../../lib/ipc";

interface OutputRendererProps {
  sessionId: string;
  isVisible: boolean;
  /** Callback to expose the resize function so App/TerminalPane can call pty.resize */
  onResize?: (cols: number, rows: number) => void;
  /** Character cell dimensions from the headless terminal sizer */
  cellWidth?: number;
  cellHeight?: number;
  /** True while a command is executing — enables interactive keyboard input */
  isRunning?: boolean;
}

// ─── How many lines we keep in the scrollback buffer ─────────────────────────
const MAX_SCROLLBACK = 5000;

// ─── How many lines to render above/below the visible window (overscan) ──────
const OVERSCAN = 20;

// ─── Throttle flush to display rate ──────────────────────────────────────────
const FLUSH_INTERVAL_MS = 16; // ~60fps

// ─── Sentinel / prompt strip patterns (mirrors TerminalPane logic) ────────────
const CWD_SENTINEL = "__AURORA_CWD__=";
const BRANCH_SENTINEL = "__AURORA_BRANCH__=";

const STRIP_PATTERNS = [
  // Strip automated sentinel echoes
  /(?:\r?\n)?.*(?:Write-Host|echo)\s+["']?__AURORA_(?:CWD|BRANCH)__[^\r\n]*/g,
  // Strip PowerShell prompt
  /\r?PS\s*[^\r\n>]*>\s*/g,
  /\r?PS>\s*/g,
  /\r?>>\s*/g,
  /\r?\u001b\[[^m]*m(?:PS\s[^\r\n]*)>\s*\u001b\[0m/g,
  // Strip bash/zsh prompts
  /\r?\[?[\w.-]+@[\w.-]+\s+[^\]\r\n]+\]?[$#]\s*/g,
  /\r?[^>\r\n]+[$#]\s*/g,
];

const stripAnsi = (s: string) =>
  s.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, "");

const isValidPath = (p: string) => {
  if (!p) return false;
  const c = p.trim();
  if (c.includes("$") || c.includes("(") || c.includes(")") ||
    c.includes("Write-Host") || c.includes("echo") || c.includes("__AURORA_")) return false;
  return /^[a-zA-Z]:[\\/]/.test(c) || /^\//.test(c) || c.startsWith("~");
};

// ─── Render a single ANSI span as inline styles ───────────────────────────────

function spanStyle(span: AnsiSpan): React.CSSProperties {
  return {
    ...(span.fg ? { color: span.fg } : {}),
    ...(span.bg ? { backgroundColor: span.bg } : {}),
    ...(span.bold ? { fontWeight: "700" } : {}),
    ...(span.dim ? { opacity: 0.5 } : {}),
    ...(span.italic ? { fontStyle: "italic" } : {}),
    ...(span.underline ? { textDecoration: "underline" } : {}),
    ...(span.strikethrough ? { textDecoration: "line-through" } : {}),
  };
}

// ─── Single rendered line ─────────────────────────────────────────────────────

function RenderedLine({ line, showCursor }: { line: StyledLine, showCursor?: boolean }) {
  if (line.spans.length === 0) {
    // Empty line — preserve vertical space
    return (
      <div className="output-line">
        &nbsp;{showCursor && <span className="output-cursor" />}
      </div>
    );
  }
  return (
    <div className="output-line">
      {line.spans.map((span, i) => {
        if (!span.text) return null;
        const style = spanStyle(span);
        const hasStyle = Object.keys(style).length > 0;
        return hasStyle ? (
          <span key={i} style={style}>{span.text}</span>
        ) : (
          <span key={i}>{span.text}</span>
        );
      })}
      {showCursor && <span className="output-cursor" />}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function OutputRenderer({
  sessionId,
  isVisible,
  onResize,
  cellWidth = 8,
  cellHeight = 19.5,
  isRunning = false,
}: OutputRendererProps) {
  // ── Mutable line buffer — never triggers React re-renders ─────────────────
  const linesRef = useRef<StyledLine[]>([{ spans: [] }]);
  const parserStateRef = useRef<ParserState>(createParserState());
  const pendingFlushRef = useRef(false);
  const lastRunningCommandRef = useRef<string | null>(null);
  const promptBufferRef = useRef("");
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Display state — updated at ~60fps via rAF ─────────────────────────────
  const [displayLines, setDisplayLines] = useState<StyledLine[]>([{ spans: [] }]);

  // ── Scroll management ─────────────────────────────────────────────────────
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(400);
  const lineHeight = cellHeight; // matches font/line-height below

  // Auto-scroll: track whether user has scrolled up
  const isAtBottomRef = useRef(true);
  const prevLineCountRef = useRef(0);

  // ── CWD / branch refs ─────────────────────────────────────────────────────
  const cwdRef = useRef<string>("~");
  const branchRef = useRef<string | null>(null);

  // ─────────────────────────────────────────────────────────────────────────
  // Prompt processing (mirrors TerminalPane's flush())
  // ─────────────────────────────────────────────────────────────────────────
  const flushPromptBuffer = useCallback(() => {
    flushTimerRef.current = null;
    if (!promptBufferRef.current) return;

    let chunk = promptBufferRef.current;
    promptBufferRef.current = "";

    // Strip sentinel echoes
    chunk = chunk.replace(/(?:\r?\n)?.*(?:Write-Host|echo)\s+["']?__AURORA_(?:CWD|BRANCH)__[^\r\n]*/g, "");

    // Extract CWD sentinel
    chunk = chunk.replace(
      /(?:\r?\n)?__AURORA_CWD__=([^\r\n]+)\r?\n?/g,
      (_m, rawPath) => {
        const path = stripAnsi(rawPath).trim();
        if (isValidPath(path)) {
          cwdRef.current = path;
          window.dispatchEvent(new CustomEvent("cwd-change", { detail: { path, sessionId } }));
        }
        return "";
      }
    );

    // Extract Branch sentinel
    chunk = chunk.replace(
      /(?:\r?\n)?__AURORA_BRANCH__=([^\r\n]*)\r?\n?/g,
      (_m, rawBranch) => {
        branchRef.current = stripAnsi(rawBranch).trim() || null;
        return "";
      }
    );

    // Strip native prompts
    for (const p of STRIP_PATTERNS) {
      chunk = chunk.replace(p, "");
    }

    // Strip command echo
    if (lastRunningCommandRef.current) {
      const lines = chunk.split("\n");
      const target = lastRunningCommandRef.current.trim();
      const idx = lines.findIndex(l => {
        const clean = stripAnsi(l).trim();
        if (clean === target) return true;
        if (target.length > 3 && clean.endsWith(target)) return true;
        if (target.length > 3 && clean.startsWith(target)) return true;
        const sc = clean.replace(/[^a-zA-Z0-9]/g, "");
        const st = target.replace(/[^a-zA-Z0-9]/g, "");
        return st.length > 3 && sc === st;
      });
      if (idx !== -1) {
        lines.splice(idx, 1);
        chunk = lines.join("\n");
        lastRunningCommandRef.current = null;
      }
    }

    if (chunk.length > 0) {
      parseAnsiInto(linesRef.current, parserStateRef.current, chunk);
      // Trim scrollback
      if (linesRef.current.length > MAX_SCROLLBACK) {
        linesRef.current = linesRef.current.slice(linesRef.current.length - MAX_SCROLLBACK);
      }
      pendingFlushRef.current = true;
    }
  }, [sessionId]);

  const schedulePromptFlush = useCallback(() => {
    if (flushTimerRef.current !== null) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(flushPromptBuffer, 50);
  }, [flushPromptBuffer]);

  // ─────────────────────────────────────────────────────────────────────────
  // rAF display loop — flushes linesRef → displayLines at display rate
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    let rafId: number;
    let lastFlush = 0;

    const loop = (now: number) => {
      if (pendingFlushRef.current && now - lastFlush >= FLUSH_INTERVAL_MS) {
        pendingFlushRef.current = false;
        lastFlush = now;
        // Shallow copy array reference — React sees a new array
        setDisplayLines([...linesRef.current]);
      }
      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // Auto-scroll to bottom when new lines arrive (unless user scrolled up)
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (displayLines.length !== prevLineCountRef.current) {
      prevLineCountRef.current = displayLines.length;
      if (isAtBottomRef.current && scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    }
  }, [displayLines.length]);

  // ─────────────────────────────────────────────────────────────────────────
  // Interactive terminal focus
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isRunning && scrollRef.current) {
      scrollRef.current.focus();
    }
  }, [isRunning]);

  // ─────────────────────────────────────────────────────────────────────────
  // Interactive terminal keyboard handler
  // ─────────────────────────────────────────────────────────────────────────
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isRunning) return;

    let data = "";
    if (e.key === "Enter") data = "\r";
    else if (e.key === "Backspace") data = "\x08";
    else if (e.key === "Tab") { data = "\t"; e.preventDefault(); }
    else if (e.key === "Escape") data = "\x1b";
    else if (e.key === "ArrowUp") { data = "\x1b[A"; e.preventDefault(); }
    else if (e.key === "ArrowDown") { data = "\x1b[B"; e.preventDefault(); }
    else if (e.key === "ArrowRight") { data = "\x1b[C"; e.preventDefault(); }
    else if (e.key === "ArrowLeft") { data = "\x1b[D"; e.preventDefault(); }
    else if (e.key === "Delete") data = "\x1b[3~";
    else if (e.ctrlKey) {
      if (e.key.length === 1) {
        const charCode = e.key.toLowerCase().charCodeAt(0);
        if (charCode >= 97 && charCode <= 122) { // a-z
          data = String.fromCharCode(charCode - 96);
          e.preventDefault();
        }
      }
    } else if (e.key.length === 1 && !e.metaKey && !e.altKey) {
      data = e.key;
    }

    if (data) {
      if (e.key === "Backspace" || e.key === "Enter") {
        // Allow native enter/backspace default behavior but stop propagation just in case
      }
      pty.write(sessionId, data).catch(console.error);
    }
  }, [isRunning, sessionId]);

  // ─────────────────────────────────────────────────────────────────────────
  // PTY data / exit / command DOM event listeners
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const onSessionData = (e: Event) => {
      const data = (e as CustomEvent<string>).detail;
      promptBufferRef.current += data;
      schedulePromptFlush();
    };

    const onSessionExit = (e: Event) => {
      const code = (e as CustomEvent<number>).detail;
      const msg = `\nProcess exited (code ${code})\n`;
      parseAnsiInto(linesRef.current, parserStateRef.current, `\x1b[1;31m${msg}\x1b[0m`);
      pendingFlushRef.current = true;

      setTimeout(() => {
        system.getCurrentPwd().then((path: string) => {
          if (path) {
            window.dispatchEvent(
              new CustomEvent("cwd-change", { detail: { path, sessionId } })
            );
          }
        }).catch(() => {});
      }, 100);
    };

    const onCommandRun = (e: Event) => {
      const { cmd } = (e as CustomEvent<{ cmd: string }>).detail;
      lastRunningCommandRef.current = cmd.trim();

      const folder = cwdRef.current.split(/[/\\]/).filter(Boolean).pop() || cwdRef.current;
      const branchStr = branchRef.current ? ` \x1b[1;32m(${branchRef.current})\x1b[0m` : "";
      const E = "\x1b";
      const header = `\r\n${E}[1;36m${folder}${E}[0m${branchStr} \x1b[1;30m>\x1b[0m ${E}[1;35m${lastRunningCommandRef.current}${E}[0m\r\n`;

      parseAnsiInto(linesRef.current, parserStateRef.current, header);
      if (linesRef.current.length > MAX_SCROLLBACK) {
        linesRef.current = linesRef.current.slice(linesRef.current.length - MAX_SCROLLBACK);
      }
      pendingFlushRef.current = true;
      // Ensure we scroll to bottom when a new command starts
      isAtBottomRef.current = true;
    };

    const onMeta = (e: Event) => {
      const { id, cwd, branch } = (e as CustomEvent).detail ?? {};
      if (id !== sessionId) return;
      if (cwd !== undefined) cwdRef.current = cwd;
      if (branch !== undefined) branchRef.current = branch;
    };

    const onClear = (e: Event) => {
      const { sessionId: targetId } = (e as CustomEvent<{ sessionId: string }>).detail;
      if (targetId !== sessionId) return;

      // Cancel any pending flush timers
      if (flushTimerRef.current !== null) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }

      // Clear the prompt buffer so stale data is not flushed after the clear
      promptBufferRef.current = "";

      linesRef.current = [{ spans: [] }];
      parserStateRef.current = createParserState();
      pendingFlushRef.current = false;
      setDisplayLines([{ spans: [] }]);
      setScrollTop(0);
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
    };

    const onCopy = (e: Event) => {
      const { sessionId: targetId } = (e as CustomEvent<{ sessionId: string }>).detail;
      if (targetId !== sessionId) return;
      const sel = window.getSelection()?.toString() ?? "";
      if (sel) navigator.clipboard.writeText(sel).catch(console.error);
    };

    window.addEventListener(`pty-session-data:${sessionId}`, onSessionData);
    window.addEventListener(`pty-session-exit:${sessionId}`, onSessionExit);
    window.addEventListener(`pty-command-run:${sessionId}`, onCommandRun);
    window.addEventListener("terminal-meta", onMeta);
    window.addEventListener("terminal-clear", onClear);
    window.addEventListener("terminal-copy", onCopy);

    return () => {
      if (flushTimerRef.current !== null) clearTimeout(flushTimerRef.current);
      window.removeEventListener(`pty-session-data:${sessionId}`, onSessionData);
      window.removeEventListener(`pty-session-exit:${sessionId}`, onSessionExit);
      window.removeEventListener(`pty-command-run:${sessionId}`, onCommandRun);
      window.removeEventListener("terminal-meta", onMeta);
      window.removeEventListener("terminal-clear", onClear);
      window.removeEventListener("terminal-copy", onCopy);
    };
  }, [sessionId, schedulePromptFlush]);

  // ─────────────────────────────────────────────────────────────────────────
  // Resize observer — report cols/rows to backend
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    let lastCols = 0, lastRows = 0;

    const report = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (!w || !h) return;
      setContainerHeight(h);
      const cols = Math.max(10, Math.floor(w / cellWidth));
      const rows = Math.max(5, Math.floor(h / cellHeight));
      if (cols !== lastCols || rows !== lastRows) {
        lastCols = cols; lastRows = rows;
        pty.resize(sessionId, cols, rows).catch(console.error);
        onResize?.(cols, rows);
      }
    };

    const ro = new ResizeObserver(report);
    ro.observe(container);
    report(); // initial

    return () => ro.disconnect();
  }, [sessionId, cellWidth, cellHeight, onResize]);

  // ─────────────────────────────────────────────────────────────────────────
  // Virtual scroll — only render a window of lines
  // ─────────────────────────────────────────────────────────────────────────
  const totalHeight = displayLines.length * lineHeight;

  const visibleStart = Math.max(0, Math.floor(scrollTop / lineHeight) - OVERSCAN);
  const visibleEnd = Math.min(
    displayLines.length,
    Math.ceil((scrollTop + containerHeight) / lineHeight) + OVERSCAN
  );

  const visibleLines = displayLines.slice(visibleStart, visibleEnd);
  const paddingTop = visibleStart * lineHeight;
  const paddingBottom = (displayLines.length - visibleEnd) * lineHeight;

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const newScrollTop = el.scrollTop;
    setScrollTop(newScrollTop);
    // Detect if user is at the bottom (within 2px)
    isAtBottomRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const selectedText = window.getSelection()?.toString() ?? "";
    window.dispatchEvent(
      new CustomEvent("show-context-menu", {
        detail: { x: e.clientX, y: e.clientY, selectedText, source: "terminal" },
      })
    );
  }, []);

  return (
    <div
      className="w-full h-full overflow-hidden transition-opacity duration-150"
      style={{
        opacity: isVisible ? 1 : 0,
        visibility: isVisible ? "visible" : "hidden",
        pointerEvents: isVisible ? "auto" : "none",
        zIndex: isVisible ? 10 : 0,
      }}
    >
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        onContextMenu={handleContextMenu}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        className="output-renderer w-full h-full overflow-y-auto overflow-x-hidden terminal-scroll outline-none focus:outline-none"
        style={{
          fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', monospace",
          fontSize: "13px",
          lineHeight: `${lineHeight}px`,
          color: "var(--color-on-surface, #cdd6f4)",
          boxSizing: "border-box",
          wordBreak: "break-all",
          whiteSpace: "pre-wrap",
          userSelect: "text",
          cursor: "text",
        }}
      >
        <div className="flex flex-col min-h-full w-full" style={{ padding: "8px 0", boxSizing: "border-box" }}>
          {/* Spacer with margin-top: auto pushes content to the bottom when smaller than container */}
        <div style={{ height: totalHeight, position: "relative", marginTop: "auto", flexShrink: 0 }}>
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              paddingTop,
              paddingBottom,
            }}
          >
            {visibleLines.map((line, i) => {
              const isLastLine = visibleStart + i === displayLines.length - 1;
              return (
                <RenderedLine
                  key={visibleStart + i}
                  line={line}
                  showCursor={isRunning && isLastLine}
                />
              );
            })}
          </div>
        </div>

        {/* ── Live prompt row ── shown when idle (not running) ─────────────────
            Text is NOT mirrored here while typing — it only appears after Enter
            as the permanent command header written by onCommandRun.             */}
        {!isRunning && (() => {
          const folder = cwdRef.current.split(/[/\\]/).filter(Boolean).pop() || cwdRef.current;
          const branch = branchRef.current;
          return (
            <div className="output-prompt-row" style={{ flexShrink: 0 }} aria-hidden="true">
              {/* Folder */}
              <span style={{ color: "#89dceb", fontWeight: 700 }}>{folder}</span>
              {/* Branch */}
              {branch && (
                <span style={{ color: "#a6e3a1" }}>&nbsp;({branch})</span>
              )}
              {/* Separator */}
              <span style={{ color: "#a6adc8", margin: "0 4px" }}>›</span>
            </div>
          );
        })()}
        </div>
      </div>
    </div>
  );
}
