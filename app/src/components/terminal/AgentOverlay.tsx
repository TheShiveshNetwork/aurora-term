import { useState, useEffect, useRef } from "react";
import {
  X,
  RotateCcw,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Brain,
  Zap,
  Code2,
  Search,
  ShieldCheck,
  Cpu,
  Copy,
  Check,
  Share2,
} from "lucide-react";
import { useAgentExecution } from "../../hooks/useAgentExecution";
import { AgentChainNode } from "./AgentChainNode";
import type { ChainNode } from "../../stores/useAgentStore";

// ── Status helpers ────────────────────────────────────────────────────────
function statusLabel(status: string) {
  switch (status) {
    case "planning": return "Planning";
    case "executing": return "Executing";
    case "paused": return "Awaiting approval";
    case "completed": return "Completed";
    case "error": return "Error";
    default: return "Idle";
  }
}

// ── Subagent active indicator ─────────────────────────────────────────────
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
  const typeColor: Record<string, string> = {
    plan: "text-violet-300",
    execute: "text-primary/80",
    subagent: "text-blue-300",
    complete: "text-emerald-300",
    error: "text-red-300",
    info: "text-outline/60",
  };

  return (
    <div className="flex flex-col gap-0.5 max-h-32 overflow-y-auto aurora-ta">
      {logs.map((log, i) => (
        <div key={i} className="flex items-start gap-1.5 text-[9px]">
          <span className="text-outline/30 font-mono shrink-0">
            {new Date(log.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
          <span className={`${typeColor[log.type] || "text-outline/50"} leading-relaxed break-all`}>
            {log.content}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Animated Farming Icon ──────────────────────────────────────────────────
function SproutFarmingIcon() {
  return (
    <div className="relative w-5 h-5 flex items-center justify-center shrink-0">
      {/* Floating aura/sparkle particles */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <span className="absolute w-[2px] h-[2px] bg-primary rounded-full left-[20%] bottom-[30%] animate-[floatUp_1.5s_ease-out_infinite]" />
        <span className="absolute w-[3px] h-[3px] bg-primary rounded-full left-[70%] bottom-[20%] animate-[floatUp_2s_ease-out_infinite_0.4s]" />
        <span className="absolute w-[2px] h-[2px] bg-primary rounded-full left-[45%] bottom-[40%] animate-[floatUp_1.8s_ease-out_infinite_0.8s]" />
      </div>

      {/* Sprout SVG */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="w-4 h-4 text-primary origin-bottom animate-[sway_2.5s_ease-in-out_infinite]"
      >
        <path d="M4 20h16" className="opacity-45" />
        <path d="M12 20v-8a4 4 0 0 1 4-4" />
        <path d="M12 12a4 4 0 0 0-4-4 4 4 0 0 0 4 4Z" fill="currentColor" fillOpacity="0.2" />
        <path d="M16 8a4 4 0 0 0-4-4 4 4 0 0 0 4 4Z" fill="currentColor" fillOpacity="0.2" />
      </svg>
    </div>
  );
}

// ── Simple Custom Markdown Parser ──────────────────────────────────────────
function renderMarkdown(text: string | null) {
  if (!text) return null;

  // Split by fenced code blocks (```code```)
  const parts = text.split(/(```[\s\S]*?```)/g);

  return parts.map((part, index) => {
    if (part.startsWith("```")) {
      const match = part.match(/```(\w*)\n([\s\S]*?)```/);
      const code = match ? match[2] : part.slice(3, -3);
      return (
        <pre key={index} className="my-2.5 p-3 bg-surface-variant/20 rounded-xl overflow-x-auto text-[11px] font-mono border border-outline-variant/10 text-on-surface/90 leading-relaxed">
          <code>{code.trim()}</code>
        </pre>
      );
    }

    // Split by inline code blocks (`code`)
    const inlineParts = part.split(/(`[^`]+`)/g);
    return (
      <span key={index}>
        {inlineParts.map((subPart, subIndex) => {
          if (subPart.startsWith("`") && subPart.endsWith("`")) {
            return (
              <code key={subIndex} className="px-1.5 py-0.5 mx-0.5 bg-surface-variant/40 rounded text-[11px] font-mono border border-outline-variant/10 text-on-surface/90 font-medium">
                {subPart.slice(1, -1)}
              </code>
            );
          }

          // Split by bold (**text**)
          const boldParts = subPart.split(/(\*\*[^*]+\*\*)/g);
          return (
            <span key={subIndex}>
              {boldParts.map((boldPart, boldIndex) => {
                if (boldPart.startsWith("**") && boldPart.endsWith("**")) {
                  return (
                    <strong key={boldIndex} className="font-bold text-on-surface">
                      {boldPart.slice(2, -2)}
                    </strong>
                  );
                }
                return boldPart;
              })}
            </span>
          );
        })}
      </span>
    );
  });
}

// ── Main AgentOverlay Component ────────────────────────────────────────────
interface AgentOverlayProps {
  sessionId: string;
}

const MIN_WIDTH = 240;
const MAX_WIDTH = 600;
const DEFAULT_WIDTH = 320;

export function AgentOverlay({ sessionId }: AgentOverlayProps) {
  const {
    status,
    queue,
    originalGoal,
    lastMessage,
    currentCommandIndex,
    stepCount,
    maxSteps,
    chainNodes,
    agentLogs,
    activeSubagent,
    approveAndRunPending,
    clearTask,
    retryTask,
  } = useAgentExecution(sessionId);

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [durationSecs, setDurationSecs] = useState<number>(0);
  const timerRef = useRef<any>(null);

  // Resize State & Refs
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(DEFAULT_WIDTH);

  const onDragHandleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    dragStartX.current = e.clientX;
    dragStartWidth.current = width;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = e.clientX - dragStartX.current;
      // Dragging to the left (negative delta) increases the width for a right-side panel
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, dragStartWidth.current - delta));
      setWidth(newWidth);
    };
    const onMouseUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [width]);

  // Monitor status to track active timer vs final task duration
  useEffect(() => {
    if (status === "planning" || status === "executing") {
      const startTime = Date.now();
      setDurationSecs(0);
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        setDurationSecs(Math.round((Date.now() - startTime) / 1000));
      }, 1000);
    } else if (status === "completed" || status === "error") {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      const totalMs = queue.reduce((acc, cmd) => acc + (cmd.durationMs || 0), 0);
      if (totalMs > 0) {
        setDurationSecs(Math.round(totalMs / 1000));
      }
    } else if (status === "idle") {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setDurationSecs(0);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [status, queue]);

  if (status === "idle") return null;

  const isExecuting = status === "executing";
  const isPaused = status === "paused";
  const isCompleted = status === "completed";
  const isError = status === "error";
  const isPlanning = status === "planning";

  // Find the pending-approval command
  const pendingApprovalIndex = queue.findIndex((cmd) => cmd.status === "requires_action");
  const pendingApprovalCmd = pendingApprovalIndex !== -1 ? queue[pendingApprovalIndex] : null;

  const handleCopy = () => {
    if (lastMessage) {
      navigator.clipboard.writeText(lastMessage);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div
      className="relative bg-background border border-outline-variant/10 rounded-2xl flex flex-col z-25 py-3 px-0 select-text"
      style={{ width, minWidth: MIN_WIDTH, maxWidth: MAX_WIDTH, flexShrink: 0 }}
    >
      {/* ── Drag handle on the left edge ── */}
      <div
        onMouseDown={onDragHandleMouseDown}
        className="absolute top-0 left-0 w-1.5 h-full cursor-col-resize z-30 group select-none"
        title="Drag to resize"
      >
        <div className="w-px h-full mr-auto group-hover:bg-primary/40 transition-colors" />
      </div>

      {/* ── Custom Animations Stylesheet ── */}
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
      `}</style>

      {/* Header */}
      <div
        className="flex items-center justify-between px-4 pb-2 shrink-0"
        style={{ borderBottom: "1px solid rgba(var(--color-outline-variant-rgb, 100,100,120), 0.10)" }}
      >
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold tracking-wide text-on-surface">
            Aura Agent
          </span>
          <ActiveSubagentBadge subagent={activeSubagent} />
        </div>

        <button
          onClick={clearTask}
          className="text-outline/40 hover:text-on-surface hover:bg-surface-variant/20 p-1.5 rounded-lg transition-all cursor-pointer"
          title="Close Panel"
        >
          <X size={13} />
        </button>
      </div>

      {/* Chat Content (Scrollable) */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 aurora-ta">
        {/* User Message Bubble */}
        <div className="rounded-2xl px-4 py-3 text-[13px] text-on-surface/90 font-medium leading-relaxed bg-surface-container-high/40 border border-on-surface/10 shadow-sm">
          {originalGoal}
        </div>

        {/* Progress / Status Disclosure */}
        <div className="space-y-2">
          <div
            onClick={() => setDetailsOpen((v) => !v)}
            className="flex items-center justify-between py-2.5 px-3 rounded-xl bg-surface-variant/10 border border-outline-variant/5 hover:border-outline-variant/15 hover:bg-surface-variant/15 transition-all cursor-pointer select-none"
          >
            <div className="flex items-center gap-2 text-[11px] text-outline/60">
              {isCompleted || isError ? (
                <span className="font-semibold text-outline/75">
                  Worked for {durationSecs}s
                </span>
              ) : (
                <div className="flex items-center gap-2 text-primary/70">
                  <SproutFarmingIcon />
                  <span className="font-semibold animate-pulse">Farming...</span>
                  {stepCount > 0 && (
                    <span className="text-outline/35 text-[9px] font-normal">
                      (step {stepCount}/{maxSteps})
                    </span>
                  )}
                </div>
              )}
            </div>
            <ChevronRight
              size={12}
              className={`text-outline/40 transition-transform duration-200 ${detailsOpen ? "rotate-90" : ""}`}
            />
          </div>

          {/* Details Section (Execution Chain + Logs) */}
          {detailsOpen && (
            <div className="pl-1 pr-1 py-1 space-y-4 border-l-2 border-outline-variant/10 ml-3 animate-fadeIn">
              {/* Chain Flow */}
              <div className="space-y-3">
                <div className="flex items-center gap-1.5 px-2">
                  <Zap size={10} className="text-outline/35" />
                  <span className="text-[9px] text-outline/35 font-bold uppercase tracking-wider">
                    Execution Chain
                  </span>
                </div>

                {chainNodes.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-6 gap-1.5">
                    <Brain size={13} className="text-outline/30 animate-pulse" />
                    <span className="text-[9px] text-outline/40">Planning nodes…</span>
                  </div>
                )}

                <div className="flex flex-col">
                  {chainNodes.map((node, index) => {
                    const isLast = index === chainNodes.length - 1;
                    const nextNode = chainNodes[index + 1];
                    const isNodePendingApproval =
                      isPaused &&
                      node.type === "command" &&
                      pendingApprovalCmd &&
                      node.command === pendingApprovalCmd.command &&
                      node.status === "pending";

                    return (
                      <AgentChainNode
                        key={node.id}
                        node={node}
                        isLast={isLast}
                        nextNode={nextNode}
                        showApprove={!!isNodePendingApproval}
                        onApprove={approveAndRunPending}
                        onCancel={clearTask}
                      />
                    );
                  })}
                </div>
              </div>

              {/* Logs panel */}
              <div className="space-y-1.5">
                <button
                  onClick={() => setLogsOpen((v) => !v)}
                  className="flex items-center gap-1 px-2 text-[9px] text-outline/35 font-bold uppercase tracking-wider hover:text-outline/70 transition-colors cursor-pointer"
                >
                  {logsOpen ? <ChevronDown size={9} /> : <ChevronUp size={9} />}
                  {agentLogs.length} Log Entries
                </button>

                {logsOpen && agentLogs.length > 0 && (
                  <div className="rounded-xl p-2.5 bg-surface-rgb/40 border border-outline-variant/10">
                    <LogPanel logs={agentLogs} />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Sensitive Command Approval Gate (Monochromatic alert format right on the chatbot screen) */}
        {isPaused && pendingApprovalCmd && (
          <div className="p-3.5 rounded-xl bg-amber-500/5 border border-amber-500/20 flex flex-col gap-2.5">
            <div className="flex items-start gap-2">
              <ShieldCheck className="text-amber-400/80 mt-0.5 shrink-0" size={14} />
              <div className="flex-1 min-w-0">
                <span className="text-[9px] text-amber-400/80 font-bold uppercase tracking-wider block">
                  Aura approval required
                </span>
                <code className="text-[11px] font-mono text-on-surface/95 break-all block mt-1.5 bg-surface-variant/20 p-2 rounded-lg border border-outline-variant/10">
                  {pendingApprovalCmd.command}
                </code>
                <span className="text-[10px] text-outline/50 block mt-1.5 leading-normal">
                  {pendingApprovalCmd.explanation}
                </span>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={approveAndRunPending}
                className="flex-1 flex items-center justify-center gap-1.5 text-[10px] font-bold py-1.5 px-3 rounded-lg bg-amber-500 hover:bg-amber-600 text-black transition-all cursor-pointer shadow-sm"
              >
                Approve
              </button>
              <button
                onClick={clearTask}
                className="flex-1 flex items-center justify-center gap-1.5 text-[10px] font-semibold py-1.5 px-3 rounded-lg bg-surface-variant/30 hover:bg-surface-variant/50 text-on-surface/80 border border-outline-variant/10 transition-all cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* AI Response Block */}
        {(isCompleted || isError) && lastMessage && (
          <div className="space-y-3.5 animate-fadeIn">
            {/* The Text Message */}
            <div className={`text-[12.5px] leading-relaxed break-words font-normal ${isError ? "text-red-400" : "text-on-surface/90"}`}>
              {renderMarkdown(lastMessage)}
            </div>

            {/* Action Buttons Row */}
            <div className="flex items-center justify-end gap-3.5 pt-1 border-t border-outline-variant/5 text-outline/40">
              <button
                className="hover:text-on-surface/70 p-1 rounded transition-colors cursor-pointer"
                title="Share Response"
              >
                <Share2 size={13} />
              </button>
              <button
                onClick={handleCopy}
                className="hover:text-on-surface/70 p-1 rounded transition-colors cursor-pointer"
                title="Copy Response"
              >
                {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
              </button>
              {/* <button
                className="hover:text-on-surface/70 p-1 rounded transition-colors cursor-pointer"
                title="Helpful"
              >
                <ThumbsUp size={13} />
              </button>
              <button
                className="hover:text-on-surface/70 p-1 rounded transition-colors cursor-pointer"
                title="Not Helpful"
              >
                <ThumbsDown size={13} />
              </button> */}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      {(isCompleted || isError) && (
        <div
          className="shrink-0 px-4 pt-3 bg-surface-rgb/20 flex gap-2"
          style={{ borderTop: "1px solid rgba(var(--color-outline-variant-rgb, 100,100,120), 0.10)" }}
        >
          {isError && (
            <button
              onClick={retryTask}
              className="flex-1 flex items-center justify-center gap-1.5 text-[10px] font-bold py-1.5 px-3 rounded-lg transition-all cursor-pointer bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20"
            >
              <RotateCcw size={11} />
              Retry
            </button>
          )}
          <button
            onClick={clearTask}
            className="flex-1 flex items-center justify-center gap-1.5 text-[10px] font-semibold py-1.5 px-3 rounded-lg transition-all cursor-pointer bg-surface-variant/20 hover:bg-surface-variant/35 text-on-surface/70 border border-outline-variant/10"
          >
            <X size={11} />
            Close
          </button>
        </div>
      )}
    </div>
  );
}
