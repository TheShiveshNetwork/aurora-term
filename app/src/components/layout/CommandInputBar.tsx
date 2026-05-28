import { type FormEvent } from "react";
import { Command, Mic, Plus, RefreshCw, FolderOpen, Square } from "lucide-react";

import { GhostInput } from "../terminal/GhostInput";

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
}: CommandInputBarProps) {
  const isPrompt = variant === "prompt";

  if (!sessionId && !isPrompt) return null;

  return (
    <div
      className={isPrompt ? "absolute bottom-3 left-3 right-3 z-20" : "p-3 w-full"}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        window.dispatchEvent(new CustomEvent("aurora-right-click-menu-close"));
        window.dispatchEvent(new CustomEvent("show-context-menu", { detail: { x: event.clientX, y: event.clientY, source: "input" } }));
      }}
    >
      <div
        className={
          isPrompt
            ? "warp-input-glow flex flex-col bg-surface-container-low/60 backdrop-blur-xl border border-white/10 overflow-hidden shadow-2xl rounded-xl"
            : "warp-input-glow flex flex-col bg-surface-container-high/20 border border-outline-variant/20 overflow-hidden shadow-2xl rounded-lg"
        }
      >
        {!isPrompt && (
          <div className="flex items-center px-4 py-1.5 bg-surface-container-high/30 border-b border-outline-variant/10 select-none h-[29px]">
            {isLoading ? (
              <span className="text-[10px] text-primary tracking-widest flex items-center gap-1.5 select-none animate-spin pr-1">
                <RefreshCw size={10} />
              </span>
            ) : (
              <span className="text-[10px] text-outline/50 tracking-widest flex items-center gap-1.5">
                <FolderOpen size={10} />
                {cwd}
              </span>
            )}
          </div>
        )}

        {isRunning ? (
          <div className="flex items-center justify-between px-4 py-3 bg-surface-container-high/10">
            <div className="flex items-center gap-2 text-on-surface text-sm">
              <RefreshCw size={14} className="animate-spin text-primary" />
              <span className="text-primary">Executing command...</span>
              <span className="text-outline/50 text-xs">Ctrl + C to cancel</span>
            </div>
            <button onClick={onStop} className="px-3 py-1.5 text-xs bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg transition-colors cursor-pointer border border-red-500/20" title="Stop Command (Ctrl+C)">
              <span className="flex items-center gap-1">
                <Square size={10} />
                Stop
              </span>
            </button>
          </div>
        ) : (
          <div className="flex items-start">
            <GhostInput sessionId={sessionId} value={value} onChange={onChange} onSubmit={onSubmit} history={history} placeholder="Type a command or describe goal..." className="flex-1" />
            <div className="flex items-center gap-1 pr-3 py-3 self-end">
              <button type="button" className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface-variant/30 text-outline/50 hover:text-primary transition-all cursor-pointer" title="Add File">
                <Plus size={14} />
              </button>
              <button type="button" onClick={onOpenAiBar} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface-variant/30 text-outline/50 hover:text-primary transition-all cursor-pointer" title="Ask AI">
                <Command size={14} />
              </button>
              <button type="button" className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface-variant/30 text-outline/50 hover:text-secondary transition-all cursor-pointer" title="Audio Mode">
                <Mic size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
