import React, {
  useRef,
  useState,
  useLayoutEffect,
  useEffect,
  useCallback,
  KeyboardEvent,
  FormEvent,
} from "react";
import { useBlockStore } from "../../stores/useBlockStore";
import { pty } from "../../lib/ipc";

const textareaScrollbarId = "aurora-ta-scrollbar-style";
if (typeof document !== "undefined" && !document.getElementById(textareaScrollbarId)) {
  const style = document.createElement("style");
  style.id = textareaScrollbarId;
  style.textContent = `
    .aurora-ta::-webkit-scrollbar { width: 5px; }
    .aurora-ta::-webkit-scrollbar-track { background: transparent; }
    .aurora-ta::-webkit-scrollbar-thumb { background: rgba(132, 148, 149, 0.2); border-radius: 3px; }
    .aurora-ta::-webkit-scrollbar-thumb:hover { background: rgba(132, 148, 149, 0.35); }
    .aurora-ta { scrollbar-width: thin; scrollbar-color: rgba(132, 148, 149, 0.2) transparent; }
  `;
  document.head.appendChild(style);
}

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

interface GhostInputProps {
  sessionId?: string | null;
  value: string;
  onChange: (value: string) => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  history: string[];
  placeholder?: string;
  className?: string;
  inputClassName?: string;
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
}: GhostInputProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLSpanElement>(null);
  const textMetricsClass = "font-code-base text-[13px] font-normal leading-[22px]";

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

  const histNavRef = useRef<number>(-1);
  const draftRef = useRef<string>("");

  const uniqueHistory = [...new Set(history.filter(Boolean).map(cmd => cmd.replace(/`+$/, '')))];

  const ghost = computeGhost(value, uniqueHistory);

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
    histNavRef.current = -1;

    requestAnimationFrame(() => {
      inputRef.current?.setSelectionRange(nextValue.length, nextValue.length);
    });

    return true;
  }, [ghost, onChange, value]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "c" && e.ctrlKey) {
        const runningBlockId = sessionId ? useBlockStore.getState().runningBlockId[sessionId] : null;
        if (sessionId && runningBlockId) {
          e.preventDefault();
          pty.write(sessionId, "\u0003").catch(console.error);

          useBlockStore.getState().updateBlock(sessionId, runningBlockId, {
            status: "cancelled",
            finished_at: Date.now(),
          });
          useBlockStore.getState().setRunningBlockId(sessionId, null);
          return;
        }
      }

      if (e.key === "Tab") {
        e.preventDefault();
        acceptGhostCompletion();
        return;
      }

      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        if (acceptGhostCompletion()) {
          e.preventDefault();
        }
        return;
      }

      // History navigation
      if (e.key === "ArrowUp") {
        e.preventDefault();
        const commands = uniqueHistory;
        if (commands.length === 0) return;

        if (histNavRef.current === -1) {
          draftRef.current = value;
          histNavRef.current = commands.length - 1;
        } else if (histNavRef.current > 0) {
          histNavRef.current -= 1;
        }
        onChange(commands[histNavRef.current] ?? "");
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        const commands = uniqueHistory;
        if (histNavRef.current === -1) return;

        if (histNavRef.current < commands.length - 1) {
          histNavRef.current += 1;
          onChange(commands[histNavRef.current] ?? "");
        } else {
          histNavRef.current = -1;
          onChange(draftRef.current);
        }
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
        histNavRef.current = -1;
      }
    },
    [acceptGhostCompletion, uniqueHistory, onChange, value, sessionId]
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
      histNavRef.current = -1;
      onChange(e.target.value);
    },
    [onChange]
  );

  const [ghostLeft, setGhostLeft] = useState(0);
  const TA_MAX_HEIGHT = 350;

  // Auto-resize textarea height based on content
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

  return (
    <form onSubmit={onSubmit} className={`flex items-start ${className}`} onClick={handleWrapperClick}>
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
          className={`aurora-ta w-full bg-transparent border-none focus:ring-0 mt-4 pb-1 px-5 placeholder:text-outline/30 outline-none text-on-surface relative z-10 resize-none overflow-x-hidden whitespace-pre-wrap break-words ${textMetricsClass} ${inputClassName}`}
          style={{ caretColor: "var(--color-primary)", maxHeight: `${TA_MAX_HEIGHT}px` }}
        />

        {ghost && (
          <span
            aria-hidden="true"
            className={`pointer-events-none absolute left-[var(--ghost-left)] top-4 pb-1 z-0 select-none whitespace-pre ${textMetricsClass} text-primary/20`}
            style={{ ["--ghost-left" as string]: `${20 + ghostLeft}px` }}
          >
            {ghost}
          </span>
        )}
      </div>
    </form>
  );
}
