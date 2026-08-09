import React from "react";
import { Terminal, Play, X } from "lucide-react";

interface CommandApprovalCardProps {
  command: string;
  explanation?: string;
  onApprove: () => void;
  onSkip: () => void;
  isRunning?: boolean;
  className?: string;
}

export function CommandApprovalCard({
  command,
  explanation,
  onApprove,
  onSkip,
  isRunning = false,
  className = "",
}: CommandApprovalCardProps) {
  return (
    <div
      className={`rounded-[14px] overflow-hidden animate-fadeIn flex flex-col max-h-[260px] shrink-0 ${className}`}
      style={{
        background: "rgba(15,19,26,0.95)",
        boxShadow: "0 4px 24px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,200,60,0.08)",
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 shrink-0 border-b border-white/[0.04]">
        <Terminal size={12} className="text-amber-400/90 shrink-0" />
        <span className="text-[11px] font-bold tracking-wider text-amber-400/90 uppercase">
          Awaiting Approval
        </span>
      </div>

      {/* Scrollable Prose / Command area */}
      <div className="px-3 py-2 flex-1 min-h-0 overflow-y-auto scrollbar-thin select-text space-y-2">
        {explanation && (
          <p className="text-[11px] text-on-surface/60 leading-relaxed">{explanation}</p>
        )}
        <pre
          className="font-mono text-[12px] leading-relaxed break-all select-text whitespace-pre-wrap rounded-lg p-2.5"
          style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.07)",
            color: "rgba(180,220,255,0.95)",
          }}
        >
          <code>{command}</code>
        </pre>
      </div>

      {/* Action buttons pinned to bottom */}
      <div className="flex items-center gap-2 px-3 py-2.5 shrink-0 border-t border-white/[0.04] bg-[#0F131A]">
        <button
          onClick={onSkip}
          disabled={isRunning}
          className="flex-1 flex items-center justify-center gap-1.5 text-[11px] font-bold py-2 px-3 rounded-[9px] transition-all cursor-pointer disabled:opacity-50"
          style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.09)",
            color: "rgba(232,234,240,0.50)",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "rgba(232,234,240,0.80)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; e.currentTarget.style.color = "rgba(232,234,240,0.50)"; }}
          title="Skip this command"
        >
          <X size={12} />
          Skip
        </button>
        <button
          onClick={onApprove}
          disabled={isRunning}
          className="flex-1 flex items-center justify-center bg-amber-400/80 hover:bg-amber-400 text-black gap-1.5 text-[11px] font-bold py-2 rounded-[9px] transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
        >
          {isRunning ? (
            <><span className="w-3 h-3 border-2 border-black/40 border-t-black rounded-full animate-spin" />Running…</>
          ) : (
            <><Play size={10} fill="currentColor" />Approve & Run</>
          )}
        </button>
      </div>
    </div>
  );
}

export default CommandApprovalCard;
