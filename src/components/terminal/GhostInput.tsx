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

// ─── Compute ghost suggestion ──────────────────────────────────────────────────
// Scans `history` from the end (most-recent) and returns the suffix of the
// first entry that starts with `input` (case-insensitive).
// history is expected oldest → newest so the scan runs newest-first.
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


// ─── Props ─────────────────────────────────────────────────────────────────────
interface GhostInputProps {
  sessionId?: string | null;
  value: string;
  onChange: (value: string) => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  history: string[]; // all past commands for this session, oldest → newest
  placeholder?: string;
  className?: string;
  inputClassName?: string;
}

// ─── Component ─────────────────────────────────────────────────────────────────
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
  const inputRef = useRef<HTMLInputElement>(null);
  const mirrorRef = useRef<HTMLSpanElement>(null);
  const textMetricsClass = "font-code-base text-[13px] font-normal leading-[48px]";

  useEffect(() => {
    const handleFocus = () => inputRef.current?.focus();
    window.addEventListener("aurora-focus-terminal-input", handleFocus);
    return () => window.removeEventListener("aurora-focus-terminal-input", handleFocus);
  }, []);

  // History navigation index (-1 = not navigating / live input)
  const histNavRef = useRef<number>(-1);
  // Stash the live (unsaved) draft while navigating history
  const draftRef = useRef<string>("");

  // Deduplicated, reversed history for ghost matching (most recent first)
  const uniqueHistory = [...new Set(history.filter(Boolean))];

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

  // Accept ghost text on Tab
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
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
          // Start navigating — stash the live draft
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
          // Reached end of history → restore draft
          histNavRef.current = -1;
          onChange(draftRef.current);
        }
        return;
      }

      // Any other typing resets history navigation
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
    [acceptGhostCompletion, uniqueHistory]
  );

  // Raw paste — strip all formatting, insert plain text only
  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLInputElement>) => {
      e.preventDefault();
      const rawText = e.clipboardData.getData("text/plain");
      const el = inputRef.current;
      if (!el) return;

      const start = el.selectionStart ?? value.length;
      const end = el.selectionEnd ?? value.length;
      const next = value.slice(0, start) + rawText + value.slice(end);
      onChange(next);

      // Move cursor to after pasted content
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
    (e: React.ChangeEvent<HTMLInputElement>) => {
      histNavRef.current = -1;
      onChange(e.target.value);
    },
    [onChange]
  );

  // ── Measure the input text width for ghost overlay positioning ─────────────
  // We use a hidden <span> mirror to measure pixel offset.
  const [ghostLeft, setGhostLeft] = useState(0);

  useLayoutEffect(() => {
    const mirrorEl = mirrorRef.current;
    if (!mirrorEl) return;
    const measuredWidth = mirrorEl.getBoundingClientRect().width;
    setGhostLeft((prev) => (Math.abs(prev - measuredWidth) < 0.5 ? prev : measuredWidth));
  }, [value]);

  // ── Make clicking anywhere on the wrapper focus the input ─────────────────
  const handleWrapperClick = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <form onSubmit={onSubmit} className={`flex items-center ${className}`} onClick={handleWrapperClick}>
      {/* Ghost text layer — positioned absolutely inside the relative wrapper */}
      <div className="relative flex-1 flex items-center h-12 overflow-hidden">
        {/* Hidden mirror span to measure typed-text width */}
        <span
          ref={mirrorRef}
          aria-hidden="true"
          className={`invisible pointer-events-none absolute left-5 top-0 whitespace-pre ${textMetricsClass}`}
        >
          {value || ""}
        </span>

        {/* Actual input */}
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={placeholder}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          className={`w-full bg-transparent border-none focus:ring-0 h-12 px-5 placeholder:text-outline/30 outline-none text-on-surface relative z-10 ${textMetricsClass} ${inputClassName}`}
          style={{ caretColor: "var(--color-primary)" }}
        />

        {/* Ghost suggestion overlay */}
        {ghost && (
          <span
            aria-hidden="true"
            className={`ghost-suggestion pointer-events-none absolute left-[var(--ghost-left)] top-1/2 z-0 select-none whitespace-pre -translate-y-1/2 ${textMetricsClass} text-primary/20`}
            style={{ ["--ghost-left" as string]: `${20 + ghostLeft}px` }}
          >
            {ghost}
          </span>
        )}
      </div>
    </form>
  );
}
