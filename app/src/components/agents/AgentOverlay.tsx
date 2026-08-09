import { useState, useEffect, useRef, useCallback } from "react";
import {
  X,
  RotateCw,
  Code2,
  Search,
  ShieldCheck,
  Play,
  Terminal,
} from "lucide-react";
import { useAgentExecution } from "../../hooks/useAgentExecution";
import { useAgentStore, ChatMessage, CONST_DEFAULT_SESSION_STATE } from "../../stores/useAgentStore";
import { useCopyWithFeedback } from "../../hooks/useCopyWithFeedback";
import { useHasApiKeyConfigured, ProviderSetupPrompt } from "./ProviderSetupPrompt";
import { AgentTurnMessage } from "./AgentMessages";

// ── Log panel ─────────────────────────────────────────────────────────────
function LogPanel({ logs }: { logs: { timestamp: number; type: string; content: string; subagent?: string }[] }) {
  return (
    <div className="flex flex-col gap-1 max-h-32 scrollable-overlay aurora-ta text-[10px] text-on-surface-variant/60">
      {logs.map((log, i) => (
        <div key={i} className="leading-relaxed break-all">
          {log.content}
        </div>
      ))}
    </div>
  );
}

// ── Status helpers ────────────────────────────────────────────────────────
function ActiveSubagentBadge({ subagent }: { subagent: string | null }) {
  if (!subagent) return null;
  const map: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
    coder: { label: "Coder", icon: <Code2 size={9} />, color: "text-blue-300 bg-blue-500/10 border-blue-500/25" },
    researcher: { label: "Researcher", icon: <Search size={9} />, color: "text-purple-300 bg-purple-500/10 border-purple-500/25" },
    validator: { label: "Validator", icon: <ShieldCheck size={9} />, color: "text-emerald-300 bg-emerald-500/10 border-emerald-500/25" },
  };
  const info = map[subagent];
  if (!info) return null;
  return (
    <span className={`flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded-full border ${info.color}`}>
      {info.icon}
      {info.label}
    </span>
  );
}

// ── Turn wrapper ──────────────────
function TurnMessageWrapper({
  turn,
  isLastTurn,
  isThinking,
  chainNodes,
  durationSecs,
  stepCount,
  maxSteps,
  retryTask,
}: {
  turn: { user: ChatMessage | null; assistant: ChatMessage | null };
  isLastTurn: boolean;
  isThinking: boolean;
  chainNodes: any[];
  durationSecs: number;
  stepCount: number;
  maxSteps: number;
  retryTask: () => void;
}) {
  const { copied, handleCopy } = useCopyWithFeedback();
  const [liked, setLiked] = useState(false);
  const [disliked, setDisliked] = useState(false);

  return (
    <AgentTurnMessage
      userMsg={turn.user}
      assistantMsg={turn.assistant}
      isThinking={isThinking}
      isLastTurn={isLastTurn}
      chainNodes={chainNodes}
      durationSecs={durationSecs}
      stepCount={stepCount}
      maxSteps={maxSteps}
      onCopy={handleCopy}
      copied={copied}
      onLike={() => { setLiked(!liked); setDisliked(false); }}
      onDislike={() => { setDisliked(!disliked); setLiked(false); }}
      onRetry={retryTask}
    />
  );
}

// ── Empty State ──────────────────────────────────────────────
function NoApiKeysOrEmpty() {
  const hasApiKey = useHasApiKeyConfigured();
  if (!hasApiKey) {
    return <ProviderSetupPrompt compact />;
  }
  return (
    <div className="flex flex-col items-center justify-center h-full py-12 gap-3 text-center animate-fadeIn">
      <div>
        <p className="text-xs font-semibold text-white/50">Nothing to show yet</p>
        <p className="text-xs mt-0.5 text-white/20">Run a command or describe a goal</p>
      </div>
    </div>
  );
}

import { CommandApprovalCard } from "./CommandApprovalCard";

interface AgentOverlayProps {
  sessionId: string | null;
  onClose?: () => void;
}

export function AgentOverlay({ sessionId, onClose }: AgentOverlayProps) {
  const {
    status,
    queue,
    stepCount,
    maxSteps,
    chainNodes,
    activeSubagent,
    approveAndRunPending,
    declinePending,
    clearTask,
    retryTask,
    chatHistory,
  } = useAgentExecution(sessionId);

  // Stats / duration timer
  const [durationSecs, setDurationSecs] = useState<number>(0);
  const timerRef = useRef<any>(null);

  useEffect(() => {
    if (status === "planning" || status === "executing") {
      const startTime = Date.now();
      setDurationSecs(0);
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        setDurationSecs(Math.round((Date.now() - startTime) / 1000));
      }, 1000);
    } else if (status === "completed" || status === "error") {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      const totalMs = queue.reduce((acc, cmd) => acc + (cmd.durationMs || 0), 0);
      if (totalMs > 0) setDurationSecs(Math.round(totalMs / 1000));
    } else if (status === "idle") {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      setDurationSecs(0);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [status, queue]);

  // Scroll logic
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const userScrolledUp = useRef(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
      userScrolledUp.current = !atBottom;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const prevHistoryLen = useRef(0);
  useEffect(() => {
    const newLen = chatHistory.length;
    if (newLen !== prevHistoryLen.current) {
      prevHistoryLen.current = newLen;
      userScrolledUp.current = false;
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatHistory.length]);

  useEffect(() => {
    if (!userScrolledUp.current && (status === "planning" || status === "executing")) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [stepCount, status]);

  const isPaused = status === "paused";
  const isThinking = status === "planning" || status === "executing" || isPaused;
  const [approvalRunning, setApprovalRunning] = useState(false);

  const pendingApprovalIndex = queue.findIndex((cmd) => cmd.status === "requires_action");
  const pendingApprovalCmd = pendingApprovalIndex !== -1 ? queue[pendingApprovalIndex] : null;

  const handleApprove = useCallback(async () => {
    setApprovalRunning(true);
    try {
      await approveAndRunPending();
    } finally {
      setApprovalRunning(false);
    }
  }, [approveAndRunPending]);

  const handleSkip = useCallback(async () => {
    await declinePending();
  }, [declinePending]);

  // Group chat history into turns, supporting standalone assistant messages/errors
  const turns: Array<{ user: ChatMessage | null; assistant: ChatMessage | null }> = [];
  let idx = 0;
  while (idx < chatHistory.length) {
    const msg = chatHistory[idx];
    if (msg.role === "user") {
      const next = chatHistory[idx + 1];
      if (next?.role === "assistant") {
        turns.push({ user: msg, assistant: next });
        idx += 2;
      } else {
        turns.push({ user: msg, assistant: null });
        idx += 1;
      }
    } else if (msg.role === "assistant") {
      turns.push({ user: null, assistant: msg });
      idx += 1;
    } else {
      idx += 1;
    }
  }
  const lastTurnIndex = turns.length - 1;

  return (
    <div className="flex flex-col h-full w-full bg-transparent overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 h-13 shrink-0"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
      >
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-semibold tracking-wide text-[#E8EAF0]">Aura</span>
          <ActiveSubagentBadge subagent={activeSubagent} />
        </div>

        <button
          onClick={() => onClose?.()}
          className="p-1.5 rounded-[8px] transition-all cursor-pointer"
          style={{ color: "rgba(232,234,240,0.3)" }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.color = "#E8EAF0"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "rgba(232,234,240,0.3)"; }}
          title="Close agent panel"
        >
          <X size={13} />
        </button>
      </div>

      {/* Chat scroll container */}
      <div
        ref={scrollRef}
        className="flex-1 scrollable-overlay px-4 pt-3"
        style={{ scrollbarGutter: "stable" }}
      >
        {chatHistory.length === 0 && (
          <NoApiKeysOrEmpty />
        )}

        {turns.map((turn, idx) => {
          const isLastTurn = idx === lastTurnIndex;
          return (
            <TurnMessageWrapper
              key={turn.user?.id || turn.assistant?.id || `turn-${idx}`}
              turn={turn}
              isLastTurn={isLastTurn}
              isThinking={isLastTurn && isThinking}
              chainNodes={turn.assistant?.chainNodes || (isLastTurn ? chainNodes : [])}
              durationSecs={durationSecs}
              stepCount={stepCount}
              maxSteps={maxSteps}
              retryTask={retryTask}
            />
          );
        })}

        <div ref={bottomRef} className="h-2" />
      </div>

      {/* Command Approval Card */}
      {isPaused && pendingApprovalCmd && (
        <CommandApprovalCard
          command={pendingApprovalCmd.command}
          explanation={pendingApprovalCmd.explanation}
          onApprove={handleApprove}
          onSkip={handleSkip}
          isRunning={approvalRunning}
        />
      )}

      {/* Footer */}
      {chatHistory.length > 0 && (
        <div
          className="shrink-0 flex items-center justify-between px-4 py-2 select-none"
          style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
        >
          <span className="text-[10px]" style={{ color: "rgba(232,234,240,0.25)" }}>
            {turns.length} turn{turns.length !== 1 ? "s" : ""}
          </span>
          <button
            onClick={clearTask}
            className="flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1 rounded-[8px] transition-all cursor-pointer animate-fadeIn"
            style={{ color: "rgba(232,234,240,0.4)" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.color = "#E8EAF0"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "rgba(232,234,240,0.4)"; }}
          >
            <RotateCw size={10} />
            Clear session
          </button>
        </div>
      )}
    </div>
  );
}
export default AgentOverlay;
