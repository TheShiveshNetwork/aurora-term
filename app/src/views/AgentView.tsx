import { useState, useRef, useCallback, useEffect } from "react";
import {
  Paperclip,
  Plus,
  MessageSquare,
  Trash2,
  ChevronDown,
  PanelLeft,
  PanelLeftClose,
  Cpu
} from "lucide-react";
import { useAgentStore, CONST_DEFAULT_SESSION_STATE } from "../stores/useAgentStore";
import { useAppShellStore } from "../stores/useAppShellStore";
import { useAgentExecution } from "../hooks/useAgentExecution";
import { AgentHeroView } from "./AgentHeroView";
import { StatusDrawer } from "../components/agents/StatusDrawer";
import { AgentPromptInput, AttachedFile } from "../components/agents/AgentPromptInput";
import { useVoiceInput } from "../hooks/useVoiceInput";
import { system } from "../lib/ipc";

// Import prompt-kit components
import {
  ChatContainerRoot,
  ChatContainerContent,
  ChatContainerScrollAnchor,
} from "../components/prompt-kit/chat-container";
import { ScrollButton } from "../components/prompt-kit/scroll-button";
import { TextShimmer } from "../components/prompt-kit/text-shimmer";
import { FileUpload, FileUploadContent } from "../components/prompt-kit/file-upload";

// Import agent components
import { AgentTurnMessage } from "../components/agents";
import type { ChatMessage } from "../stores/useAgentStore";

export function AgentView() {
  const [input, setInput] = useState("");
  const [copiedStates, setCopiedStates] = useState<Record<string, boolean>>({});
  const [likeStates, setLikeStates] = useState<Record<string, boolean>>({});
  const [dislikeStates, setDislikeStates] = useState<Record<string, boolean>>({});
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showStatusDrawer, setShowStatusDrawer] = useState(true);

  // Left sidebar & Title rename states
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [tempTitle, setTempTitle] = useState("");

  // Left sidebar resizer states
  const MIN_LEFT_PANEL_WIDTH = 200;
  const MAX_LEFT_PANEL_WIDTH = 450;
  const [leftWidth, setLeftWidth] = useState(240);
  const leftPanelDragRef = useRef<{ startX: number; startW: number } | null>(null);

  const onLeftDragHandleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    leftPanelDragRef.current = { startX: e.clientX, startW: leftWidth };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [leftWidth]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = leftPanelDragRef.current;
      if (!d) return;
      const delta = e.clientX - d.startX;
      setLeftWidth(Math.min(MAX_LEFT_PANEL_WIDTH, Math.max(MIN_LEFT_PANEL_WIDTH, d.startW + delta)));
    };
    const onUp = () => {
      if (!leftPanelDragRef.current) return;
      leftPanelDragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const sessions = useAgentStore((s) => s.sessions);
  const setAgentMode = useAgentStore((s) => s.setAgentMode);
  const activeAgentSessionId = useAgentStore((s) => s.activeAgentSessionId);
  const setActiveAgentSessionId = useAgentStore((s) => s.setActiveAgentSessionId);
  const createAgentSession = useAgentStore((s) => s.createAgentSession);
  const renameAgentSession = useAgentStore((s) => s.renameAgentSession);
  const deleteAgentSession = useAgentStore((s) => s.deleteAgentSession);

  const targetSessionId = activeAgentSessionId;

  const { isListening, toggleListening } = useVoiceInput({
    onTranscript: (text) => setInput(text),
    getCurrentValue: () => input,
  });

  const {
    startTask,
    status,
    chatHistory,
    retryTask,
    approveAndRunPending,
    declinePending,
    skipPending,
    submitAnswer,
    chainNodes,
    stepCount,
    maxSteps,
    activeSubagent,
  } = useAgentExecution(targetSessionId);

  const sessionState = targetSessionId ? sessions[targetSessionId] || CONST_DEFAULT_SESSION_STATE : CONST_DEFAULT_SESSION_STATE;
  const isThinking = status === "planning" || status === "executing";
  const isThinkingOrPaused = isThinking || status === "paused";

  const selectedModel = sessionState.model || "";

  const handleModelChange = useCallback((model: string) => {
    if (targetSessionId) {
      useAgentStore.getState().setAgentModel(targetSessionId, model);
    }
  }, [targetSessionId]);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || isThinking) return;

    setInput("");
    setAttachedFiles([]);

    if (sessionState.pendingToolCall?.name === "ask_user") {
      submitAnswer(trimmed);
      return;
    }

    let finalPrompt = trimmed;
    if (attachedFiles.length > 0) {
      const fileContentsBlock = attachedFiles
        .map((f) => `### File: ${f.name} (${f.path})\n\`\`\`\n${f.content}\n\`\`\``)
        .join("\n\n");
      finalPrompt = `${trimmed}\n\nHere are some relevant files to reference:\n\n${fileContentsBlock}`;
    }

    if (targetSessionId) {
      startTask(finalPrompt, "developer", selectedModel);
    }
  }, [input, isThinking, attachedFiles, startTask, selectedModel, sessionState.pendingToolCall, submitAnswer, targetSessionId]);

  const handleHeroSend = useCallback((text: string, files?: AttachedFile[]) => {
    if (isThinking) return;
    useAppShellStore.getState().setViewMode("agent");

    let finalPrompt = text;
    if (files && files.length > 0) {
      const fileContentsBlock = files
        .map((f) => `### File: ${f.name} (${f.path})\n\`\`\`\n${f.content}\n\`\`\``)
        .join("\n\n");
      finalPrompt = `${text}\n\nHere are some relevant files to reference:\n\n${fileContentsBlock}`;
    }

    if (targetSessionId) {
      startTask(finalPrompt, "developer", selectedModel);
    }
  }, [isThinking, startTask, selectedModel, targetSessionId]);

  const handleAttachFileClick = async () => {
    try {
      const filePath = await system.selectFile();
      if (!filePath) return;

      const name = filePath.split(/[/\\]/).pop() || filePath;
      const content = await system.readFileContent(filePath);

      setAttachedFiles((prev) => {
        if (prev.some((f) => f.path === filePath)) return prev;
        return [...prev, { name, path: filePath, content }];
      });
    } catch (err) {
      console.error("Failed to attach file:", err);
    }
  };

  const handleFilesAdded = async (files: File[]) => {
    for (const file of files) {
      try {
        const reader = new FileReader();
        reader.onload = (e) => {
          const content = (e.target?.result as string) || "";
          setAttachedFiles((prev) => {
            if (prev.some((f) => f.name === file.name)) return prev;
            return [...prev, { name: file.name, path: file.name, content }];
          });
        };
        reader.readAsText(file);
      } catch (err) {
        console.error("Failed to read dropped file:", err);
      }
    }
  };

  const showEmptyState = chatHistory.length === 0 && !isThinking;

  // Pair chat history into turns (user + optional assistant)
  const turns: Array<{ user: ChatMessage; assistant: ChatMessage | null }> = [];
  for (let idx = 0; idx < chatHistory.length; idx++) {
    const msg = chatHistory[idx];
    if (msg.role === "user") {
      const next = chatHistory[idx + 1];
      const assistant = next?.role === "assistant" ? next : null;
      turns.push({ user: msg, assistant });
      if (assistant) idx++;
    }
  }
  const lastTurnIndex = turns.length - 1;

  // Save session title rename
  const saveRename = () => {
    if (targetSessionId && tempTitle.trim()) {
      renameAgentSession(targetSessionId, tempTitle.trim());
    }
    setIsEditingTitle(false);
  };

  const handleNewSession = () => {
    createAgentSession("New Session");
  };

  // Previous Agent View Sessions
  const agentSessions = Object.entries(sessions)
    .filter(([_, s]) => s.isAgentViewSession)
    .map(([id, s]) => ({ id, ...s }));

  return (
    <FileUpload onFilesAdded={handleFilesAdded}>
      <FileUploadContent className="bg-background/80 fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm">
        <div className="border border-outline bg-surface-container-high/90 p-8 rounded-2xl flex flex-col items-center gap-3 max-w-sm text-center shadow-2xl">
          <Paperclip className="h-8 w-8 text-primary animate-pulse" />
          <h3 className="font-semibold text-sm text-on-surface">Add files to Agent Context</h3>
          <p className="text-xs text-on-surface-variant/70">Release your mouse button to attach files to your next message.</p>
        </div>
      </FileUploadContent>

      <div className="flex h-full w-full bg-background overflow-hidden relative">
        <input
          type="file"
          ref={fileInputRef}
          onChange={(e) => {
            if (e.target.files?.length) {
              const filesArray = Array.from(e.target.files);
              handleFilesAdded(filesArray);
              e.target.value = "";
            }
          }}
          className="hidden"
        />

        {/* ── Left Sidebar (Sessions List) ── */}
        {leftPanelOpen && (
          <div
            className="shrink-0 flex flex-col h-full bg-[#0F131A] border-r border-white/[0.06] select-none relative"
            style={{ width: leftWidth }}
          >
            {/* New Session Button */}
            <div className="p-3">
              <button
                onClick={handleNewSession}
                className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border border-white/[0.08] hover:bg-white/[0.05] text-xs font-semibold text-on-surface cursor-pointer transition-all"
              >
                <Plus size={14} />
                New Session
              </button>
            </div>

            {/* Scrollable list of previous sessions */}
            <div className="flex-1 overflow-y-auto scrollbar-thin px-2 space-y-1">
              <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-white/30">
                Recent Chats
              </div>
              {agentSessions.length === 0 ? (
                <div className="px-3 py-4 text-xs text-white/20 italic text-center">
                  No previous sessions
                </div>
              ) : (
                agentSessions.map((s) => {
                  const isActive = s.id === targetSessionId;
                  return (
                    <div
                      key={s.id}
                      onClick={() => setActiveAgentSessionId(s.id)}
                      className={`group flex items-center justify-between px-3 py-2 rounded-lg text-xs hover:bg-white/[0.04] text-white/70 hover:text-white transition-all cursor-pointer ${isActive ? "bg-white/[0.06] text-white font-medium border border-white/[0.04]" : ""
                        }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <MessageSquare size={12} className="text-white/40 shrink-0" />
                        <span className="truncate">{s.title || "Untitled Session"}</span>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteAgentSession(s.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-white/10 text-white/40 hover:text-red-400 transition-all cursor-pointer shrink-0"
                        title="Delete Session"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            {/* Resize handle on right edge */}
            <div
              onMouseDown={onLeftDragHandleMouseDown}
              className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize z-30 group select-none"
              title="Drag to resize"
            >
              <div
                className="w-px h-full ml-auto transition-colors"
                style={{ background: "transparent" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(79,140,255,0.35)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              />
            </div>
          </div>
        )}

        {/* ── Main Chat Area ── */}
        <div className="flex-1 min-w-0 flex flex-col h-full bg-background relative overflow-hidden">
          {/* Transparent Subheader */}
          <div className="flex items-center justify-between px-4 h-13 shrink-0 bg-transparent border-b border-white/[0.04] select-none">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setLeftPanelOpen(!leftPanelOpen)}
                className="p-1.5 rounded-[8px] hover:bg-white/5 text-white/60 hover:text-white transition-colors cursor-pointer"
                title={leftPanelOpen ? "Hide sidebar" : "Show sidebar"}
              >
                {leftPanelOpen ? <PanelLeftClose size={14} /> : <PanelLeft size={14} />}
              </button>
            </div>

            <div className="flex-1 flex justify-center">
              {isEditingTitle ? (
                <input
                  type="text"
                  className="bg-white/5 border border-white/10 rounded px-2.5 py-0.5 text-xs text-white focus:outline-none focus:border-primary font-medium w-48 text-center"
                  value={tempTitle}
                  onChange={(e) => setTempTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      saveRename();
                    } else if (e.key === "Escape") {
                      setIsEditingTitle(false);
                    }
                  }}
                  onBlur={saveRename}
                  autoFocus
                />
              ) : (
                <div
                  onClick={() => {
                    setTempTitle(sessionState.title || "New Session");
                    setIsEditingTitle(true);
                  }}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-[10px] hover:bg-white/5 transition-colors cursor-pointer text-xs font-semibold text-on-surface"
                  title="Click to rename session"
                >
                  <span>{sessionState.title || "New Session"}</span>
                  <ChevronDown size={12} className="text-white/40" />
                </div>
              )}
            </div>

            <div className="w-8" />
          </div>

          {/* Chat Content */}
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden relative">
            {showEmptyState ? (
              <AgentHeroView
                onSend={handleHeroSend}
                selectedModel={selectedModel}
                onModelChange={handleModelChange}
              />
            ) : (
              <>
                <ChatContainerRoot className="flex-1 overflow-y-auto scrollbar-thin">
                  <ChatContainerContent className="max-w-[800px] w-full mx-auto px-5 py-6 space-y-6">
                    {turns.map((turn, idx) => {
                      const isLastTurn = idx === lastTurnIndex;
                      return (
                        <AgentTurnMessage
                          key={turn.user.id}
                          userMsg={turn.user}
                          assistantMsg={turn.assistant}
                          isThinking={isLastTurn && isThinking}
                          isLastTurn={isLastTurn}
                          chainNodes={turn.assistant?.chainNodes || (isLastTurn ? chainNodes : [])}
                          durationSecs={0}
                          stepCount={isLastTurn ? stepCount : 0}
                          maxSteps={isLastTurn ? maxSteps : 0}
                          variant="full"
                          copied={!!copiedStates[turn.assistant?.id || ""]}
                          onCopy={(content) => {
                            navigator.clipboard.writeText(content);
                            const id = turn.assistant?.id || "";
                            setCopiedStates((p) => ({ ...p, [id]: true }));
                            setTimeout(() => setCopiedStates((p) => ({ ...p, [id]: false })), 2000);
                          }}
                          onLike={() => {
                            const id = turn.assistant?.id || "";
                            setLikeStates((p) => ({ ...p, [id]: !p[id] }));
                            setDislikeStates((p) => ({ ...p, [id]: false }));
                          }}
                          onDislike={() => {
                            const id = turn.assistant?.id || "";
                            setDislikeStates((p) => ({ ...p, [id]: !p[id] }));
                            setLikeStates((p) => ({ ...p, [id]: false }));
                          }}
                        />
                      );
                    })}

                    {isThinking && turns.length > 0 && !turns[turns.length - 1].assistant && (
                      <div />
                    )}
                  </ChatContainerContent>

                  <ChatContainerScrollAnchor />
                  <ScrollButton className="fixed bottom-24 right-8 z-30" />
                </ChatContainerRoot>

                {/* Input Area */}
                <div className="shrink-0 pb-3 px-5 w-full">
                  <div className="max-w-[800px] mx-auto w-full flex flex-col overflow-visible">
                    {/* Status Drawer inside Input container */}
                    {targetSessionId && showStatusDrawer && (
                      <StatusDrawer
                        sessionId={targetSessionId}
                        onApprove={approveAndRunPending}
                        onDecline={declinePending}
                        onSkip={skipPending}
                        onSubmitAnswer={submitAnswer}
                      />
                    )}

                    {/* Prompt Input Form */}
                    <AgentPromptInput
                      value={input}
                      onValueChange={setInput}
                      onSubmit={handleSend}
                      isLoading={isThinking}
                      attachedFiles={attachedFiles}
                      onRemoveFile={(idx) => setAttachedFiles(prev => prev.filter((_, i) => i !== idx))}
                      isListening={isListening}
                      toggleListening={toggleListening}
                      onAttachClick={handleAttachFileClick}
                      showModeSelector={true}
                      agentMode={sessionState.agentMode}
                      setAgentMode={(mode) => targetSessionId && setAgentMode(targetSessionId, mode)}
                      selectedModel={selectedModel}
                      onModelChange={handleModelChange}
                      showStatusDrawer={showStatusDrawer}
                      onToggleStatusDrawer={() => setShowStatusDrawer(!showStatusDrawer)}
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </FileUpload>
  );
}

export default AgentView;
