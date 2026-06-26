import { type FormEvent } from "react";
import { Command, Plus, RefreshCw, FolderOpen, Square, Mic } from "lucide-react";

import { GhostInput } from "../terminal/GhostInput";
import type { InputMode } from "../../lib/nlClassifier";
import { closeAllPopups } from "../../lib/popups";

type Variant = "command" | "prompt";

interface CommandInputBarProps {
  sessionId: string | null;
  cwd: string;
  isLoading: boolean;
  isRunning: boolean;
  value: string;
  history: string[];
  onChange: (value: string | ((previous: string) => string)) => void;
  onSubmit: (event: FormEvent) => void;
  onStop?: () => void;
  onOpenAiBar?: () => void;
  variant?: Variant;
  inputMode?: InputMode;
}

export function CommandInputBar({
  sessionId,
  cwd,
  isLoading,
  isRunning,
  value,
  history,
  onChange,
  onSubmit,
  onStop,
  onOpenAiBar,
  variant = "command",
  inputMode = "unknown",
}: CommandInputBarProps) {
  const isPrompt = variant === "prompt";

  if (!sessionId && !isPrompt) return null;

  return (
    <div
      className={isPrompt ? "absolute bottom-3 left-3 right-3 z-20" : "px-3 pb-3 w-full"}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        closeAllPopups();
        window.dispatchEvent(new CustomEvent("show-context-menu", { detail: { x: event.clientX, y: event.clientY, source: "input" } }));
      }}
    >
      <div
        className={`warp-input-glow flex flex-col overflow-hidden rounded-md ${isPrompt ? "backdrop-blur-xl" : ""}`}
        style={{
          background: isPrompt ? "rgba(10,13,20,0.65)" : "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.07)",
          boxShadow: isPrompt ? "0 8px 12px rgba(0,0,0,0.25)" : "0 4px 24px rgba(0,0,0,0.15)",
        }}
      >
        {/* CWD breadcrumb */}
        {!isPrompt && (
          <div
            className="flex items-center justify-between px-4 py-1.5 select-none"
            style={{
              borderBottom: "1px solid rgba(255,255,255,0.05)",
              minHeight: "28px",
            }}
          >
            <div className="flex items-center gap-2 flex-1 min-w-0">
              {isLoading ? (
                <span className="flex items-center gap-1.5 text-[10px]" style={{ color: "#4F8CFF" }}>
                  <RefreshCw size={10} className="animate-spin shrink-0" />
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-[10px] truncate" style={{ color: "rgba(232,234,240,0.3)" }}>
                  <FolderOpen size={10} className="shrink-0" />
                  {cwd}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Body */}
        {isRunning ? (
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2.5 text-sm" style={{ color: "#4F8CFF" }}>
              <RefreshCw size={13} className="animate-spin shrink-0" />
              <span className="text-[13px] font-medium">Executing…</span>
              <span className="text-[11px]" style={{ color: "rgba(232,234,240,0.3)" }}>Ctrl+C to cancel</span>
            </div>
            <button
              onClick={onStop}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-[10px] transition-all cursor-pointer"
              style={{
                background: "rgba(255,107,107,0.08)",
                border: "1px solid rgba(255,107,107,0.20)",
                color: "#FF6B6B",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,107,107,0.14)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(255,107,107,0.08)")}
              title="Stop Command (Ctrl+C)"
            >
              <Square size={10} />
              Stop
            </button>
          </div>
        ) : (
          <div className="flex items-start">
            <GhostInput
              sessionId={sessionId}
              value={value}
              onChange={onChange}
              onSubmit={onSubmit}
              history={history}
              placeholder="Type a command or describe a goal…"
              className="flex-1"
              inputMode={inputMode}
            />
            <div className="flex items-center gap-0.5 pr-3 py-3 self-end">
              <IconButton title="Attach File">
                <Plus size={14} />
              </IconButton>
              <IconButton onClick={onOpenAiBar} title="Agent (⌘K)">
                <Command size={14} />
              </IconButton>
              <IconButton title="Voice Input">
                <Mic size={14} />
              </IconButton>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function IconButton({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="w-8 h-8 flex items-center justify-center rounded-[10px] transition-all cursor-pointer"
      style={{ color: "rgba(232,234,240,0.35)" }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "rgba(255,255,255,0.06)";
        e.currentTarget.style.color = "#4F8CFF";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = "rgba(232,234,240,0.35)";
      }}
    >
      {children}
    </button>
  );
}
