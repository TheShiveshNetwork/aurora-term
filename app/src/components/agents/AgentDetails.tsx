import { useState, useEffect, useRef } from "react";
import { X } from "lucide-react";
import { useAgentStore, CONST_DEFAULT_SESSION_STATE } from "../../stores/useAgentStore";
import { useAgentExecution } from "../../hooks/useAgentExecution";
import { makeApprovalCard } from "./ToolApprovalCard";
import { dirnameOf, projectRelativePath, resolveExistingAgentPath } from "../../lib/agentPaths";
import { system } from "../../lib/ipc";
import { changeBadge } from "../../lib/changeBadge";

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
    pendingToolCall,
    approveAndRunPending,
    declinePending,
    submitAnswer,
  } = useAgentExecution(sessionId);

  const isPaused = status === "paused";
  const pendingApprovalCmd = queue.find((cmd) => cmd.status === "requires_action") || null;
  const [approvalRunning, setApprovalRunning] = useState(false);

  const handleApprove = async () => {
    setApprovalRunning(true);
    try {
      await approveAndRunPending();
    } finally {
      setApprovalRunning(false);
    }
  };
  const handleSkip = async () => {
    await declinePending();
  };

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

  const filesChanged = sessionState.filesChanged || [];

  // A/M come from the tool the agent used. D cannot be inferred from a missing
  // path, because no agent tool deletes files — absence almost always means the
  // path was recorded against a different base. So each path is probed against
  // every base the agent could have used, and D is only shown when the resolved
  // path's parent directory exists: we are looking in the right place and the
  // file really is gone.
  const pathSignature = filesChanged.map((f) => f.path).join("\u0000");
  const [resolved, setResolved] = useState<
    Map<string, { path: string; exists: boolean; parentExists: boolean }>
  >(new Map());

  useEffect(() => {
    if (filesChanged.length === 0) {
      setResolved(new Map());
      return;
    }
    let cancelled = false;
    void (async () => {
      const sidecarCwd = (await system.agentGetWorkspace().catch(() => null))?.processCwd ?? "";
      const entries = await Promise.all(
        filesChanged.map(async (file): Promise<[string, { path: string; exists: boolean; parentExists: boolean }]> => {
          const outcome = await resolveExistingAgentPath(file.path, [sidecarCwd]);
          const parent = dirnameOf(outcome.path);
          const parentExists = parent
            ? await system.pathExists(parent).catch(() => false)
            : true;
          return [file.path, { ...outcome, parentExists }];
        }),
      );
      if (cancelled) return;
      setResolved(new Map(entries));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathSignature]);

  const badgeFor = (file: (typeof filesChanged)[number]) => {
    const hit = resolved.get(file.path);
    return changeBadge(file, hit?.exists === false && hit.parentExists);
  };

  const handleOpenFile = async (path: string) => {
    const sidecarCwd = (await system.agentGetWorkspace().catch(() => null))?.processCwd ?? "";
    const outcome = await resolveExistingAgentPath(path, [sidecarCwd]);
    window.dispatchEvent(
      new CustomEvent("aurora-open-file-path", { detail: { path: outcome.path } }),
    );
  };


  return (
    <div className="flex flex-col h-full w-full bg-transparent overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 h-13 shrink-0 select-none"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
      >
        <div className="flex items-center gap-2">
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

        {/* TODO: implement provider based tokens usage */}
        {/* <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold tracking-wider text-white/40">Tokens Usage</span>
          </div>
          <div className="w-full bg-white/[0.05] h-1.5 rounded-full overflow-hidden">
            <div
              className="bg-primary h-full transition-all duration-300"
              style={{ width: `${Math.min(100, (stepCount / maxSteps) * 100)}%` }}
            />
          </div>
          <p className="text-xs text-white/30">
            The agent will pause execution for approval when it reaches the step budget limit.
          </p>
        </div> */}

        {/* Section: Files Modified */}
        <div className="space-y-2">
          <div className="text-xs font-bold tracking-wider text-white/40 select-none">
            Files Modified ({filesChanged.length})
          </div>
          {filesChanged.length === 0 ? (
            <div className="text-white/30 italic">
              No files modified in this session yet.
            </div>
          ) : (
            <div className="rounded-sm border border-white/[0.06] overflow-hidden divide-y divide-white/[0.05]">
{filesChanged.map((file, idx) => {
                const badge = badgeFor(file);
                const relative = projectRelativePath(file.path);
                return (
                  <div
                    key={`${file.path}-${idx}`}
                    onClick={() => handleOpenFile(file.path)}
                    title={`${badge.label} — ${file.path}`}
                    className="flex items-center gap-2 px-3 py-2 hover:bg-white/[0.03] transition-colors cursor-pointer select-none"
                  >
                    <span
                      aria-label={badge.label}
                      className={`grid place-items-center w-[15px] h-[15px] shrink-0 rounded-[3px] text-[9px] font-bold leading-none ${badge.tone}`}
                    >
                      {badge.letter}
                    </span>
                    <span className="text-xs font-mono font-medium text-on-surface truncate">
                      {relative || file.path}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Section: Pending Approvals */}
        {(isPaused && (pendingToolCall?.name === "ask_user" || pendingToolCall?.name === "write_file" || pendingToolCall?.name === "patch_file" || pendingApprovalCmd)) && (
          <div className="space-y-2">
            <div className="text-xs font-bold tracking-wider text-white/40">
              Pending Approval
            </div>
            {makeApprovalCard({
              isPaused,
              pendingToolCall,
              pendingApprovalCmd,
              pendingAsk:
                isPaused && pendingToolCall?.name === "ask_user"
                  ? {
                      question:
                        pendingToolCall.args?.question || "The agent has a clarifying question.",
                    }
                  : null,
              onApprove: handleApprove,
              onSkip: handleSkip,
              onSubmit: submitAnswer,
              isRunning: approvalRunning,
            })}
          </div>
        )}
      </div>
    </div>
  );
}
export default AgentDetails;
