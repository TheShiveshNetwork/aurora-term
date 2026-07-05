import { useState, useEffect, useRef, useCallback } from "react";
import {
  X,
  RotateCcw,
  ChevronRight,
  Code2,
  Search,
  ShieldCheck,
  Copy,
  Check,
  Play,
  SkipForward,
  Terminal,
} from "lucide-react";
import { useAgentExecution } from "../../hooks/useAgentExecution";
import type { ChainNode, ChatMessage } from "../../stores/useAgentStore";
import { renderMarkdown } from "../../lib/markdown";
import { useCopyWithFeedback } from "../../hooks/useCopyWithFeedback";
import { useHasApiKeyConfigured, ProviderSetupPrompt } from "./ProviderSetupPrompt";

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

// ── Animated Farming Icon ──────────────────────────────────────────────────
function SproutFarmingIcon() {
  return (
    <div className="relative w-5 h-5 flex items-center justify-center shrink-0">
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <span className="absolute w-[2px] h-[2px] bg-amber-400 rounded-full left-[20%] bottom-[30%] animate-[floatUp_1.5s_ease-out_infinite]" />
        <span className="absolute w-[3px] h-[3px] bg-amber-400 rounded-full left-[70%] bottom-[20%] animate-[floatUp_2s_ease-out_infinite_0.4s]" />
        <span className="absolute w-[2px] h-[2px] bg-amber-400 rounded-full left-[45%] bottom-[40%] animate-[floatUp_1.8s_ease-out_infinite_0.8s]" />
      </div>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="w-4 h-4 text-amber-400 origin-bottom animate-[sway_2.5s_ease-in-out_infinite]"
      >
        <path d="M4 20h16" className="opacity-45" />
        <path d="M12 20v-8a4 4 0 0 1 4-4" />
        <path d="M12 12a4 4 0 0 0-4-4 4 4 0 0 0 4 4Z" fill="currentColor" fillOpacity="0.2" />
        <path d="M16 8a4 4 0 0 0-4-4 4 4 0 0 0 4 4Z" fill="currentColor" fillOpacity="0.2" />
      </svg>
    </div>
  );
}

// ── Mini Markdown Renderer ────────────────────────────────────────────────
// Handles: code blocks, inline code, headers, unordered/ordered lists,
// bold, italic, and proper paragraph/line-break handling.
// Also unescapes Windows paths (\\) → (\).

// ── Typing / Farming indicator ─────────────────────────────────────────────
function ThinkingBubble() {
  return (
    <div className="flex items-center gap-2.5 py-3 px-4">
      <SproutFarmingIcon />
      <span className="text-[11px] font-semibold text-amber-400/80 animate-pulse">Farming aura…</span>
    </div>
  );
}

// ── Single conversation turn ───────────────────────────────────────────────
// The user message uses sticky positioning so it stays at the top of the
// scroll container while the (possibly long) AI response scrolls beneath it.
interface TurnProps {
  userMsg: ChatMessage;
  assistantMsg: ChatMessage | null;
  isThinking: boolean;
  isLastTurn: boolean;
  detailsOpen: boolean;
  logsOpen: boolean;
  chainNodes: ChainNode[];
  agentLogs: { timestamp: number; type: string; content: string; subagent?: string }[];
  durationSecs: number;
  onToggleDetails: () => void;
  onToggleLogs: () => void;
  approveAndRunPending: () => void;
  clearTask: () => void;
  pendingApprovalCmd: { command: string; explanation: string } | null;
  isPaused: boolean;
  retryTask: () => void;
  stepCount: number;
  maxSteps: number;
}

function ConversationTurn({
  userMsg,
  assistantMsg,
  isThinking,
  isLastTurn,
  chainNodes,
  agentLogs,
  durationSecs,
  approveAndRunPending,
  clearTask,
  pendingApprovalCmd,
  isPaused,
  retryTask,
  stepCount,
  maxSteps,
}: Omit<TurnProps, "detailsOpen" | "logsOpen" | "onToggleDetails" | "onToggleLogs">) {
  const { copied, handleCopy } = useCopyWithFeedback();

  const [detailsOpen, setDetailsOpen] = useState(isThinking);
  const [logsOpen, setLogsOpen] = useState(false);

  useEffect(() => {
    setDetailsOpen(isThinking);
  }, [isThinking]);

  return (
    <div className="flex flex-col">
      {/* ── User message ── sticky so it stays in view while AI response scrolls */}
      <div
        className="sticky top-0 z-10 pb-2"
        style={{ background: "#0F131A" }}
      >
        <div
          className="rounded-[14px] px-4 py-3 text-[13px] font-medium leading-relaxed select-text"
          style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
            color: "rgba(232,234,240,0.90)",
          }}
        >
          {userMsg.content}
        </div>
      </div>

      {/* ── AI response area ─────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2 pb-4">
        {/* Execution details — shown when thinking, or when chain nodes exist, or when past turn has stored duration */}
        {(isThinking || chainNodes.length > 0 || (assistantMsg?.durationMs !== undefined && assistantMsg.durationMs > 0)) && (
          <div className="space-y-1.5 mt-1">
            <div
              onClick={() => setDetailsOpen((v) => !v)}
              className="flex items-center gap-2 cursor-pointer select-none group"
            >
              <div className="flex items-center gap-2 text-[11px] text-on-surface-variant/50 group-hover:text-on-surface-variant/70 transition-colors">
                {isThinking ? (
                  <div className="flex items-center gap-2 text-primary/70">
                    <SproutFarmingIcon />
                    <span className="font-semibold text-amber-400/80 animate-pulse">Farming…</span>
                    {stepCount > 0 && (
                      <span className="text-on-surface-variant/45 text-[9px] font-normal">(step {stepCount}/{maxSteps})</span>
                    )}
                  </div>
                ) : (
                  <span className="font-medium text-on-surface-variant/70">
                    Worked for {assistantMsg?.durationMs !== undefined ? Math.round(assistantMsg.durationMs / 1000) : durationSecs}s
                  </span>
                )}
              </div>
              {chainNodes.length > 0 && (
                <ChevronRight
                  size={11}
                  className={`text-on-surface-variant/70 transition-transform duration-200 ${detailsOpen ? "rotate-90" : ""}`}
                />
              )}
            </div>

            {detailsOpen && (
              <div className="pl-3 py-2 space-y-3 border-l border-outline-variant/15 ml-3 text-[11px] text-on-surface-variant/80 leading-normal animate-fadeIn">
                {/* Chain Flow */}
                {chainNodes.length > 0 && (
                  <div className="space-y-2">
                    {chainNodes.map((node) => {
                      const isNodePendingApproval =
                        isPaused &&
                        node.type === "command" &&
                        pendingApprovalCmd &&
                        node.command === pendingApprovalCmd.command &&
                        node.status === "pending";

                      // Determine simple status text indicator
                      const statusIndicator =
                        node.status === "active" ? "[running]" :
                          node.status === "done" ? "[done]" :
                            node.status === "failed" ? "[failed]" : "[pending]";

                      return (
                        <div key={node.id} className="space-y-0.5">
                          <div className="font-semibold text-on-surface/85">
                            {statusIndicator} {node.label}
                            {node.subagent && ` (${node.subagent})`}
                          </div>
                          {node.subLabel && (
                            <p className="text-on-surface/60 pl-3">
                              {node.subLabel}
                            </p>
                          )}
                          {node.command && node.command !== node.label && (
                            <code className="block font-mono text-[10px] pl-3 text-on-surface/50 break-all mt-0.5">
                              {node.command}
                            </code>
                          )}


                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}





        {/* AI response */}
        {assistantMsg && (
          <div className="space-y-2 mt-1">
            <div className={`text-[12.5px] leading-relaxed break-words select-text ${assistantMsg.isError ? "text-red-400" : "text-on-surface/90"}`}>
              {renderMarkdown(assistantMsg.content)}
            </div>

            {/* Action buttons */}
            <div className="flex items-center justify-end gap-3 pl-7 text-on-surface-variant/80">
              <button
                onClick={() => handleCopy(assistantMsg?.content || "")}
                className="hover:text-on-surface/70 p-1 rounded transition-colors cursor-pointer"
                title="Copy Response"
              >
                {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
              </button>
            </div>

            {/* Retry / close footer for the last turn */}
            {isLastTurn && (assistantMsg.isError) && (
              <div className="flex gap-2 pt-1">
                <button
                  onClick={retryTask}
                  className="flex-1 flex items-center justify-center gap-1.5 text-[10px] font-bold py-1.5 px-3 rounded-[10px] transition-all cursor-pointer"
                  style={{
                    background: "rgba(79,140,255,0.10)",
                    border: "1px solid rgba(79,140,255,0.20)",
                    color: "#4F8CFF",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(79,140,255,0.16)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(79,140,255,0.10)")}
                >
                  <RotateCcw size={11} />
                  Retry
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── No API Keys / Empty State ──────────────────────────────────────────────
function NoApiKeysOrEmpty() {
  const hasApiKey = useHasApiKeyConfigured();
  if (!hasApiKey) {
    return <ProviderSetupPrompt compact />;
  }
  return (
    <div className="flex flex-col items-center justify-center h-full py-12 gap-3 text-center">
      <div>
        <p className="text-xs font-semibold" style={{ color: "rgba(232,234,240,0.5)" }}>Nothing to show yet</p>
        <p className="text-xs mt-0.5" style={{ color: "rgba(232,234,240,0.25)" }}>Run a command or describe a goal</p>
      </div>
    </div>
  );
}

// ── Main AgentOverlay Component ────────────────────────────────────────────
interface AgentOverlayProps {
  sessionId: string;
  onClose?: () => void;
}

// ── Command Approval Card ─────────────────────────────────────────────────
interface CommandApprovalCardProps {
  command: string;
  explanation?: string;
  onApprove: () => void;
  onSkip: () => void;
  isRunning: boolean;
}

function CommandApprovalCard({ command, explanation, onApprove, onSkip, isRunning }: CommandApprovalCardProps) {
  return (
    <div
      className="mx-4 mb-3 rounded-[14px] overflow-hidden animate-fadeIn"
      style={{
        background: "rgba(15,19,26,0.95)",
        border: "1px solid rgba(255,200,60,0.20)",
        boxShadow: "0 4px 24px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,200,60,0.08)",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2"
      >
        <Terminal size={11} className="text-amber-400/80 shrink-0" />
        <span className="text-[10px] font-bold tracking-widest text-amber-400/70">
          Awaiting Approval
        </span>
      </div>

      {/* Command block */}
      <div className="px-3 pt-1 pb-2">
        {explanation && (
          <p className="text-[11px] text-on-surface/50 mb-2 leading-relaxed">{explanation}</p>
        )}
        <code
          className="block font-mono text-[12px] leading-relaxed break-all select-text"
          style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.07)",
            borderRadius: 8,
            padding: "8px 10px",
            color: "rgba(180,220,255,0.90)",
          }}
        >
          {command}
        </code>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 px-3 pb-3">
        <button
          onClick={onSkip}
          disabled={isRunning}
          className="w-full flex items-center justify-center gap-1.5 text-[11px] font-bold py-2 px-3 rounded-[9px] transition-all cursor-pointer disabled:opacity-50"
          style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.09)",
            color: "rgba(232,234,240,0.40)",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "rgba(232,234,240,0.70)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; e.currentTarget.style.color = "rgba(232,234,240,0.40)"; }}
          title="Skip this command"
        >
          <X size={12} />
          Skip
        </button>
        <button
          onClick={onApprove}
          disabled={isRunning}
          className="w-full flex items-center justify-center bg-amber-400/70 hover:bg-amber-400/75 transition-colors text-black gap-1.5 text-[11px] font-bold py-2 rounded-[9px] transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isRunning ? (
            <><span className="w-3 h-3 border border-emerald-400/60 border-t-emerald-400 rounded-full animate-spin" />Running…</>
          ) : (
            <><Play size={10} fill="currentColor" />Approve & Run</>
          )}
        </button>
      </div>
    </div>
  );
}

export function AgentOverlay({ sessionId, onClose }: AgentOverlayProps) {
  const {
    startTask,
    status,
    queue,
    lastMessage,
    currentCommandIndex: _currentCommandIndex,
    stepCount,
    maxSteps,
    chainNodes,
    agentLogs,
    activeSubagent,
    approveAndRunPending,
    declinePending,
    clearTask,
    retryTask,
    chatHistory,
  } = useAgentExecution(sessionId);

  const [durationSecs, setDurationSecs] = useState<number>(0);
  const timerRef = useRef<any>(null);

  const MIN_PANEL_WIDTH = 240;
  const MAX_PANEL_WIDTH = 600;
  const [width, setWidth] = useState(380);
  const panelDragRef = useRef<{ startX: number; startW: number } | null>(null);

  const onDragHandleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    panelDragRef.current = { startX: e.clientX, startW: width };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [width]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = panelDragRef.current;
      if (!d) return;
      // Handle on left edge: drag left → delta negative → negate to expand panel
      const delta = d.startX - e.clientX;
      setWidth(Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, d.startW + delta)));
    };
    const onUp = () => {
      if (!panelDragRef.current) return;
      panelDragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

  // Auto-scroll ref — points to the bottom sentinel element
  const bottomRef = useRef<HTMLDivElement>(null);
  // Chat scroll container ref — for detecting user scroll
  const scrollRef = useRef<HTMLDivElement>(null);
  const userScrolledUp = useRef(false);

  // Track user scrolling so we don't forcibly scroll when they've scrolled up
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

  // Auto-scroll to bottom when new messages arrive (unless user scrolled up)
  const prevHistoryLen = useRef(0);
  useEffect(() => {
    const newLen = chatHistory.length;
    if (newLen !== prevHistoryLen.current) {
      prevHistoryLen.current = newLen;
      // New message arrived — always scroll to bottom
      userScrolledUp.current = false;
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatHistory.length]);

  // Also scroll during active farming (step updates)
  useEffect(() => {
    if (!userScrolledUp.current && (status === "planning" || status === "executing")) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [stepCount, status]);

  // Timer
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

  const isExecuting = status === "executing";
  const isPaused = status === "paused";
  const isPlanning = status === "planning";
  const isThinking = isPlanning || isExecuting || isPaused;
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

  // Show only terminal agent messages (or legacy messages without agentType)
  const filteredChatHistory = chatHistory.filter(
    (m) => m.agentType === "terminal" || m.agentType === undefined
  );

  // Group chat history into turns (user + optional assistant)
  const turns: Array<{ user: ChatMessage; assistant: ChatMessage | null }> = [];
  for (let idx = 0; idx < filteredChatHistory.length; idx++) {
    const msg = filteredChatHistory[idx];
    if (msg.role === "user") {
      const next = filteredChatHistory[idx + 1];
      const assistant = next?.role === "assistant" ? next : null;
      turns.push({ user: msg, assistant });
      if (assistant) idx++; // skip the assistant message we just paired
    }
  }

  const lastTurnIndex = turns.length - 1;

  return (
    <div
      className="relative flex flex-col z-25 select-none"
      style={{
        width,
        minWidth: MIN_PANEL_WIDTH,
        maxWidth: MAX_PANEL_WIDTH,
        background: "#0F131A",
        borderLeft: "1px solid rgba(255,255,255,0.06)",
        // boxShadow: "-4px 0 4px rgba(0,0,0,0.15)",
      }}
    >
      {/* ── Drag handle on left edge ── */}
      <div
        onMouseDown={onDragHandleMouseDown}
        className="absolute top-0 left-0 w-1.5 h-full cursor-col-resize z-30 group select-none"
        title="Drag to resize"
      >
        <div
          className="w-px h-full mr-auto transition-colors"
          style={{ background: "transparent" }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(79,140,255,0.35)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        />
      </div>

      {/* ── Custom animations ── */}
      <style>{`
        @keyframes sway {
          0%, 100% { transform: rotate(-5deg); }
          50% { transform: rotate(5deg); }
        }
        @keyframes floatUp {
          0% { transform: translateY(4px) scale(0.6); opacity: 0; }
          50% { opacity: 0.8; }
          100% { transform: translateY(-8px) scale(1.1); opacity: 0; }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fadeIn { animation: fadeIn 0.2s ease-out; }
      `}</style>

      {/* ── Header ── */}
      <div
        className="flex items-center justify-between px-4 py-3 shrink-0"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
      >
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-semibold tracking-wide" style={{ color: "#E8EAF0" }}>Aura</span>
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

      {/* ── Scrollable Chat Area ── */}
      <div
        ref={scrollRef}
        className="flex-1 scrollable-overlay px-4 pt-3 aurora-ta"
        style={{ scrollbarGutter: "stable" }}
      >
        {filteredChatHistory.length === 0 && (
          <NoApiKeysOrEmpty />
        )}

        {turns.map((turn, idx) => {
          const isLastTurn = idx === lastTurnIndex;
          return (
            <ConversationTurn
              key={turn.user.id}
              userMsg={turn.user}
              assistantMsg={turn.assistant}
              isThinking={isLastTurn && isThinking}
              isLastTurn={isLastTurn}
              chainNodes={turn.assistant?.chainNodes || (isLastTurn ? chainNodes : [])}
              agentLogs={turn.assistant?.agentLogs || (isLastTurn ? agentLogs : [])}
              durationSecs={durationSecs}
              approveAndRunPending={approveAndRunPending}
              clearTask={clearTask}
              pendingApprovalCmd={pendingApprovalCmd}
              isPaused={isLastTurn && isPaused}
              retryTask={retryTask}
              stepCount={stepCount}
              maxSteps={maxSteps}
            />
          );
        })}

        {/* Bottom sentinel for auto-scroll */}
        <div ref={bottomRef} className="h-2" />
      </div>

      {/* ── Command Approval Card — shown when paused awaiting shell approval ── */}
      {isPaused && pendingApprovalCmd && (
        <CommandApprovalCard
          command={pendingApprovalCmd.command}
          explanation={pendingApprovalCmd.explanation}
          onApprove={handleApprove}
          onSkip={handleSkip}
          isRunning={approvalRunning}
        />
      )}

      {/* ── Footer with clear/retry actions ── */}
      {filteredChatHistory.length > 0 && (
        <div
          className="shrink-0 flex items-center justify-between px-4 py-2"
          style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
        >
          <span className="text-[10px]" style={{ color: "rgba(232,234,240,0.25)" }}>
            {turns.length} turn{turns.length !== 1 ? "s" : ""}
          </span>
          <button
            onClick={clearTask}
            className="flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1 rounded-[8px] transition-all cursor-pointer"
            style={{
              color: "rgba(232,234,240,0.4)",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.color = "#E8EAF0"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "rgba(232,234,240,0.4)"; }}
          >
            <RotateCcw size={10} />
            Clear session
          </button>
        </div>
      )}
    </div>
  );
}
