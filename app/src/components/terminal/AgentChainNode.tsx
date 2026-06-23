import React from "react";
import {
  Brain,
  Terminal,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Clock,
  Code2,
  Search,
  ShieldCheck,
} from "lucide-react";
import type { ChainNode } from "../../stores/useAgentStore";

// ── Subagent icon map ─────────────────────────────────────────────────────
function SubagentIcon({ subagent, size = 11 }: { subagent?: string; size?: number }) {
  switch (subagent) {
    case "coder":
      return <Code2 size={size} className="text-blue-400" />;
    case "researcher":
      return <Search size={size} className="text-purple-400" />;
    case "validator":
      return <ShieldCheck size={size} className="text-emerald-400" />;
    default:
      return null;
  }
}

// ── Status ring ───────────────────────────────────────────────────────────
function StatusRing({ status, type }: { status: ChainNode["status"]; type: ChainNode["type"] }) {
  const baseRing = "w-7 h-7 rounded-full flex items-center justify-center shrink-0 relative";

  if (status === "active") {
    const color =
      type === "planning" ? "bg-violet-500/20 border-2 border-violet-500" :
      type === "subagent" ? "bg-blue-500/20 border-2 border-blue-400" :
      type === "command" ? "bg-primary/20 border-2 border-primary" :
      "bg-primary/20 border-2 border-primary";
    return (
      <div className={`${baseRing} ${color}`}>
        <span className="absolute inset-0 rounded-full animate-ping opacity-40"
          style={{ backgroundColor: type === "planning" ? "#7c3aed" : "var(--color-primary)" }} />
        <RefreshCw size={11} className="animate-spin text-on-surface/70" />
      </div>
    );
  }

  if (status === "done") {
    const color =
      type === "complete" ? "bg-emerald-500/20 border-2 border-emerald-500" :
      "bg-emerald-500/10 border border-emerald-500/30";
    return (
      <div className={`${baseRing} ${color}`}>
        <CheckCircle2 size={11} className="text-emerald-400" />
      </div>
    );
  }

  if (status === "failed") {
    return (
      <div className={`${baseRing} bg-red-500/10 border border-red-500/30`}>
        <AlertCircle size={11} className="text-red-400" />
      </div>
    );
  }

  // pending
  const color =
    type === "planning" ? "bg-violet-500/10 border border-violet-500/30" :
    type === "command" ? "bg-surface-container-high/30 border border-outline-variant/20" :
    "bg-surface-container-high/30 border border-outline-variant/20";
  return (
    <div className={`${baseRing} ${color}`}>
      {type === "planning" && <Brain size={11} className="text-violet-400" />}
      {type === "command" && <Terminal size={11} className="text-outline/40" />}
      {type === "complete" && <CheckCircle2 size={11} className="text-outline/40" />}
      {type === "error" && <AlertCircle size={11} className="text-outline/40" />}
      {type === "subagent" && <Code2 size={11} className="text-outline/40" />}
    </div>
  );
}

// ── Connector line between nodes ──────────────────────────────────────────
export function NodeConnector({ active }: { active: boolean }) {
  return (
    <div className="flex flex-col items-center w-7 shrink-0">
      <div
        className={`w-[2px] h-5 rounded-full transition-all duration-500 ${
          active ? "bg-primary/50" : "bg-outline-variant/15"
        }`}
      />
    </div>
  );
}

// ── Main ChainNode component ──────────────────────────────────────────────
interface AgentChainNodeProps {
  node: ChainNode;
  isLast: boolean;
  nextNode?: ChainNode;
  onApprove?: () => void;
  onCancel?: () => void;
  showApprove?: boolean;
}

export function AgentChainNode({
  node,
  isLast,
  nextNode,
  onApprove,
  onCancel,
  showApprove,
}: AgentChainNodeProps) {
  const isActive = node.status === "active";
  const isDone = node.status === "done";
  const isFailed = node.status === "failed";

  const containerClass = [
    "rounded-xl border p-2.5 transition-all duration-300 flex flex-col gap-1.5",
    isActive
      ? node.type === "planning"
        ? "bg-violet-500/8 border-violet-500/25 shadow-sm shadow-violet-500/10"
        : "bg-primary/8 border-primary/25 shadow-sm shadow-primary/10"
      : isDone
        ? "bg-emerald-500/5 border-emerald-500/15"
        : isFailed
          ? "bg-red-500/5 border-red-500/15"
          : "bg-surface-container-high/15 border-outline-variant/8",
  ].join(" ");

  const connectorActive = isActive || isDone;

  return (
    <>
      <div className={containerClass}>
        <div className="flex items-start gap-2.5">
          <StatusRing status={node.status} type={node.type} />

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className={`text-[11px] font-semibold leading-tight ${
                isActive ? "text-on-surface" :
                isDone ? "text-emerald-300" :
                isFailed ? "text-red-300" :
                "text-on-surface/50"
              }`}>
                {node.label}
              </span>

              {node.subagent && (
                <span className={`flex items-center gap-1 text-[9px] font-medium px-1.5 py-0.5 rounded-full border ${
                  node.subagent === "coder"
                    ? "bg-blue-500/10 border-blue-500/20 text-blue-300"
                    : node.subagent === "researcher"
                      ? "bg-purple-500/10 border-purple-500/20 text-purple-300"
                      : "bg-emerald-500/10 border-emerald-500/20 text-emerald-300"
                }`}>
                  <SubagentIcon subagent={node.subagent} size={8} />
                  {node.subagent}
                </span>
              )}

              {node.durationMs !== undefined && (
                <span className="flex items-center gap-0.5 text-[9px] text-outline/40 ml-auto">
                  <Clock size={8} />
                  {node.durationMs < 1000 ? `${node.durationMs}ms` : `${(node.durationMs / 1000).toFixed(1)}s`}
                </span>
              )}
            </div>

            {node.subLabel && (
              <p className={`text-[10px] mt-0.5 leading-relaxed ${
                isActive ? "text-on-surface/60" :
                isDone ? "text-on-surface/40" :
                isFailed ? "text-red-300/60" :
                "text-outline/40"
              }`}>
                {node.subLabel}
              </p>
            )}

            {/* Command display for command nodes */}
            {node.type === "command" && node.command && node.command !== node.label && (
              <code className={`block text-[10px] font-mono mt-1 px-2 py-1 rounded-md break-all ${
                isActive ? "bg-primary/10 text-primary/80" :
                isDone ? "bg-emerald-500/10 text-emerald-300/80" :
                isFailed ? "bg-red-500/10 text-red-300/80" :
                "bg-surface-container-high/30 text-on-surface/50"
              }`}>
                {node.command}
              </code>
            )}
          </div>
        </div>

        {/* Approval gate for sensitive commands */}
        {showApprove && (
          <div className="mt-1.5 p-2 bg-amber-500/8 border border-amber-500/20 rounded-lg flex flex-col gap-2">
            <p className="text-[9px] text-amber-300/80 font-medium flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              Sensitive command — requires approval
            </p>
            <div className="flex gap-1.5">
              <button
                onClick={onApprove}
                className="flex-1 bg-amber-500 hover:bg-amber-400 active:scale-[0.97] text-black font-semibold text-[10px] py-1 px-2 rounded-md transition-all cursor-pointer"
              >
                ▶ Run
              </button>
              <button
                onClick={onCancel}
                className="bg-outline/10 hover:bg-outline/20 text-on-surface/60 text-[10px] py-1 px-2 rounded-md transition-all cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Connector to next node */}
      {!isLast && (
        <NodeConnector active={connectorActive} />
      )}
    </>
  );
}
