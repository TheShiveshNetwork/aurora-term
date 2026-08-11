import { useState } from "react";
import { HelpCircle, Send, X } from "lucide-react";

interface QuestionApprovalCardProps {
  question: string;
  onAnswer: (answer: string) => void;
  onSkip?: () => void;
  isRunning?: boolean;
  className?: string;
}

export function QuestionApprovalCard({
  question,
  onAnswer,
  onSkip,
  isRunning = false,
  className = "",
}: QuestionApprovalCardProps) {
  const [answer, setAnswer] = useState("");

  const submit = () => {
    const trimmed = answer.trim();
    if (!trimmed || isRunning) return;
    onAnswer(trimmed);
  };

  return (
    <div
      className={`rounded-[14px] overflow-hidden animate-fadeIn flex flex-col max-h-[260px] shrink-0 ${className}`}
      style={{
        background: "rgba(15,19,26,0.95)",
        boxShadow: "0 4px 24px rgba(0,0,0,0.35), 0 0 0 1px rgba(96,165,250,0.10)",
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 shrink-0 border-b border-white/[0.04]">
        <HelpCircle size={12} className="text-blue-400/90 shrink-0" />
        <span className="text-[11px] font-bold tracking-wider text-blue-400/90 uppercase">
          Clarifying Question
        </span>
      </div>

      {/* Question area */}
      <div className="px-3 py-2 flex-1 min-h-0 overflow-y-auto scrollbar-thin select-text">
        <p className="text-[11px] text-on-surface/70 leading-relaxed whitespace-pre-wrap break-words">
          {question}
        </p>
      </div>

      {/* Answer input + actions pinned to bottom */}
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
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "rgba(232,234,240,0.80)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; e.currentTarget.style.color = "rgba(232,234,240,0.50)"; }}
            title="Skip this question"
          >
            <X size={12} />
            Skip
          </button>
        )}
        <button
          onClick={submit}
          disabled={isRunning || !answer.trim()}
          className="flex items-center justify-center gap-1.5 bg-blue-500/90 hover:bg-blue-400 text-white text-[11px] font-bold py-2 px-3 rounded-[9px] transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
        >
          {isRunning ? (
            <><span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />Sending…</>
          ) : (
            <><Send size={10} />Send</>
          )}
        </button>
      </div>
    </div>
  );
}

export default QuestionApprovalCard;
