import { useState, useEffect, useRef } from "react";
import {
  X,
  Cpu,
  CheckCircle,
  AlertCircle,
  FileText
} from "lucide-react";
import { useAgentStore, CONST_DEFAULT_SESSION_STATE } from "../../stores/useAgentStore";
import { useAgentExecution } from "../../hooks/useAgentExecution";

interface AgentDetailsProps {
  sessionId: string | null;
  onClose?: () => void;
}

export function AgentDetails({ sessionId, onClose }: AgentDetailsProps) {
  // Retrieve session state
  const sessions = useAgentStore((s) => s.sessions);
  const sessionState = sessionId ? sessions[sessionId] || CONST_DEFAULT_SESSION_STATE : CONST_DEFAULT_SESSION_STATE;

  const {
    status,
    queue,
    stepCount,
    maxSteps,
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

  const handleOpenFile = (path: string) => {
    window.dispatchEvent(new CustomEvent("aurora-open-file-path", { detail: { path } }));
  };

  const filesChanged = sessionState.filesChanged || [];

  return (
    <div className="flex flex-col h-full w-full bg-transparent overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 h-13 shrink-0 select-none"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
      >
        <div className="flex items-center gap-2">
          <Cpu size={14} className="text-primary" />
          <span className="text-[12px] font-semibold tracking-wide text-on-surface">Agent Details</span>
        </div>

        <button
          onClick={() => onClose?.()}
          className="p-1.5 rounded-[8px] transition-all cursor-pointer"
          style={{ color: "rgba(232,234,240,0.3)" }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.color = "#E8EAF0"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "rgba(232,234,240,0.3)"; }}
          title="Close details panel"
        >
          <X size={13} />
        </button>
      </div>

      {/* Details Content */}
      <div className="flex-1 overflow-y-auto scrollbar-thin px-4 py-4 space-y-5 text-xs text-on-surface-variant/80 select-text">
        {/* Section: Status */}
        <div className="space-y-2">
          <div className="text-[10px] font-bold uppercase tracking-wider text-white/40">Execution Status</div>
          <div className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/[0.04]">
            <div className="flex items-center gap-2">
              {status === "executing" || status === "planning" ? (
                <span className="flex h-2 w-2 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                </span>
              ) : status === "completed" ? (
                <CheckCircle size={12} className="text-emerald-400 animate-fadeIn" />
              ) : status === "error" ? (
                <AlertCircle size={12} className="text-red-400 animate-fadeIn" />
              ) : (
                <div className="h-2 w-2 rounded-full bg-white/20" />
              )}
              <span className="font-semibold capitalize text-on-surface">{status}</span>
            </div>
            <span className="text-[10px] text-white/40">{durationSecs}s elapsed</span>
          </div>
        </div>

        {/* Section: Model Details */}
        <div className="space-y-2">
          <div className="text-[10px] font-bold uppercase tracking-wider text-white/40">Active Model</div>
          <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.04]">
            <div className="font-mono text-on-surface select-text">{sessionState.model || "Default Model"}</div>
            <div className="text-[10px] text-white/30 mt-1 select-text">Mode: {sessionState.agentMode === "build" ? "Build & Execute" : "Plan Only"}</div>
          </div>
        </div>

        {/* Section: Step Budget */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-white/40">Step Budget</span>
            <span className="text-[10px] font-mono text-white/50">{stepCount} / {maxSteps} steps</span>
          </div>
          <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.04] space-y-2">
            <div className="w-full bg-white/[0.05] h-1.5 rounded-full overflow-hidden">
              <div
                className="bg-primary h-full transition-all duration-300"
                style={{ width: `${Math.min(100, (stepCount / maxSteps) * 100)}%` }}
              />
            </div>
            <p className="text-[10px] text-white/30">
              The agent will pause execution for approval when it reaches the step budget limit.
            </p>
          </div>
        </div>

        {/* Section: Token Limits */}
        <div className="space-y-2">
          <div className="text-[10px] font-bold uppercase tracking-wider text-white/40">Token Limits by Tier</div>
          <div className="divide-y divide-white/[0.04] rounded-xl bg-white/[0.02] border border-white/[0.04] overflow-hidden">
            <div className="flex justify-between p-2.5">
              <span className="text-white/60">Fast (Autocomplete)</span>
              <span className="font-mono text-on-surface">200 tokens</span>
            </div>
            <div className="flex justify-between p-2.5">
              <span className="text-white/60">Balanced (Command/NL)</span>
              <span className="font-mono text-on-surface">800 tokens</span>
            </div>
            <div className="flex justify-between p-2.5">
              <span className="text-white/60">Powerful (Diagnosis)</span>
              <span className="font-mono text-on-surface">3,000 tokens</span>
            </div>
          </div>
        </div>

        {/* Section: Files Modified */}
        <div className="space-y-2">
          <div className="text-[10px] font-bold uppercase tracking-wider text-white/40">
            Files Modified ({filesChanged.length})
          </div>
          {filesChanged.length === 0 ? (
            <div className="p-3 text-center rounded-xl bg-white/[0.02] border border-white/[0.04] text-white/30 italic">
              No files modified in this session yet.
            </div>
          ) : (
            <div className="space-y-2">
              {filesChanged.map((file, idx) => {
                const baseName = file.path.split(/[/\\]/).pop() || file.path;
                return (
                  <div
                    key={idx}
                    onClick={() => handleOpenFile(file.path)}
                    className="flex flex-col p-2.5 rounded-xl border border-white/[0.04] bg-white/[0.01] hover:bg-white/[0.03] transition-colors cursor-pointer select-none"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <FileText size={12} className="text-primary shrink-0" />
                        <span className="text-xs font-mono font-medium text-on-surface truncate" title={file.path}>
                          {baseName}
                        </span>
                      </div>
                      <span
                        className={`text-[9px] font-bold tracking-wide px-1.5 py-0.5 rounded-sm shrink-0 ${file.status === "approved"
                          ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                          : file.status === "rejected"
                            ? "bg-red-500/10 text-red-400 border border-red-500/20"
                            : "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                          }`}
                      >
                        {file.type || "patch"}
                      </span>
                    </div>
                    <span className="text-[9px] text-white/30 truncate mt-1 pl-4" title={file.path}>
                      {file.path}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
export default AgentDetails;
