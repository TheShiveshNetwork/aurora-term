import React from "react";
import { FolderOpen, Terminal as TerminalIcon, FileCheck, Globe, Check, X, HelpCircle } from "lucide-react";
import { useAgentStore, SessionAgentState } from "../../stores/useAgentStore";
import { useSessionStore } from "../../stores/useSessionStore";
import { system } from "../../lib/ipc";

interface StatusTabButtonProps {
  isActive: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  badgeCount?: number;
  badgeBgColor?: string;
}

function StatusTabButton({
  isActive,
  onClick,
  icon,
  label,
  badgeCount = 0,
  badgeBgColor = "bg-blue-500",
}: StatusTabButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium cursor-pointer transition-all hover:bg-white/5 border ${isActive
        ? "bg-on-surface-variant/20 border-on-surface-variant/30"
        : "text-white/40 border-transparent"
        }`}
    >
      {icon}
      <span>{label}</span>
      {badgeCount > 0 && (
        <span className={`flex items-center justify-center min-w-[16px] h-4 px-1 text-[9px] font-bold rounded-full ${badgeBgColor} text-white animate-pulse`}>
          {badgeCount}
        </span>
      )}
    </button>
  );
}

interface StatusDrawerProps {
  sessionId: string;
  onApprove: () => void;
  onDecline: () => void;
  onSkip: () => void;
  onSubmitAnswer?: (answer: string) => void;
}

export function StatusDrawer({ sessionId, onApprove, onDecline, onSkip, onSubmitAnswer }: StatusDrawerProps) {
  const store = useAgentStore(s => s);
  const session = store.sessions[sessionId] || ({} as Partial<SessionAgentState>);

  const activeTab = session.activeDrawerTab || null;
  const filesChanged = session.filesChanged || [];
  const queue = session.queue || [];
  const pendingToolCall = session.pendingToolCall || null;

  // Counts for badges
  const pendingFilesCount = filesChanged.filter((f) => f.status === "pending").length;
  const pendingTerminalsCount = queue.filter((q) => q.status === "pending" || q.status === "requires_action" || q.status === "running").length;

  const sessionStore = useSessionStore();

  const handleViewDiff = async (file: any) => {
    try {
      let oldContent = "";
      const exists = await system.pathExists(file.path);
      if (exists) {
        oldContent = await system.readFileContent(file.path);
      }

      let newContent = "";
      if (file.type === "write") {
        newContent = file.newContent || "";
      } else if (file.type === "patch" && file.search) {
        newContent = oldContent.replace(file.search, file.replace || "");
      }

      const fileName = file.path.split(/[/\\]/).pop() || file.path;

      const existingTab = sessionStore.tabs.find(
        (t) => t.type === "diff" && t.filePath === file.path && t.diffCommitHash === "pending-agent-change"
      );

      if (existingTab) {
        sessionStore.updateTab(existingTab.id, {
          diffOldContent: oldContent,
          diffNewContent: newContent,
        });
        sessionStore.setActiveTabId(existingTab.id);
      } else {
        sessionStore.addTab({
          id: `diff-agent-${Date.now()}`,
          name: `Diff: ${fileName}`,
          type: "diff",
          filePath: file.path,
          diffOldContent: oldContent,
          diffNewContent: newContent,
          diffCommitHash: "pending-agent-change",
          created_at: Date.now(),
        });
      }
    } catch (err) {
      console.error("Failed to load diff:", err);
    }
  };

  const toggleTab = (tab: "files" | "terminals" | "artifacts" | "browsers" | "questions") => {
    if (activeTab === tab) {
      store.setActiveDrawerTab(sessionId, null);
    } else {
      store.setActiveDrawerTab(sessionId, tab);
    }
  };

  return (
    <div className="w-full px-3 flex flex-col shrink-0 select-none">
      {/* ── Status Icons Bar ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-2 py-1 rounded-t-sm border-t border-l border-r border-on-surface-variant/15 bg-on-surface-variant/10">
        <div className="flex items-center gap-3">
          <StatusTabButton
            isActive={activeTab === "files"}
            onClick={() => toggleTab("files")}
            icon={<FolderOpen size={13} />}
            label="Files"
            badgeCount={pendingFilesCount}
            badgeBgColor="bg-blue-500"
          />

          <StatusTabButton
            isActive={activeTab === "terminals"}
            onClick={() => toggleTab("terminals")}
            icon={<TerminalIcon size={13} />}
            label="Terminals"
            badgeCount={pendingTerminalsCount}
            badgeBgColor="bg-emerald-500"
          />

          <StatusTabButton
            isActive={activeTab === "artifacts"}
            onClick={() => toggleTab("artifacts")}
            icon={<FileCheck size={13} />}
            label="Artifacts"
          />

          <StatusTabButton
            isActive={activeTab === "browsers"}
            onClick={() => toggleTab("browsers")}
            icon={<Globe size={13} />}
            label="Browsers"
          />


        </div>
      </div>

      {/* ── Expanded Drawer Content ────────────────────────────────────────── */}
      {activeTab && (
        <div className="border-l border-r border-on-surface-variant/15 bg-on-surface-variant/10 max-h-[220px] overflow-y-auto scrollbar-thin">
          <div className="p-2 space-y-3">
            {/* 1. Files Tab */}
            {activeTab === "files" && (
              <div className="space-y-3">
                <div className="text-[11px] font-semibold text-white/50 tracking-wider">Changed Files list</div>
                {filesChanged.length === 0 ? (
                  <div className="text-xs text-white/30 italic">No files modified in this session yet.</div>
                ) : (
                  <div className="space-y-2">
                    {filesChanged.map((file, idx) => (
                      <div key={idx} className="flex flex-col p-2.5 rounded-lg border border-outline-variant/10 bg-on-surface-variant/5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-mono font-medium text-[#E8EAF0] truncate max-w-[65%]" title={file.path}>
                            {file.path}
                          </span>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              onClick={() => handleViewDiff(file)}
                              className="text-[10px] text-blue-400 hover:text-blue-300 font-semibold cursor-pointer underline mr-1"
                              title="Compare changes"
                            >
                              View Diff
                            </button>
                            <span
                              className={`text-[9px] font-bold tracking-wide px-1.5 py-0.5 rounded-sm ${file.status === "approved"
                                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                : file.status === "rejected"
                                  ? "bg-red-500/10 text-red-400 border border-red-500/20"
                                  : "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                                }`}
                            >
                              {file.type || "change"} ({file.status})
                            </span>
                          </div>
                        </div>

                        {/* Search and Replace Patch Diffs */}
                        {file.type === "patch" && file.search && (
                          <div className="mt-2 text-[10px] font-mono border border-white/[0.02] rounded overflow-hidden">
                            <div className="bg-red-500/5 text-red-300 p-1.5 border-b border-white/[0.02]">
                              <span className="text-[8px] font-bold text-red-500 mr-2">- SEARCH:</span>
                              {file.search}
                            </div>
                            <div className="bg-emerald-500/5 text-emerald-300 p-1.5">
                              <span className="text-[8px] font-bold text-emerald-500 mr-2">+ REPLACE:</span>
                              {file.replace}
                            </div>
                          </div>
                        )}

                        {/* Whole File Write Content Diffs */}
                        {file.type === "write" && file.newContent && (
                          <div className="mt-2 text-[10px] font-mono bg-white/[0.02] border border-white/[0.02] rounded p-1.5 max-h-[80px] overflow-y-auto scrollbar-none text-white/70">
                            {file.newContent}
                          </div>
                        )}

                        {file.status === "pending" && (
                          <div className="flex items-center gap-1.5 mt-2.5 justify-end">
                            <button
                              onClick={onApprove}
                              className="flex items-center gap-1 px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-500 text-[10px] font-bold text-white cursor-pointer transition-all shadow"
                            >
                              <Check size={10} />
                              Accept
                            </button>
                            <button
                              onClick={onDecline}
                              className="flex items-center gap-1 px-2.5 py-1 rounded bg-white/5 hover:bg-white/10 text-[10px] font-bold text-white/70 cursor-pointer border border-white/10 transition-all"
                            >
                              <X size={10} />
                              Reject
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Approvals buttons for files */}
                {pendingToolCall && (pendingToolCall.name === "write_file" || pendingToolCall.name === "patch_file") && (
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={onApprove}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white cursor-pointer transition-all shadow"
                    >
                      <Check size={12} />
                      <span>Approve Write</span>
                    </button>
                    <button
                      onClick={onDecline}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold bg-white/5 hover:bg-white/10 text-white/70 cursor-pointer border border-white/10 transition-all"
                    >
                      <X size={12} />
                      <span>Reject</span>
                    </button>
                    <button
                      onClick={onSkip}
                      className="px-3 py-1.5 rounded-md text-xs font-semibold bg-transparent hover:bg-white/5 text-white/40 cursor-pointer transition-all"
                    >
                      <span>Skip</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* 2. Terminals Tab */}
            {activeTab === "terminals" && (
              <div className="space-y-3">
                <div className="text-[11px] font-semibold text-white/50 tracking-wider">Terminal Execution Queue</div>
                {queue.length === 0 ? (
                  <div className="text-xs text-white/30 italic">No commands executed in this session.</div>
                ) : (
                  <div className="space-y-2">
                    {queue.map((cmd, idx) => {
                      const isActive = cmd.status === "requires_action" || cmd.status === "running";
                      return (
                        <div
                          key={idx}
                          className={`flex flex-col p-2.5 rounded-lg border transition-all ${isActive
                            ? "border-emerald-500/20 bg-emerald-500/[0.02]"
                            : "border-outline-variant/10 bg-on-surface-variant/5"
                            }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <pre className="text-xs font-mono font-medium text-[#E8EAF0] max-h-28 overflow-y-auto scrollbar-thin whitespace-pre-wrap break-all select-text flex-1 min-w-0 p-1.5 rounded bg-black/20 border border-white/5">
                              {cmd.command}
                            </pre>
                            <span
                              className={`text-[9px] font-bold tracking-wide px-1.5 py-0.5 rounded-sm shrink-0 ${cmd.status === "success"
                                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                : cmd.status === "error"
                                  ? "bg-red-500/10 text-red-400 border border-red-500/20"
                                  : cmd.status === "running"
                                    ? "bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse"
                                    : cmd.status === "requires_action"
                                      ? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                                      : "bg-white/5 text-white/30"
                                }`}
                            >
                              {cmd.status}
                            </span>
                          </div>
                          {cmd.explanation && (
                            <span className="text-[10px] text-white/40 mt-1">{cmd.explanation}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Approval buttons for commands */}
                {queue.some((cmd) => cmd.status === "requires_action") && (
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={onApprove}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer transition-all shadow"
                    >
                      <Check size={12} />
                      <span>Run Command</span>
                    </button>
                    <button
                      onClick={onDecline}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold bg-white/5 hover:bg-white/10 text-white/70 cursor-pointer border border-white/10 transition-all"
                    >
                      <X size={12} />
                      <span>Reject</span>
                    </button>
                    <button
                      onClick={onSkip}
                      className="px-3 py-1.5 rounded-md text-xs font-semibold bg-transparent hover:bg-white/5 text-white/40 cursor-pointer transition-all"
                    >
                      <span>Skip</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* 3. Artifacts Tab */}
            {activeTab === "artifacts" && (
              <div className="space-y-2">
                <div className="text-[11px] font-semibold text-white/50 tracking-wider">Created Artifacts</div>
                <div className="text-xs text-white/30 italic">No artifacts generated in this session.</div>
              </div>
            )}

            {/* 4. Browsers Tab */}
            {activeTab === "browsers" && (
              <div className="space-y-2">
                <div className="text-[11px] font-semibold text-white/50 tracking-wider">Active Browser Sessions</div>
                <div className="text-xs text-white/30 italic">No active browser sessions.</div>
              </div>
            )}


          </div>
        </div>
      )}
    </div>
  );
}
