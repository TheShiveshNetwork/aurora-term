import { Play, Pause, X, CheckCircle2, AlertCircle, RefreshCw, HelpCircle, ShieldAlert } from "lucide-react";
import { useAgentExecution } from "../../hooks/useAgentExecution";

interface AgentOverlayProps {
  sessionId: string;
}

export function AgentOverlay({ sessionId }: AgentOverlayProps) {
  const {
    status,
    queue,
    logs,
    lastMessage,
    currentCommandIndex,
    approveAndRunPending,
    clearTask,
  } = useAgentExecution(sessionId);

  if (status === "idle") return null;

  const isExecuting = status === "executing";
  const isPaused = status === "paused";
  const isCompleted = status === "completed";
  const isError = status === "error";

  return (
    <div className="w-80 h-full bg-surface-container-high/40 backdrop-blur-xl border-l border-outline-variant/10 flex flex-col shadow-2xl relative z-30 transition-all duration-300 select-none">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-surface-container-high/30 border-b border-outline-variant/10">
        <div className="flex items-center gap-2">
          {isExecuting && (
            <span className="w-2 h-2 rounded-full bg-primary animate-ping" />
          )}
          {isPaused && (
            <span className="w-2 h-2 rounded-full bg-yellow-500" />
          )}
          {isCompleted && (
            <span className="w-2 h-2 rounded-full bg-green-500" />
          )}
          {isError && (
            <span className="w-2 h-2 rounded-full bg-red-500" />
          )}
          <span className="font-bold text-xs uppercase tracking-wider text-on-surface">
            OpenCode Agent
          </span>
        </div>
        <button
          onClick={clearTask}
          className="text-outline/50 hover:text-on-surface hover:bg-surface-variant/30 p-1 rounded-lg transition-all cursor-pointer"
          title="Close Agent"
        >
          <X size={14} />
        </button>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 aurora-ta">
        {/* Goal Section */}
        <div className="bg-surface-container-high/30 rounded-xl p-3 border border-outline-variant/10">
          <span className="text-[10px] text-outline/50 font-bold uppercase tracking-widest block mb-1">
            Active Goal
          </span>
          <p className="text-xs text-on-surface leading-relaxed whitespace-pre-wrap">
            {logs[0]?.replace('Started Agent Task: "', '').replace('"', '') || "Analyzing task..."}
          </p>
        </div>

        {/* Command Queue */}
        <div className="flex flex-col gap-2">
          <span className="text-[10px] text-outline/50 font-bold uppercase tracking-widest block mb-1">
            Execution Plan
          </span>
          {queue.length === 0 ? (
            <div className="text-center py-6 text-xs text-outline/50 flex flex-col items-center gap-2">
              <RefreshCw size={14} className="animate-spin text-primary" />
              <span>Planning command steps...</span>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {queue.map((item, index) => {
                const isActive = index === currentCommandIndex;
                return (
                  <div
                    key={index}
                    className={`rounded-lg border p-2.5 transition-all flex flex-col gap-1.5 ${
                      isActive
                        ? "bg-primary/10 border-primary/30"
                        : "bg-surface-container-high/20 border-outline-variant/5"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <code className="text-xs font-mono text-on-surface break-all flex-1 whitespace-pre-wrap">
                        {item.command}
                      </code>
                      <span className="mt-0.5 shrink-0">
                        {item.status === "pending" && (
                          <HelpCircle size={13} className="text-outline/40" />
                        )}
                        {item.status === "running" && (
                          <RefreshCw size={13} className="text-primary animate-spin" />
                        )}
                        {item.status === "success" && (
                          <CheckCircle2 size={13} className="text-green-500" />
                        )}
                        {item.status === "error" && (
                          <AlertCircle size={13} className="text-red-500" />
                        )}
                        {item.status === "requires_action" && (
                          <ShieldAlert size={13} className="text-yellow-500 animate-pulse" />
                        )}
                      </span>
                    </div>

                    {item.explanation && (
                      <p className="text-[10px] text-outline/70 leading-normal">
                        {item.explanation}
                      </p>
                    )}

                    {/* Safety Gate Prompt */}
                    {item.status === "requires_action" && (
                      <div className="mt-2 p-2 bg-yellow-500/10 border border-yellow-500/20 rounded-md flex flex-col gap-2">
                        <div className="flex items-center gap-1.5 text-[10px] text-yellow-400 font-semibold">
                          <ShieldAlert size={11} />
                          <span>Requires Manual Approval</span>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={approveAndRunPending}
                            className="flex-1 bg-yellow-500 hover:bg-yellow-400 text-black font-semibold text-[10px] py-1 px-2 rounded transition-all cursor-pointer flex items-center justify-center gap-1"
                          >
                            <Play size={8} fill="currentColor" />
                            Run Command
                          </button>
                          <button
                            onClick={clearTask}
                            className="bg-outline/10 hover:bg-outline/20 text-on-surface font-semibold text-[10px] py-1 px-2 rounded transition-all cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Logs */}
        <div className="flex-1 flex flex-col gap-2 min-h-[120px]">
          <span className="text-[10px] text-outline/50 font-bold uppercase tracking-widest block">
            Execution Logs
          </span>
          <div className="flex-1 bg-surface-container-high/10 rounded-xl p-3 border border-outline-variant/10 font-mono text-[10px] text-outline leading-relaxed overflow-y-auto max-h-[180px] aurora-ta">
            {logs.slice().reverse().map((log, i) => (
              <div key={i} className="mb-1 border-b border-outline-variant/5 pb-1">
                {log}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Footer / Status Area */}
      {lastMessage && (isCompleted || isError) && (
        <div className="p-4 bg-surface-container-high/50 border-t border-outline-variant/10">
          <div className={`p-3 rounded-lg border ${
            isCompleted 
              ? "bg-green-500/10 border-green-500/20 text-green-300"
              : "bg-red-500/10 border-red-500/20 text-red-300"
          } text-xs leading-relaxed whitespace-pre-wrap`}>
            {lastMessage}
          </div>
        </div>
      )}
    </div>
  );
}
