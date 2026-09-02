import React, { useEffect, useState } from "react";
import {
  Terminal,
  Play,
  X,
  HelpCircle,
  Send,
  FileText,
  FilePlus2,
  FilePen,
} from "lucide-react";
import { system } from "../../lib/ipc";

type ApprovalKind = "command" | "file" | "question";

interface ToolApprovalCardProps {
  kind: ApprovalKind;
  // command
  command?: string;
  explanation?: string;
  // file
  toolName?: string; // "write_file" | "patch_file"
  args?: any;
  // question
  question?: string;
  // handlers
  onApprove?: () => void;
  onSkip?: () => void;
  onAnswer?: (text: string) => void;
  isRunning?: boolean;
  className?: string;
}

const shell =
  "rounded-[14px] overflow-hidden animate-fadeIn flex flex-col max-h-[320px] shrink-0";

const cardBg: Record<ApprovalKind, React.CSSProperties> = {
  command: {
    background: "rgba(15,19,26,0.95)",
    boxShadow: "0 4px 24px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,200,60,0.08)",
  },
  file: {
    background: "rgba(15,19,26,0.95)",
    boxShadow: "0 4px 24px rgba(0,0,0,0.35), 0 0 0 1px rgba(120,180,255,0.10)",
  },
  question: {
    background: "rgba(15,19,26,0.95)",
    boxShadow: "0 4px 24px rgba(0,0,0,0.35), 0 0 0 1px rgba(96,165,250,0.10)",
  },
};

function shortPath(p?: string): string {
  if (!p) return "(unknown path)";
  return p.split(/[\\/]/).pop() || p;
}

export function ToolApprovalCard({
  kind,
  command,
  explanation,
  toolName,
  args,
  question,
  onApprove,
  onSkip,
  onAnswer,
  isRunning = false,
  className = "",
}: ToolApprovalCardProps) {
  const [answer, setAnswer] = useState("");
  // For write_file, fetch the current file content so we can show an actual
  // before/after diff instead of just the proposed content.
  const [currentContent, setCurrentContent] = useState<string | null>(null);
  const [loadingCurrent, setLoadingCurrent] = useState(false);
  useEffect(() => {
    if (kind !== "file" || toolName !== "write_file" || !args?.path) return;
    let cancelled = false;
    setLoadingCurrent(true);
    system
      .readFileContent(args.path)
      .then((c) => {
        if (!cancelled) setCurrentContent(typeof c === "string" ? c : null);
      })
      .catch(() => {
        if (!cancelled) setCurrentContent(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingCurrent(false);
      });
    return () => {
      cancelled = true;
    };
  }, [kind, toolName, args?.path]);

  const headerIcon =
    kind === "command" ? (
      <Terminal size={12} className="text-amber-400/90 shrink-0" />
    ) : kind === "file" ? (
      toolName === "patch_file" ? (
        <FilePen size={12} className="text-sky-400/90 shrink-0" />
      ) : (
        <FilePlus2 size={12} className="text-sky-400/90 shrink-0" />
      )
    ) : (
      <HelpCircle size={12} className="text-blue-400/90 shrink-0" />
    );

  const headerTitle =
    kind === "command"
      ? "Awaiting Approval"
      : kind === "file"
      ? `Awaiting Approval · ${toolName === "patch_file" ? "File Patch" : "File Write"}`
      : "Clarifying Question";

  const accentBtn =
    kind === "command"
      ? "bg-amber-400/80 hover:bg-amber-400 text-black"
      : kind === "file"
      ? "bg-sky-400/80 hover:bg-sky-400 text-black"
      : "bg-blue-500/90 hover:bg-blue-400 text-white";

  const accentIconColor =
    kind === "command"
      ? "rgba(255,200,120,0.95)"
      : kind === "file"
      ? "rgba(180,220,255,0.95)"
      : "rgba(232,234,240,0.90)";

  if (kind === "question") {
    const submit = () => {
      const trimmed = answer.trim();
      if (!trimmed || isRunning || !onAnswer) return;
      onAnswer(trimmed);
    };
    return (
      <div className={`${shell} ${className}`} style={cardBg.question}>
        <div className="flex items-center gap-2 px-3 py-2 shrink-0 border-b border-white/[0.04]">
          {headerIcon}
          <span className="text-[11px] font-bold tracking-wider text-blue-400/90">
            {headerTitle}
          </span>
        </div>
        <div className="px-3 py-2 flex-1 min-h-0 overflow-y-auto scrollbar-thin select-text">
          <p className="text-[11px] text-on-surface/70 leading-relaxed whitespace-pre-wrap break-words">
            {question}
          </p>
        </div>
        <div className="flex items-center gap-2 px-3 py-2.5 shrink-0 border-t border-white/[0.04] bg-[#0F131A]">
          <input
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") setAnswer("");
            }}
            disabled={isRunning}
            placeholder="Type your answer…"
            autoFocus
            className="flex-1 min-w-0 text-[11px] px-3 py-2 rounded-[9px] outline-none placeholder:text-white/25"
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.09)",
              color: "rgba(232,234,240,0.90)",
            }}
          />
          {onSkip && (
            <button
              onClick={onSkip}
              disabled={isRunning}
              className="flex items-center justify-center gap-1.5 text-[11px] font-bold py-2 px-2.5 rounded-[9px] transition-all cursor-pointer disabled:opacity-50"
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.09)",
                color: "rgba(232,234,240,0.50)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(255,255,255,0.08)";
                e.currentTarget.style.color = "rgba(232,234,240,0.80)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(255,255,255,0.04)";
                e.currentTarget.style.color = "rgba(232,234,240,0.50)";
              }}
              title="Skip this question"
            >
              <X size={12} />
              Skip
            </button>
          )}
          <button
            onClick={submit}
            disabled={isRunning || !answer.trim()}
            className={`flex items-center justify-center gap-1.5 text-[11px] font-bold py-2 px-3 rounded-[9px] transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-md ${accentBtn}`}
          >
            {isRunning ? (
              <>
                <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                Sending…
              </>
            ) : (
              <>
                <Send size={10} />
                Send
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`${shell} ${className}`} style={cardBg[kind]}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 shrink-0 border-b border-white/[0.04]">
        {headerIcon}
        <span
          className={`text-[11px] font-bold tracking-wider ${
            kind === "command" ? "text-amber-400/90" : "text-sky-400/90"
          }`}
        >
          {headerTitle}
        </span>
      </div>

      {/* Body */}
      <div className="px-3 py-2 flex-1 min-h-0 overflow-y-auto scrollbar-thin select-text space-y-2">
        {kind === "command" && explanation && (
          <p className="text-[11px] text-on-surface/60 leading-relaxed">{explanation}</p>
        )}
        {kind === "file" && args?.explanation && (
          <p className="text-[11px] text-on-surface/60 leading-relaxed">{args.explanation}</p>
        )}

        {kind === "command" ? (
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
        ) : (
          <>
            <div className="flex items-center gap-1.5 min-w-0">
              <FileText size={11} className="text-sky-400/70 shrink-0" />
              <span className="text-[11px] font-mono text-on-surface/70 truncate" title={args?.path}>
                {args?.path || shortPath(args?.path)}
              </span>
            </div>
            {toolName === "patch_file" ? (
              <>
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-white/35 mb-1">
                    Search
                  </div>
                  <pre
                    className="font-mono text-[12px] leading-relaxed break-all select-text whitespace-pre-wrap rounded-lg p-2.5 max-h-28 overflow-auto scrollbar-thin"
                    style={{
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.07)",
                      color: "rgba(255,180,180,0.95)",
                    }}
                  >
                    <code>{args?.search || ""}</code>
                  </pre>
                </div>
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-white/35 mb-1">
                    Replace
                  </div>
                  <pre
                    className="font-mono text-[12px] leading-relaxed break-all select-text whitespace-pre-wrap rounded-lg p-2.5 max-h-28 overflow-auto scrollbar-thin"
                    style={{
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.07)",
                      color: accentIconColor,
                    }}
                  >
                    <code>{args?.replace || ""}</code>
                  </pre>
                </div>
              </>
            ) : (
              <>
                {currentContent !== null && (
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-white/35 mb-1">
                      Current file
                    </div>
                    <pre
                      className="font-mono text-[12px] leading-relaxed break-all select-text whitespace-pre-wrap rounded-lg p-2.5 max-h-32 overflow-auto scrollbar-thin"
                      style={{
                        background: "rgba(255,255,255,0.03)",
                        border: "1px solid rgba(255,255,255,0.06)",
                        color: "rgba(200,200,210,0.80)",
                      }}
                    >
                      <code>{currentContent}</code>
                    </pre>
                  </div>
                )}
                {loadingCurrent && (
                  <p className="text-[10px] text-on-surface/40">Reading current file…</p>
                )}
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-white/35 mb-1">
                    {currentContent !== null ? "Proposed change" : "New file content"}
                  </div>
                  <pre
                    className="font-mono text-[12px] leading-relaxed break-all select-text whitespace-pre-wrap rounded-lg p-2.5 max-h-44 overflow-auto scrollbar-thin"
                    style={{
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.07)",
                      color: accentIconColor,
                    }}
                  >
                    <code>{args?.content || ""}</code>
                  </pre>
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* Footer */}
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
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(255,255,255,0.08)";
            e.currentTarget.style.color = "rgba(232,234,240,0.80)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(255,255,255,0.04)";
            e.currentTarget.style.color = "rgba(232,234,240,0.50)";
          }}
          title={kind === "file" ? "Reject this file change" : "Skip this command"}
        >
          <X size={12} />
          {kind === "file" ? "Reject" : "Skip"}
        </button>
        <button
          onClick={onApprove}
          disabled={isRunning}
          className={`flex-1 flex items-center justify-center text-[11px] font-bold py-2 rounded-[9px] transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-md ${accentBtn}`}
        >
          {isRunning ? (
            <>
              <span className="w-3 h-3 border-2 border-black/40 border-t-black rounded-full animate-spin" />
              {kind === "file" ? "Applying…" : "Running…"}
            </>
          ) : (
            <>
              <Play size={10} fill="currentColor" />
              {kind === "file" ? "Approve & Apply" : "Approve & Run"}
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// ── Factory ────────────────────────────────────────────────────────────────
export interface ApprovalCardState {
  isPaused: boolean;
  pendingToolCall?: { name: string; args: any } | null;
  pendingApprovalCmd?: { command: string; explanation?: string } | null;
  pendingAsk?: { question: string } | null;
  onApprove: () => void;
  onSkip: () => void;
  onSubmit: (text: string) => void;
  isRunning?: boolean;
  className?: string;
}

export function makeApprovalCard(s: ApprovalCardState): React.ReactNode {
  if (!s.isPaused) return null;
  if (s.pendingAsk) {
    return (
      <ToolApprovalCard
        kind="question"
        question={s.pendingAsk.question}
        onAnswer={s.onSubmit}
        onSkip={s.onSkip}
        isRunning={s.isRunning}
        className={s.className}
      />
    );
  }
  if (s.pendingApprovalCmd) {
    return (
      <ToolApprovalCard
        kind="command"
        command={s.pendingApprovalCmd.command}
        explanation={s.pendingApprovalCmd.explanation}
        onApprove={s.onApprove}
        onSkip={s.onSkip}
        isRunning={s.isRunning}
        className={s.className}
      />
    );
  }
  if (s.pendingToolCall?.name === "write_file" || s.pendingToolCall?.name === "patch_file") {
    return (
      <ToolApprovalCard
        kind="file"
        toolName={s.pendingToolCall.name}
        args={s.pendingToolCall.args}
        onApprove={s.onApprove}
        onSkip={s.onSkip}
        isRunning={s.isRunning}
        className={s.className}
      />
    );
  }
  return null;
}

export default ToolApprovalCard;
