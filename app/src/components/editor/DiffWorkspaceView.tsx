import { DiffEditor } from "./DiffEditor";
import { useAgentStore } from "../../stores/useAgentStore";
import { useSessionStore } from "../../stores/useSessionStore";
import { useAgentExecution } from "../../hooks/useAgentExecution";
import { Check, X } from "lucide-react";

interface DiffWorkspaceViewProps {
  tabId?: string;
  filePath: string;
  oldContent: string;
  newContent: string;
  commitHash: string;
  onOpenFile?: (filePath: string) => void;
}

// When commitHash === "pending-agent-change" this is an agent diff —
// a header bar with Accept / Reject buttons is rendered above the editor.
export function DiffWorkspaceView({
  tabId,
  filePath,
  oldContent,
  newContent,
  commitHash,
  onOpenFile,
}: DiffWorkspaceViewProps) {
  const fileName = filePath.split(/[/\\]/).pop() || filePath;
  const isAgentDiff = commitHash === "pending-agent-change";

  const activeAgentSessionId = useAgentStore((s) => s.activeAgentSessionId);
  const { approveAndRunPending, declinePending } = useAgentExecution(activeAgentSessionId);

  return (
    <div className="flex flex-col w-full h-full overflow-hidden">
      {isAgentDiff && (
        <div
          className="flex items-center justify-between px-4 py-2 shrink-0 select-none"
          style={{
            background: "rgba(30,50,100,0.30)",
            borderBottom: "1px solid rgba(60,100,200,0.20)",
          }}
        >
          <div className="flex items-center gap-2">
            <span className="font-bold text-[11px] text-blue-400 tracking-wider">AGENT PROPOSED CHANGE</span>
            <span className="font-mono text-xs text-white/60">{filePath}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={async () => {
                await approveAndRunPending();
                if (tabId) useSessionStore.getState().removeTab(tabId);
              }}
              className="flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-bold text-white cursor-pointer transition-all"
              style={{ background: "rgba(37,99,235,0.80)" }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.85")}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
            >
              <Check size={11} /> Accept Change
            </button>
            <button
              onClick={async () => {
                await declinePending();
                if (tabId) useSessionStore.getState().removeTab(tabId);
              }}
              className="flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-bold text-white/70 cursor-pointer transition-all border border-white/10"
              style={{ background: "rgba(255,255,255,0.04)" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.09)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.04)")}
            >
              <X size={11} /> Reject
            </button>
          </div>
        </div>
      )}

      {/* DiffEditor fills remaining height */}
      <div className="flex-1 min-h-0 relative">
        <DiffEditor
          filePath={filePath}
          oldContent={oldContent}
          newContent={newContent}
          oldLabel={isAgentDiff ? `Original — ${fileName}` : `${commitHash.slice(0, 7)}~1 — ${fileName}`}
          newLabel={isAgentDiff ? `Agent Draft — ${fileName}` : `${commitHash.slice(0, 7)} — ${fileName}`}
          commitHash={commitHash}
          onOpenFile={onOpenFile}
        />
      </div>
    </div>
  );
}