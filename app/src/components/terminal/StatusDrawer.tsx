import React from "react";
import { FolderOpen, Terminal as TerminalIcon, FileCheck, Globe, Check, X, ShieldAlert, HelpCircle } from "lucide-react";
import { useAgentStore, SessionAgentState } from "../../stores/useAgentStore";

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

  const toggleTab = (tab: "files" | "terminals" | "artifacts" | "browsers" | "questions") => {
    if (activeTab === tab) {
      store.setActiveDrawerTab(sessionId, null);
    } else {
      store.setActiveDrawerTab(sessionId, tab);
    }
  };

  const hasPendingAction = 
    (pendingToolCall && (pendingToolCall.name === "write_file" || pendingToolCall.name === "patch_file" || pendingToolCall.name === "ask_user")) ||
    (queue.some((cmd) => cmd.status === "requires_action"));

  return (
    <div className="w-full flex flex-col shrink-0 select-none">
      {/* ── Status Icons Bar ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-1.5 border-t border-b border-white/[0.04] bg-white/[0.01]">
        <div className="flex items-center gap-3">
          {/* Files Changed Icon */}
          <button
            onClick={() => toggleTab("files")}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium cursor-pointer transition-all hover:bg-white/[0.05] ${
              activeTab === "files" ? "text-blue-400 bg-blue-500/10 border border-blue-500/20" : "text-white/40 border border-transparent"
            }`}
          >
            <FolderOpen size={13} />
            <span>Files</span>
            {pendingFilesCount > 0 && (
              <span className="flex items-center justify-center min-w-[16px] h-4 px-1 text-[9px] font-bold rounded-full bg-blue-500 text-white animate-pulse">
                {pendingFilesCount}
              </span>
            )}
          </button>

          {/* Terminal Runs Icon */}
          <button
            onClick={() => toggleTab("terminals")}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium cursor-pointer transition-all hover:bg-white/[0.05] ${
              activeTab === "terminals" ? "text-emerald-400 bg-emerald-500/10 border border-emerald-500/20" : "text-white/40 border border-transparent"
            }`}
          >
            <TerminalIcon size={13} />
            <span>Terminals</span>
            {pendingTerminalsCount > 0 && (
              <span className="flex items-center justify-center min-w-[16px] h-4 px-1 text-[9px] font-bold rounded-full bg-emerald-500 text-white animate-pulse">
                {pendingTerminalsCount}
              </span>
            )}
          </button>

          {/* Artifacts Icon */}
          <button
            onClick={() => toggleTab("artifacts")}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium cursor-pointer transition-all hover:bg-white/[0.05] ${
              activeTab === "artifacts" ? "text-purple-400 bg-purple-500/10 border border-purple-500/20" : "text-white/40 border border-transparent"
            }`}
          >
            <FileCheck size={13} />
            <span>Artifacts</span>
          </button>

          {/* Browser Sessions Icon */}
          <button
            onClick={() => toggleTab("browsers")}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium cursor-pointer transition-all hover:bg-white/[0.05] ${
              activeTab === "browsers" ? "text-amber-400 bg-amber-500/10 border border-amber-500/20" : "text-white/40 border border-transparent"
            }`}
          >
            <Globe size={13} />
            <span>Browsers</span>
          </button>

          {/* Questions Icon */}
          {pendingToolCall?.name === "ask_user" && (
            <button
              onClick={() => toggleTab("questions")}
              className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium cursor-pointer transition-all hover:bg-white/[0.05] ${
                activeTab === "questions" ? "text-amber-400 bg-amber-500/10 border border-amber-500/20" : "text-white/40 border border-transparent"
              }`}
            >
              <HelpCircle size={13} />
              <span>Questions</span>
              <span className="flex items-center justify-center min-w-[16px] h-4 px-1 text-[9px] font-bold rounded-full bg-amber-500 text-white animate-pulse">
                1
              </span>
            </button>
          )}
        </div>

        {hasPendingAction && (
          <div className="flex items-center gap-1.5 text-[10px] text-amber-400/90 font-medium bg-amber-500/5 px-2 py-0.5 border border-amber-500/10 rounded-md animate-pulse">
            <ShieldAlert size={11} />
            <span>Action Required</span>
          </div>
        )}
      </div>

      {/* ── Expanded Drawer Content ────────────────────────────────────────── */}
      {activeTab && (
        <div className="border-b border-white/[0.04] bg-[#0c0e17]/80 backdrop-blur-md max-h-[220px] overflow-y-auto scrollbar-thin">
          <div className="p-4 space-y-3">
            {/* 1. Files Tab */}
            {activeTab === "files" && (
              <div className="space-y-3">
                <div className="text-[11px] font-semibold text-white/50 uppercase tracking-wider">Changed Files list</div>
                {filesChanged.length === 0 ? (
                  <div className="text-xs text-white/30 italic">No files modified in this session yet.</div>
                ) : (
                  <div className="space-y-2">
                    {filesChanged.map((file, idx) => (
                      <div key={idx} className="flex flex-col p-2.5 rounded-lg border border-white/[0.04] bg-white/[0.01]">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-mono font-medium text-[#E8EAF0]">{file.path}</span>
                          <span
                            className={`text-[9px] uppercase font-bold tracking-wide px-1.5 py-0.5 rounded-sm ${
                              file.status === "approved"
                                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                : file.status === "rejected"
                                ? "bg-red-500/10 text-red-400 border border-red-500/20"
                                : "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                            }`}
                          >
                            {file.type || "change"} ({file.status})
                          </span>
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
                <div className="text-[11px] font-semibold text-white/50 uppercase tracking-wider">Terminal Execution Queue</div>
                {queue.length === 0 ? (
                  <div className="text-xs text-white/30 italic">No commands executed in this session.</div>
                ) : (
                  <div className="space-y-2">
                    {queue.map((cmd, idx) => {
                      const isActive = cmd.status === "requires_action" || cmd.status === "running";
                      return (
                        <div
                          key={idx}
                          className={`flex flex-col p-2.5 rounded-lg border transition-all ${
                            isActive
                              ? "border-emerald-500/20 bg-emerald-500/[0.02]"
                              : "border-white/[0.04] bg-white/[0.01]"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-mono font-medium text-[#E8EAF0]">{cmd.command}</span>
                            <span
                              className={`text-[9px] uppercase font-bold tracking-wide px-1.5 py-0.5 rounded-sm ${
                                cmd.status === "success"
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
                <div className="text-[11px] font-semibold text-white/50 uppercase tracking-wider">Created Artifacts</div>
                <div className="text-xs text-white/30 italic">No artifacts generated in this session.</div>
              </div>
            )}

            {/* 4. Browsers Tab */}
            {activeTab === "browsers" && (
              <div className="space-y-2">
                <div className="text-[11px] font-semibold text-white/50 uppercase tracking-wider">Active Browser Sessions</div>
                <div className="text-xs text-white/30 italic">No active browser sessions.</div>
              </div>
            )}

            {/* 5. Questions Tab */}
            {activeTab === "questions" && pendingToolCall?.name === "ask_user" && (
              <div className="space-y-3">
                <div className="text-[11px] font-semibold text-white/50 uppercase tracking-wider">Aura Clarifying Question</div>
                <div className="p-3 rounded-lg border border-amber-500/20 bg-amber-500/[0.02]">
                  <p className="text-xs text-[#E8EAF0] font-medium leading-relaxed select-text">
                    {pendingToolCall.args.question}
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  <textarea
                    id="aurora-agent-answer-input"
                    placeholder="Type your answer here..."
                    className="w-full bg-[#161929] border border-white/[0.08] rounded-md text-xs p-2 text-white outline-none focus:border-blue-500/50 resize-none h-[60px]"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        const val = e.currentTarget.value.trim();
                        if (val && onSubmitAnswer) {
                          onSubmitAnswer(val);
                        }
                      }
                    }}
                  />
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => {
                        const textarea = document.getElementById("aurora-agent-answer-input") as HTMLTextAreaElement;
                        const val = textarea?.value?.trim();
                        if (val && onSubmitAnswer) {
                          onSubmitAnswer(val);
                        }
                      }}
                      className="flex items-center gap-1 px-3 py-1 rounded-md text-xs font-semibold bg-amber-600 hover:bg-amber-500 text-white cursor-pointer transition-all shadow"
                    >
                      <Check size={11} />
                      <span>Submit Answer</span>
                    </button>
                    <button
                      onClick={onDecline}
                      className="flex items-center gap-1 px-3 py-1 rounded-md text-xs font-semibold bg-[#1c2033] hover:bg-[#252a45] text-white/70 cursor-pointer border border-white/10 transition-all"
                    >
                      <X size={11} />
                      <span>Decline</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
