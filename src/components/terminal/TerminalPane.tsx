import { useEffect, useRef } from "react";
import { pty } from "../../lib/ipc";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";

interface TerminalPaneProps {
  sessionId: string;
  isVisible: boolean; // CSS show/hide — component stays mounted across tab switches
}

// ─── CWD sentinel ─────────────────────────────────────────────────────────────
const CWD_SENTINEL = "__AURORA_CWD__=";

// ─── Strip ANSI sequences ──────────────────────────────────────────────────────
const stripAnsi = (str: string) =>
  str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, "");

// ─── Validate absolute filesystem path ─────────────────────────────────────────
const isValidPath = (p: string): boolean => {
  if (!p) return false;
  const clean = p.trim();
  if (
    clean.includes("$") || 
    clean.includes("(") || 
    clean.includes(")") || 
    clean.includes("Write-Host") || 
    clean.includes("echo") ||
    clean.includes("__AURORA_")
  ) {
    return false;
  }
  return /^[a-zA-Z]:[\\/]/.test(clean) || /^\//.test(clean) || clean.startsWith("~");
};

// ─── Xterm theme (shared, created once) ───────────────────────────────────────
const XTERM_THEME = {
  background: "transparent",
  foreground: "#cdd6f4",
  cursor: "transparent",
  cursorAccent: "#cdd6f4",
  selectionBackground: "rgba(0, 240, 255, 0.15)",
  black: "#1e1e2e",   red: "#f38ba8",   green: "#a6e3a1",  yellow: "#f9e2af",
  blue: "#89b4fa",    magenta: "#cba6f7", cyan: "#89dceb",  white: "#cdd6f4",
  brightBlack: "#585b70", brightRed: "#f38ba8", brightGreen: "#a6e3a1",
  brightYellow: "#f9e2af", brightBlue: "#89b4fa", brightMagenta: "#cba6f7",
  brightCyan: "#89dceb", brightWhite: "#ffffff",
};

// ─────────────────────────────────────────────────────────────────────────────
export function TerminalPane({ sessionId, isVisible }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cwdRef    = useRef<string>("~");
  const branchRef = useRef<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !sessionId) return;

    // ── All mutable state lives inside the effect closure ─────────────────
    let termInstance: Terminal | null = null;
    let fitAddonInstance: FitAddon | null = null;
    let termReady = false;
    let lastRunningCommand: string | null = null;

    // Queue data that arrives before xterm is initialized
    const pendingData: string[] = [];

    // Accumulate PTY chunks — flush after a short debounce so we can
    // process multi-chunk prompt sequences atomically
    let promptBuffer = "";
    const FLUSH_DELAY = 50; // ms
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    // ── Buffer flush / prompt processing ──────────────────────────────────
    function flush() {
      flushTimer = null;
      if (!termInstance || !termReady || promptBuffer.length === 0) return;

      let chunk = promptBuffer;
      promptBuffer = "";

      // Strip automated CWD/Branch sentinel query command echoes from PTY stream
      chunk = chunk.replace(/(?:\r?\n)?.*(?:Write-Host|echo)\s+["']?__AURORA_(?:CWD|BRANCH)__[^\r\n]*/g, "");

      // Extract and fire CWD sentinel
      chunk = chunk.replace(
        /(?:\r?\n)?__AURORA_CWD__=([^\r\n]+)\r?\n?/g,
        (_m, rawPath) => {
          const path = stripAnsi(rawPath).trim();
          if (isValidPath(path)) {
            cwdRef.current = path;
            window.dispatchEvent(
              new CustomEvent("cwd-change", { detail: { path, sessionId } })
            );
          }
          return "";
        }
      );

      // Extract and fire Branch sentinel
      chunk = chunk.replace(
        /(?:\r?\n)?__AURORA_BRANCH__=([^\r\n]*)\r?\n?/g,
        (_m, rawBranch) => {
          const br = stripAnsi(rawBranch).trim();
          branchRef.current = br ? br : null;
          return "";
        }
      );

      // Strip all native prompts completely (handling carriage returns globally)
      chunk = chunk.replace(/\r?PS\s*[^\r\n>]*>\s*/g, "");
      chunk = chunk.replace(/\r?PS>\s*/g, "");
      chunk = chunk.replace(/\r?>>\s*/g, "");
      chunk = chunk.replace(/\r?\u001b\[[^m]*m(PS\s[^\r\n]*)>\s*\u001b\[0m/g, "");
      chunk = chunk.replace(/\r?\[?[\w.-]+@[\w.-]+\s+[^\]\r\n]+\]?[$#]\s*/g, "");
      chunk = chunk.replace(/\r?[^>\r\n]+[$#]\s*/g, "");

      // Strip the command echo if it's there (only clearing once successfully stripped)
      if (lastRunningCommand) {
        const lines = chunk.split("\n");
        const targetClean = lastRunningCommand.trim();
        const index = lines.findIndex(l => {
          const cleanLine = stripAnsi(l).trim();
          // 1. Exact match
          if (cleanLine === targetClean) return true;
          // 2. Ends with match (handles custom prompt prefixes)
          if (targetClean.length > 3 && cleanLine.endsWith(targetClean)) return true;
          // 3. Starts with match (handles trailing garbage or spaces)
          if (targetClean.length > 3 && cleanLine.startsWith(targetClean)) return true;
          // 4. Super clean alphanumeric match (handles syntax highlighting spacing differences)
          const superCleanLine = cleanLine.replace(/[^a-zA-Z0-9]/g, "");
          const superTarget = targetClean.replace(/[^a-zA-Z0-9]/g, "");
          if (superTarget.length > 3 && superCleanLine === superTarget) return true;
          return false;
        });

        if (index !== -1) {
          lines.splice(index, 1);
          chunk = lines.join("\n");
          lastRunningCommand = null;
        }
      }

      if (chunk.length > 0) {
        termInstance.write(chunk);
      }
    }

    function scheduleFlush() {
      if (flushTimer !== null) clearTimeout(flushTimer);
      flushTimer = setTimeout(flush, FLUSH_DELAY);
    }

    function onData(data: string) {
      if (!termReady) { pendingData.push(data); return; }
      promptBuffer += data;
      scheduleFlush();
    }

    // ── DOM event listeners — synchronous, no async cleanup issues ─────────
    const onSessionData = (e: Event) => onData((e as CustomEvent<string>).detail);
    const onSessionExit = (e: Event) => {
      const code = (e as CustomEvent<number>).detail;
      termInstance?.writeln(
        `\r\n\x1b[1;31mProcess exited (code ${code})\x1b[0m`
      );
    };
    const onMeta = (e: Event) => {
      const { id, cwd, branch } = (e as CustomEvent).detail ?? {};
      if (id !== sessionId) return;
      if (cwd    !== undefined) cwdRef.current    = cwd;
      if (branch !== undefined) branchRef.current = branch;
    };
    const onCommandRun = (e: Event) => {
      const { cmd } = (e as CustomEvent<{ cmd: string }>).detail;
      lastRunningCommand = cmd.trim();

      // Get folder and branch
      const folder = cwdRef.current.split(/[/\\]/).filter(Boolean).pop() || cwdRef.current;
      const branchStr = branchRef.current ? ` \x1b[1;32m(${branchRef.current})\x1b[0m` : "";
      
      // Format: \r\nfolder (branch) > command\r\n
      const E = "\x1b";
      const header = `\r\n${E}[1;36m${folder}${E}[0m${branchStr} \x1b[1;30m>\x1b[0m ${E}[1;35m${lastRunningCommand}${E}[0m\r\n`;
      termInstance?.write(header);
    };

    const onTerminalCopy = (e: Event) => {
      const { sessionId: targetId } = (e as CustomEvent<{ sessionId: string }>).detail;
      if (targetId !== sessionId) return;

      const selectedText = termInstance?.getSelection();
      if (selectedText) {
        navigator.clipboard.writeText(selectedText).catch(console.error);
      }
    };

    const onTerminalClear = (e: Event) => {
      const { sessionId: targetId } = (e as CustomEvent<{ sessionId: string }>).detail;
      if (targetId !== sessionId) return;

      termInstance?.clear();
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      const selectedText = termInstance?.getSelection() || "";
      window.dispatchEvent(
        new CustomEvent("show-context-menu", {
          detail: { 
            x: e.clientX, 
            y: e.clientY,
            selectedText: selectedText
          }
        })
      );
    };

    container.addEventListener("contextmenu", handleContextMenu);

    window.addEventListener(`pty-session-data:${sessionId}`, onSessionData);
    window.addEventListener(`pty-session-exit:${sessionId}`, onSessionExit);
    window.addEventListener("terminal-meta", onMeta);
    window.addEventListener(`pty-command-run:${sessionId}`, onCommandRun);
    window.addEventListener("terminal-copy", onTerminalCopy);
    window.addEventListener("terminal-clear", onTerminalClear);

    // ── Initialize xterm synchronously ─────────────────────────────────────
    const style = getComputedStyle(document.documentElement);
    const fg    = style.getPropertyValue("--color-on-surface").trim() || "#cdd6f4";

    const term = new Terminal({
      fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', monospace",
      fontSize: 13,
      lineHeight: 1.5,
      cursorStyle: "block",
      cursorBlink: false,
      theme: { ...XTERM_THEME, foreground: fg, cursorAccent: fg },
      allowProposedApi: true,
      allowTransparency: true,
      disableStdin: true,      // never accept keyboard input
      scrollback: 5000,
      cursorInactiveStyle: "none",
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);
    
    // Initial fit
    if (container.clientWidth > 0 && container.clientHeight > 0) {
      try { fitAddon.fit(); } catch (_) {}
    }

    termInstance    = term;
    fitAddonInstance = fitAddon;
    termReady       = true;
    fitRef.current  = () => {
      if (!containerRef.current || containerRef.current.clientWidth === 0) return;
      try { fitAddon.fit(); } catch (_) {}
    };

    const dims = fitAddon.proposeDimensions();
    if (dims) pty.resize(sessionId, dims.cols, dims.rows).catch(console.error);

    // Flush any data that arrived early
    if (pendingData.length > 0) {
      promptBuffer += pendingData.splice(0).join("");
      flush();
    }

    // ── Resize observer ────────────────────────────────────────────────────
    let lastCols = 0, lastRows = 0;
    const resizeObserver = new ResizeObserver(() => {
      if (!fitAddonInstance || !termInstance || !container) return;
      
      if (container.clientWidth === 0 || container.clientHeight === 0) return;

      try {
        fitAddonInstance.fit();
        const dims = fitAddonInstance.proposeDimensions();
        if (dims && (dims.cols !== lastCols || dims.rows !== lastRows)) {
          lastCols = dims.cols; lastRows = dims.rows;
          pty.resize(sessionId, dims.cols, dims.rows).catch(console.error);
        }
      } catch (_) {}
    });
    resizeObserver.observe(container);

    // ── Cleanup ────────────────────────────────────────────────────────────
    return () => {
      if (flushTimer !== null) clearTimeout(flushTimer);
      resizeObserver.disconnect();

      container.removeEventListener("contextmenu", handleContextMenu);

      window.removeEventListener(`pty-session-data:${sessionId}`, onSessionData);
      window.removeEventListener(`pty-session-exit:${sessionId}`, onSessionExit);
      window.removeEventListener("terminal-meta", onMeta);
      window.removeEventListener(`pty-command-run:${sessionId}`, onCommandRun);
      window.removeEventListener("terminal-copy", onTerminalCopy);
      window.removeEventListener("terminal-clear", onTerminalClear);

      if (termInstance) {
        try { termInstance.dispose(); } catch (_) {}
        termInstance = null;
      }
      fitRef.current = null;
    };
  }, [sessionId]); // re-run only when the session changes

  // Re-fit when becoming visible (after being hidden with display:none)
  const fitRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (isVisible && fitRef.current) {
      // Small delay to let the layout settle after display change
      const t = setTimeout(() => fitRef.current?.(), 50);
      return () => clearTimeout(t);
    }
  }, [isVisible]);

  return (
    <div 
      className="w-full h-full overflow-hidden transition-opacity duration-150" 
      style={{ 
        opacity: isVisible ? 1 : 0,
        visibility: isVisible ? 'visible' : 'hidden',
        pointerEvents: isVisible ? 'auto' : 'none',
        zIndex: isVisible ? 10 : 0
      }}
    >
      <div ref={containerRef} className="w-full h-full terminal-scroll" />
    </div>
  );
}
