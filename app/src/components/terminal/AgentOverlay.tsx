import { useState, useEffect, useRef, useCallback } from "react";
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
  Copy,
  Check,
  Share2,
} from "lucide-react";
import { useAgentExecution } from "../../hooks/useAgentExecution";
import type { ChainNode, ChatMessage } from "../../stores/useAgentStore";

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
    <div className="flex flex-col gap-1 max-h-32 overflow-y-auto aurora-ta text-[10px] text-outline/60">
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
        <span className="absolute w-[2px] h-[2px] bg-primary rounded-full left-[20%] bottom-[30%] animate-[floatUp_1.5s_ease-out_infinite]" />
        <span className="absolute w-[3px] h-[3px] bg-primary rounded-full left-[70%] bottom-[20%] animate-[floatUp_2s_ease-out_infinite_0.4s]" />
        <span className="absolute w-[2px] h-[2px] bg-primary rounded-full left-[45%] bottom-[40%] animate-[floatUp_1.8s_ease-out_infinite_0.8s]" />
      </div>
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

// ── Mini Markdown Renderer ────────────────────────────────────────────────
// Handles: code blocks, inline code, headers, unordered/ordered lists,
// bold, italic, and proper paragraph/line-break handling.
// Also unescapes Windows paths (\\) → (\).

function unescapeBackslashes(str: string): string {
  // JSON-encoded paths like D:\\builds\\aurora → D:\builds\aurora
  return str.replace(/\\\\/g, "\\");
}

function renderInline(text: string): React.ReactNode {
  // Split on bold, italic, and inline-code patterns
  const tokens = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`\n]+`)/g);
  return tokens.map((tok, i) => {
    if (tok.startsWith("**") && tok.endsWith("**")) {
      return <strong key={i} className="font-semibold text-on-surface">{tok.slice(2, -2)}</strong>;
    }
    if (tok.startsWith("*") && tok.endsWith("*") && tok.length > 2) {
      return <em key={i}>{tok.slice(1, -1)}</em>;
    }
    if (tok.startsWith("`") && tok.endsWith("`") && tok.length > 2) {
      return (
        <code key={i} className="px-1.5 py-0.5 mx-0.5 bg-surface-variant/40 rounded text-[10.5px] font-mono border border-outline-variant/10 text-on-surface/90 font-medium">
          {tok.slice(1, -1)}
        </code>
      );
    }
    return tok || null;
  });
}

function renderMarkdown(text: string | null): React.ReactNode {
  if (!text) return null;

  const raw = unescapeBackslashes(text);
  const lines = raw.split(/\r?\n/);
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // ── Fenced code block ─────────────────────────────────────
    if (line.trimStart().startsWith("```")) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      elements.push(
        <pre key={`cb-${i}`} className="my-2.5 p-3 bg-surface-variant/20 rounded-xl overflow-x-auto text-[11px] font-mono border border-outline-variant/10 text-on-surface/90 leading-relaxed whitespace-pre-wrap break-all">
          <code>{codeLines.join("\n").trim()}</code>
        </pre>
      );
      i++; // skip closing ```
      continue;
    }

    // ── ATX Headings ──────────────────────────────────────────
    const h3 = /^### (.+)/.exec(line);
    if (h3) {
      elements.push(<p key={`h3-${i}`} className="text-[12px] font-bold text-on-surface mt-2 mb-0.5">{renderInline(h3[1])}</p>);
      i++; continue;
    }
    const h2 = /^## (.+)/.exec(line);
    if (h2) {
      elements.push(<p key={`h2-${i}`} className="text-[13px] font-bold text-on-surface mt-2.5 mb-1">{renderInline(h2[1])}</p>);
      i++; continue;
    }
    const h1 = /^# (.+)/.exec(line);
    if (h1) {
      elements.push(<p key={`h1-${i}`} className="text-[14px] font-bold text-on-surface mt-3 mb-1">{renderInline(h1[1])}</p>);
      i++; continue;
    }

    // ── Unordered list (- or *) ───────────────────────────────
    if (/^[-*] /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*] /.test(lines[i])) {
        items.push(lines[i].slice(2));
        i++;
      }
      elements.push(
        <ul key={`ul-${i}`} className="my-1.5 pl-4 space-y-0.5 list-disc list-outside">
          {items.map((item, j) => (
            <li key={j} className="text-[12.5px] leading-relaxed text-on-surface/90">
              {renderInline(item)}
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // ── Ordered list (1. 2. …) ────────────────────────────────
    if (/^\d+\. /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\. /, ""));
        i++;
      }
      elements.push(
        <ol key={`ol-${i}`} className="my-1.5 pl-4 space-y-0.5 list-decimal list-outside">
          {items.map((item, j) => (
            <li key={j} className="text-[12.5px] leading-relaxed text-on-surface/90">
              {renderInline(item)}
            </li>
          ))}
        </ol>
      );
      continue;
    }

    // ── Blank line → visual spacing ───────────────────────────
    if (line.trim() === "") {
      // Only add spacing if previous element exists (avoid leading gap)
      if (elements.length > 0) {
        elements.push(<div key={`sp-${i}`} className="h-1.5" />);
      }
      i++; continue;
    }

    // ── Regular paragraph line ────────────────────────────────
    elements.push(
      <p key={`p-${i}`} className="text-[12.5px] leading-relaxed text-on-surface/90">
        {renderInline(line)}
      </p>
    );
    i++;
  }

  return <div className="space-y-0.5">{elements}</div>;
}

// ── Typing / Farming indicator ─────────────────────────────────────────────
function ThinkingBubble() {
  return (
    <div className="flex items-center gap-2.5 py-3 px-4">
      <SproutFarmingIcon />
      <span className="text-[11px] font-semibold text-primary/70 animate-pulse">Farming aura…</span>
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
  detailsOpen,
  logsOpen,
  chainNodes,
  agentLogs,
  durationSecs,
  onToggleDetails,
  onToggleLogs,
  approveAndRunPending,
  clearTask,
  pendingApprovalCmd,
  isPaused,
  retryTask,
  stepCount,
  maxSteps,
}: TurnProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (assistantMsg?.content) {
      navigator.clipboard.writeText(assistantMsg.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="flex flex-col">
      {/* ── User message — sticky so it stays in view while AI response scrolls ── */}
      <div
        className="sticky top-0 z-10 pb-2"
        style={{ background: "var(--color-background, #0d0d0f)" }}
      >
        <div className="rounded-2xl px-4 py-3 text-[13px] text-on-surface/90 font-medium leading-relaxed bg-surface-container-high/40 border border-on-surface/10 shadow-sm">
          {userMsg.content}
        </div>
      </div>

      {/* ── AI response area ─────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2 pb-4">
        {/* Execution details — shown when thinking, or when chain nodes exist, or when past turn has stored duration */}
        {(isThinking || chainNodes.length > 0 || (assistantMsg?.durationMs !== undefined && assistantMsg.durationMs > 0)) && (
          <div className="space-y-1.5 mt-1">
            <div
              onClick={onToggleDetails}
              className="flex items-center gap-2 cursor-pointer select-none group"
            >
              <div className="flex items-center gap-2 text-[11px] text-outline/50 group-hover:text-outline/70 transition-colors">
                {isThinking ? (
                  <div className="flex items-center gap-2 text-primary/70">
                    <SproutFarmingIcon />
                    <span className="font-semibold animate-pulse">Farming…</span>
                    {stepCount > 0 && (
                      <span className="text-outline/35 text-[9px] font-normal">(step {stepCount}/{maxSteps})</span>
                    )}
                  </div>
                ) : (
                  <span className="font-medium text-outline/45">
                    Worked for {assistantMsg?.durationMs !== undefined ? Math.round(assistantMsg.durationMs / 1000) : durationSecs}s
                  </span>
                )}
              </div>
              {chainNodes.length > 0 && (
                <ChevronRight
                  size={11}
                  className={`text-outline/30 transition-transform duration-200 ${detailsOpen ? "rotate-90" : ""}`}
                />
              )}
            </div>

            {detailsOpen && (
              <div className="pl-3 py-2 space-y-3 border-l border-outline-variant/15 ml-3 text-[11px] text-outline/80 leading-normal animate-fadeIn">
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

                          {isNodePendingApproval && (
                            <div className="pl-3 mt-1 flex gap-2">
                              <button
                                onClick={approveAndRunPending}
                                className="text-[10px] font-semibold text-primary underline cursor-pointer"
                              >
                                Approve
                              </button>
                              <button
                                onClick={clearTask}
                                className="text-[10px] font-semibold text-outline underline cursor-pointer"
                              >
                                Cancel
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Execution Log */}
                {agentLogs.length > 0 && (
                  <div className="pt-2 border-t border-outline-variant/10">
                    <div className="text-[10px] font-bold text-outline/50 uppercase tracking-wider mb-1">Execution Log</div>
                    <LogPanel logs={agentLogs} />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Sensitive command approval gate */}
        {isLastTurn && isPaused && pendingApprovalCmd && (
          <div className="p-3.5 rounded-xl bg-amber-500/5 border border-amber-500/20 flex flex-col gap-2.5 mt-1">
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



        {/* AI response */}
        {assistantMsg && (
          <div className="space-y-2 mt-1">
            <div className={`text-[12.5px] leading-relaxed break-words ${assistantMsg.isError ? "text-red-400" : "text-on-surface/90"}`}>
              {renderMarkdown(assistantMsg.content)}
            </div>

            {/* Action buttons */}
            <div className="flex items-center justify-end gap-3 pl-7 text-outline/35">
              <button
                onClick={handleCopy}
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
                  className="flex-1 flex items-center justify-center gap-1.5 text-[10px] font-bold py-1.5 px-3 rounded-lg transition-all cursor-pointer bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20"
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
    lastMessage,
    currentCommandIndex: _currentCommandIndex,
    stepCount,
    maxSteps,
    chainNodes,
    agentLogs,
    activeSubagent,
    approveAndRunPending,
    clearTask,
    retryTask,
    chatHistory,
  } = useAgentExecution(sessionId);

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [durationSecs, setDurationSecs] = useState<number>(0);
  const timerRef = useRef<any>(null);

  // Resize
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(DEFAULT_WIDTH);

  // Auto-scroll ref — points to the bottom sentinel element
  const bottomRef = useRef<HTMLDivElement>(null);
  // Chat scroll container ref — for detecting user scroll
  const scrollRef = useRef<HTMLDivElement>(null);
  const userScrolledUp = useRef(false);

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
  }, []);

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

  // Don't render at all when there's nothing to show
  if (status === "idle" && chatHistory.length === 0) return null;

  const isExecuting = status === "executing";
  const isPaused = status === "paused";
  const isPlanning = status === "planning";
  const isThinking = isPlanning || isExecuting || isPaused;

  const pendingApprovalIndex = queue.findIndex((cmd) => cmd.status === "requires_action");
  const pendingApprovalCmd = pendingApprovalIndex !== -1 ? queue[pendingApprovalIndex] : null;

  // Group chat history into turns (user + optional assistant)
  const turns: Array<{ user: ChatMessage; assistant: ChatMessage | null }> = [];
  for (let idx = 0; idx < chatHistory.length; idx++) {
    const msg = chatHistory[idx];
    if (msg.role === "user") {
      const next = chatHistory[idx + 1];
      const assistant = next?.role === "assistant" ? next : null;
      turns.push({ user: msg, assistant });
      if (assistant) idx++; // skip the assistant message we just paired
    }
  }

  const lastTurnIndex = turns.length - 1;

  return (
    <div
      className="relative bg-background border border-outline-variant/10 rounded-2xl flex flex-col z-25 py-3 px-0 select-text"
      style={{ width, minWidth: MIN_WIDTH, maxWidth: MAX_WIDTH, flexShrink: 0 }}
    >
      {/* ── Drag handle on left edge ── */}
      <div
        onMouseDown={onDragHandleMouseDown}
        className="absolute top-0 left-0 w-1.5 h-full cursor-col-resize z-30 group select-none"
        title="Drag to resize"
      >
        <div className="w-px h-full mr-auto group-hover:bg-primary/40 transition-colors" />
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
        className="flex items-center justify-between px-4 pb-2 shrink-0"
        style={{ borderBottom: "1px solid rgba(var(--color-outline-variant-rgb, 100,100,120), 0.10)" }}
      >
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold tracking-wide text-on-surface">Aura Agent</span>
          <ActiveSubagentBadge subagent={activeSubagent} />
        </div>

        <button
          onClick={clearTask}
          className="text-outline/40 hover:text-on-surface hover:bg-surface-variant/20 p-1.5 rounded-lg transition-all cursor-pointer"
          title="Clear chat"
        >
          <X size={13} />
        </button>
      </div>

      {/* ── Scrollable Chat Area ── */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 pt-3 aurora-ta"
        style={{ scrollbarGutter: "stable" }}
      >
        {turns.length === 0 && (
          /* Empty state — only shown when there's status but no history yet */
          <div className="flex flex-col items-center justify-center h-full py-12 gap-3 text-center">
            <div className="w-10 h-10 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Brain size={18} className="text-primary/60" />
            </div>
            <div>
              <p className="text-[12px] font-semibold text-on-surface/60">Aura is ready</p>
              <p className="text-[10px] text-outline/40 mt-0.5">Describe a task to get started</p>
            </div>
          </div>
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
              detailsOpen={detailsOpen}
              logsOpen={logsOpen}
              chainNodes={isLastTurn ? chainNodes : []}
              agentLogs={isLastTurn ? agentLogs : []}
              durationSecs={durationSecs}
              onToggleDetails={() => setDetailsOpen((v) => !v)}
              onToggleLogs={() => setLogsOpen((v) => !v)}
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
    </div>
  );
}
