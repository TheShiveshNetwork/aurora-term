import React, {
  useRef,
  useState,
  useLayoutEffect,
  useEffect,
  useCallback,
  KeyboardEvent,
  SubmitEvent,
} from "react";
import { useBlockStore } from "../../stores/useBlockStore";
import { useSessionStore } from "../../stores/useSessionStore";
import { useAppShellStore } from "../../stores/useAppShellStore";
import { pty, system } from "../../lib/ipc";
import type { InputMode } from "../../lib/nlClassifier";
import { useHistoryNavigation } from "../../hooks/useHistoryNavigation";
import { SlashMenu, SlashMenuHandle } from "./SlashMenu";

function computeGhost(input: string, history: string[]): string {
  if (!input.trim()) return "";
  const lower = input.toLowerCase();

  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (h.toLowerCase().startsWith(lower) && h.length > input.length) {
      return h.slice(input.length);
    }
  }

  return "";
}

function getTokenBeforeCaret(textBeforeCaret: string): string {
  if (!textBeforeCaret) return "";
  if (/\s$/.test(textBeforeCaret)) return "";
  const m = textBeforeCaret.match(/[^\s]+$/);
  return m ? m[0] : "";
}

function getTokenIndex(textBeforeCaret: string): number {
  const trimmed = textBeforeCaret.trim();
  if (!trimmed) return 0;
  const tokens = trimmed.split(/\s+/);
  if (/\s$/.test(textBeforeCaret)) return tokens.length;
  return tokens.length - 1;
}

function splitPathToken(token: string): { dirPart: string; prefix: string } {
  const idxSlash = token.lastIndexOf("/");
  const idxBack = token.lastIndexOf("\\");
  const idx = Math.max(idxSlash, idxBack);
  if (idx >= 0) return { dirPart: token.slice(0, idx + 1), prefix: token.slice(idx + 1) };
  return { dirPart: "", prefix: token };
}

function resolveDirPart(cwd: string, dirPart: string): string {
  if (!dirPart) return cwd;
  const normCwd = cwd.replace(/\\/g, "/");
  let normDir = dirPart.replace(/\\/g, "/");
  if (normDir.startsWith("~/")) return cwd;
  if (/^[A-Za-z]:\//.test(normDir) || normDir.startsWith("/")) {
    return normDir.replace(/\/+$/, "") || "/";
  }
  let combined = normCwd.replace(/\/+$/, "") + "/" + normDir;
  const isAbsolute = combined.startsWith("/");
  const parts = combined.split("/").filter((p) => p !== "");
  const stack: string[] = [];
  const hasDrive = /^[A-Za-z]:$/.test(parts[0] ?? "");
  for (const p of parts) {
    if (p === ".") continue;
    if (p === "..") {
      if (stack.length && stack[stack.length - 1] !== "..") stack.pop();
      else if (!isAbsolute && !hasDrive) stack.push("..");
    } else stack.push(p);
  }
  let resolved = (isAbsolute ? "/" : "") + stack.join("/");
  if (hasDrive) resolved = stack.join("/");
  if (cwd.includes("\\") && !cwd.includes("/")) resolved = resolved.replace(/\//g, "\\");
  return resolved.replace(/\/+$/, "") || (isAbsolute ? "/" : ".");
}

interface GhostInputProps {
  sessionId?: string | null;
  value: string;
  onChange: (value: string) => void;
  onSubmit: (e: SubmitEvent<HTMLFormElement>) => void;
  history: string[];
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  inputMode?: InputMode;
  variant?: "command" | "prompt";
  onSlashOpenChange?: (open: boolean) => void;
}

export function GhostInput({
  sessionId = null,
  value,
  onChange,
  onSubmit,
  history,
  placeholder = "Type a command or describe goal...",
  className = "",
  inputClassName = "",
  inputMode = "unknown",
  variant = "command",
  onSlashOpenChange,
}: GhostInputProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLSpanElement>(null);
  const slashMenuRef = useRef<SlashMenuHandle>(null);
  const slashEscapedRef = useRef<string | null>(null);
  const textMetricsClass = "font-code-base text-sm font-normal leading-[22px]";

  const caret = inputRef.current ? (inputRef.current.selectionStart ?? value.length) : value.length;
  const textBeforeCaret = value.slice(0, caret);
  const slashMatch = textBeforeCaret.match(/(?:^|\s)\/(\w*)$/);
  const slashQuery = slashMatch ? slashMatch[1] : "";
  const slashOpen = !!slashMatch && slashEscapedRef.current !== value;

  useEffect(() => {
    onSlashOpenChange?.(slashOpen);
  }, [slashOpen, onSlashOpenChange]);

  useEffect(() => {
    const handleFocus = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail || detail.sessionId === sessionId) {
        inputRef.current?.focus();
      }
    };
    window.addEventListener("aurora-focus-terminal-input", handleFocus);
    return () => window.removeEventListener("aurora-focus-terminal-input", handleFocus);
  }, [sessionId]);

  const { navigateUp, navigateDown, reset } = useHistoryNavigation(history);

  const uniqueHistory = [...new Set(history.filter(Boolean).map(cmd => cmd.replace(/[`\\]+$/, '').trim()))];

  const sessionCwds = useAppShellStore((s) => s.sessionCwds);
  const cwdAbsolute = useAppShellStore((s) => s.cwdAbsolute);
  const projectDir = useAppShellStore((s) => s.projectDir);
  const effectiveCwd = sessionId ? (sessionCwds[sessionId] || projectDir || cwdAbsolute) : (projectDir || cwdAbsolute);

  const [pathGhost, setPathGhost] = useState("");

  useEffect(() => {
    if (variant === "prompt") {
      setPathGhost("");
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const el = inputRef.current;
      const c = el ? (el.selectionStart ?? value.length) : value.length;
      const ce = el ? (el.selectionEnd ?? value.length) : value.length;
      if (c !== ce || c !== value.length) {
        if (!cancelled) setPathGhost("");
        return;
      }
      const tbc = value.slice(0, c);
      const token = getTokenBeforeCaret(tbc);
      const tokenIdx = getTokenIndex(tbc);
      const isTrailingSpace = /\s$/.test(tbc);
      const effectiveToken = isTrailingSpace ? "" : token;
      const shouldTryPath = (() => {
        if (tokenIdx > 0) return true;
        if (effectiveToken.includes("/") || effectiveToken.includes("\\") || effectiveToken.startsWith("./") || effectiveToken.startsWith("../") || effectiveToken.startsWith("~/") || effectiveToken.startsWith(".")) return true;
        return false;
      })();
      if (!shouldTryPath || !effectiveCwd) {
        if (!cancelled) setPathGhost("");
        return;
      }
      const { dirPart, prefix } = splitPathToken(effectiveToken);
      const targetDir = resolveDirPart(effectiveCwd, dirPart);
      try {
        const entries = await system.readDir(targetDir);
        const prefixLower = prefix.toLowerCase();
        const showDotfiles = prefix.startsWith(".");
        let filtered = entries.filter((e) => {
          if (!showDotfiles && e.name.startsWith(".")) return false;
          return e.name.toLowerCase().startsWith(prefixLower);
        });
        filtered.sort((a, b) => {
          if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        if (filtered.length === 0 || cancelled) {
          if (!cancelled) setPathGhost("");
          return;
        }
        const best = filtered[0];
        const remainder = best.name.slice(prefix.length) + (best.is_dir ? "/" : "");
        if (!remainder || cancelled) {
          if (!cancelled) setPathGhost("");
          return;
        }
        setPathGhost(remainder);
      } catch {
        if (!cancelled) setPathGhost("");
      }
    }, 90);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [value, effectiveCwd, variant]);

  const historyGhost = variant === "prompt" ? "" : computeGhost(value, uniqueHistory);
  const caretAtEnd = (() => {
    const el = inputRef.current;
    if (!el) return true;
    const s = el.selectionStart ?? value.length;
    const e = el.selectionEnd ?? value.length;
    return s === e && s === value.length;
  })();
  const ghost = variant === "prompt" ? "" : caretAtEnd ? (pathGhost || historyGhost) : "";

  const acceptGhostCompletion = useCallback(() => {
    if (!ghost) return false;
    const inputEl = inputRef.current;
    if (!inputEl) return false;

    const selectionStart = inputEl.selectionStart ?? value.length;
    const selectionEnd = inputEl.selectionEnd ?? value.length;
    if (selectionStart !== selectionEnd || selectionEnd !== value.length) {
      return false;
    }

    const nextValue = value + ghost;
    onChange(nextValue);
    reset();

    requestAnimationFrame(() => {
      inputRef.current?.setSelectionRange(nextValue.length, nextValue.length);
    });

    return true;
  }, [ghost, onChange, value, reset]);

  const handleInsertSlash = useCallback(
    (text: string) => {
      const el = inputRef.current;
      const pos = el ? (el.selectionStart ?? value.length) : value.length;
      const before = value.slice(0, pos);
      const after = value.slice(pos);
      const m = before.match(/(?:^|\s)\/(\w*)$/);
      if (!m || m.index === undefined) {
        onChange(value);
        return;
      }
      const replaced = before.slice(0, m.index) + m[0].replace(/\/\w*$/, text);
      const next = replaced + after;
      onChange(next);
      reset();
      requestAnimationFrame(() => {
        inputRef.current?.setSelectionRange(replaced.length, replaced.length);
      });
    },
    [onChange, reset, value]
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      const slashCount = slashOpen ? slashMenuRef.current?.count() ?? 0 : 0;
      if (slashOpen) {
        if (e.key === "Escape") {
          e.preventDefault();
          slashEscapedRef.current = value;
          return;
        }
        if (!e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            slashMenuRef.current?.move(1);
            return;
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            slashMenuRef.current?.move(-1);
            return;
          }
          if ((e.key === "Tab" || e.key === "Enter") && !e.shiftKey && slashCount > 0) {
            e.preventDefault();
            slashMenuRef.current?.selectHighlighted();
            return;
          }
        }
      }

      if (e.key === "c" && e.ctrlKey) {
        const runningBlockId = sessionId ? useBlockStore.getState().runningBlockId[sessionId] : null;
        if (sessionId && runningBlockId) {
          e.preventDefault();
          pty.write(sessionId, "\u0003").catch(console.error);
          useSessionStore.getState().setSessionBusy(sessionId, false);

          useBlockStore.getState().updateBlock(sessionId, runningBlockId, {
            status: "cancelled",
            finished_at: Date.now(),
          });
          useBlockStore.getState().setRunningBlockId(sessionId, null);
          return;
        }
      }

      if (e.key === "Tab") {
        if (variant === "prompt") return;
        e.preventDefault();
        acceptGhostCompletion();
        return;
      }

      if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
        if (acceptGhostCompletion()) {
          e.preventDefault();
        }
        return;
      }

      if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) {
        return;
      }

      if (variant === "prompt") {
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        const newValue = navigateUp(value);
        onChange(newValue);
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        const newValue = navigateDown(value);
        onChange(newValue);
        return;
      }

      // Enter submits, Shift+Enter inserts newline
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const form = inputRef.current?.closest("form");
        if (form) form.requestSubmit();
        return;
      }

      if (
        e.key !== "Shift" &&
        e.key !== "Control" &&
        e.key !== "Alt" &&
        e.key !== "Meta" &&
        e.key !== "CapsLock"
      ) {
        reset();
      }
    },
    [acceptGhostCompletion, navigateUp, navigateDown, reset, onChange, value, sessionId, slashOpen]
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      e.preventDefault();
      const rawText = e.clipboardData.getData("text/plain");
      const el = inputRef.current;
      if (!el) return;

      const start = el.selectionStart ?? value.length;
      const end = el.selectionEnd ?? value.length;
      const next = value.slice(0, start) + rawText + value.slice(end);
      onChange(next);

      requestAnimationFrame(() => {
        if (inputRef.current) {
          const pos = start + rawText.length;
          inputRef.current.setSelectionRange(pos, pos);
        }
      });
    },
    [value, onChange]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      reset();
      const next = e.target.value;
      const pos = e.target.selectionStart ?? next.length;
      if (!next.slice(0, pos).match(/(?:^|\s)\/(\w*)$/)) {
        slashEscapedRef.current = null;
      }
      onChange(next);
    },
    [onChange, reset]
  );

  const [ghostLeft, setGhostLeft] = useState(0);
  const TA_MAX_HEIGHT = 350;

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    const newHeight = Math.min(el.scrollHeight, TA_MAX_HEIGHT);
    el.style.height = `${newHeight}px`;
    el.style.overflowY = el.scrollHeight > TA_MAX_HEIGHT ? "auto" : "hidden";
  }, [value]);

  useLayoutEffect(() => {
    const mirrorEl = mirrorRef.current;
    if (!mirrorEl) return;
    const measuredWidth = mirrorEl.getBoundingClientRect().width;
    setGhostLeft((prev) => (Math.abs(prev - measuredWidth) < 0.5 ? prev : measuredWidth));
  }, [value]);

  const handleWrapperClick = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  const handleFormSubmit = useCallback((e: React.SubmitEvent<HTMLFormElement>) => {
    reset();
    onSubmit(e);
  }, [reset, onSubmit]);

  return (
    <form onSubmit={handleFormSubmit} className={`ghost-input flex items-start ${className}`} onClick={handleWrapperClick}>
      <div className="relative flex-1 flex items-start overflow-hidden">
        <span
          ref={mirrorRef}
          aria-hidden="true"
          className={`invisible pointer-events-none absolute left-5 top-3 whitespace-pre ${textMetricsClass}`}
        >
          {value || ""}
        </span>

        <textarea
          ref={inputRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={placeholder}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          rows={1}
          wrap="soft"
          className={`aurora-ta w-full bg-transparent border-none focus:ring-0 mt-4 pb-1 px-5 placeholder:text-outline/80 outline-none text-on-surface relative z-10 resize-none overflow-x-hidden whitespace-pre-wrap break-words ${textMetricsClass} ${inputClassName}`}
          style={{ maxHeight: `${TA_MAX_HEIGHT}px` }}
        />

        {ghost && (
          <span
            aria-hidden="true"
            className={`pointer-events-none absolute left-[var(--ghost-left)] top-4 pb-1 z-0 select-none whitespace-pre ${textMetricsClass} text-on-surface-variant/40`}
            style={{ ["--ghost-left" as string]: `${20 + ghostLeft}px` }}
          >
            {ghost}
          </span>
        )}

        <SlashMenu
          ref={slashMenuRef}
          open={slashOpen}
          filter={slashQuery}
          inputRef={inputRef}
          onInsert={handleInsertSlash}
        />
      </div>
    </form>
  );
}
