import { useState, useRef, useCallback, useEffect } from "react";
import {
  Paperclip,
  ChevronDown,
  PanelLeft,
  PanelLeftClose,
} from "lucide-react";
import { useAgentStore, CONST_DEFAULT_SESSION_STATE } from "../stores/useAgentStore";
import { useAppShellStore } from "../stores/useAppShellStore";
import { useAgentExecution } from "../hooks/useAgentExecution";
import { AgentHeroView } from "./AgentHeroView";
import { AgentLeftPanel } from "../components/agents/AgentLeftPanel";
import { MenuView, MenuViewItem } from "../components/ui/MenuView";
import { StatusDrawer } from "../components/agents/StatusDrawer";
import { AgentPromptInput, AttachedFile } from "../components/agents/AgentPromptInput";
import { useVoiceInput } from "../hooks/useVoiceInput";
import { system } from "../lib/ipc";
import { useSessionStore } from "../stores/useSessionStore";

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
import { CommandApprovalCard } from "../components/agents/CommandApprovalCard";
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
  const [showSubheaderMenu, setShowSubheaderMenu] = useState(false);

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
    queue,
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

  // Auto-open a diff tab when the developer agent proposes a file write/patch
  useEffect(() => {
    const handler = async (e: Event) => {
      const { path, type, newContent, search, replace } = (e as CustomEvent).detail;
      if (!path) return;
      const fileName = path.split(/[/\\]/).pop() || path;
      try {
        let oldContent = "";
        const exists = await system.pathExists(path);
        if (exists) {
          oldContent = await system.readFileContent(path);
        }
        let resolvedNew = newContent || "";
        if (type === "patch" && search) {
          resolvedNew = oldContent.replace(search, replace || "");
        }
        const sessionStore = useSessionStore.getState();
        const existingTab = sessionStore.tabs.find(
          (t) => t.type === "diff" && t.filePath === path && t.diffCommitHash === "pending-agent-change"
        );
        if (existingTab) {
          sessionStore.updateTab(existingTab.id, {
            diffOldContent: oldContent,
            diffNewContent: resolvedNew,
          });
          sessionStore.setActiveTabId(existingTab.id);
        } else {
          const tabId = `diff-agent-${Date.now()}`;
          sessionStore.addTab({
            id: tabId,
            name: `⚙ Draft: ${fileName}`,
            type: "diff",
            filePath: path,
            diffOldContent: oldContent,
            diffNewContent: resolvedNew,
            diffCommitHash: "pending-agent-change",
            created_at: Date.now(),
          });
          // Explicitly set as active tab even if another tab is open
          sessionStore.setActiveTabId(tabId);
        }
      } catch (err) {
        console.warn("Failed to auto-open agent diff:", err);
      }
    };
    window.addEventListener("aurora-agent-file-change", handler);
    return () => window.removeEventListener("aurora-agent-file-change", handler);
  }, []);

  // Close pending-agent-change diff tabs after approve/reject
  useEffect(() => {
    const closeHandler = (e: Event) => {
      const { path } = (e as CustomEvent).detail;
      if (!path) return;
      const sessionStore = useSessionStore.getState();
      const tab = sessionStore.tabs.find(
        (t) => t.type === "diff" && t.filePath === path && t.diffCommitHash === "pending-agent-change"
      );
      if (tab) {
        sessionStore.removeTab(tab.id);
      }
    };
    window.addEventListener("aurora-close-agent-diff", closeHandler);
    return () => window.removeEventListener("aurora-close-agent-diff", closeHandler);
  }, []);

  const showEmptyState = chatHistory.length === 0 && !isThinking;

  // Pair chat history into turns, supporting standalone assistant messages/errors
  const turns: Array<{ user: ChatMessage | null; assistant: ChatMessage | null }> = [];
  let idx = 0;
  while (idx < chatHistory.length) {
    const msg = chatHistory[idx];
    if (msg.role === "user") {
      const next = chatHistory[idx + 1];
      if (next?.role === "assistant") {
        turns.push({ user: msg, assistant: next });
        idx += 2;
      } else {
        turns.push({ user: msg, assistant: null });
        idx += 1;
      }
    } else if (msg.role === "assistant") {
      turns.push({ user: null, assistant: msg });
      idx += 1;
    } else {
      idx += 1;
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
    const emptySession = Object.entries(sessions).find(([_, s]) => s.isAgentViewSession && s.chatHistory.length === 0);
    if (emptySession) {
      setActiveAgentSessionId(emptySession[0]);
    } else {
      createAgentSession("New Session");
    }
  };

  // Previous Agent View Sessions
  const agentSessions = Object.entries(sessions)
    .filter(([_, s]) => s.isAgentViewSession && s.chatHistory.length > 0)
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
          <AgentLeftPanel
            leftWidth={leftWidth}
            onLeftDragHandleMouseDown={onLeftDragHandleMouseDown}
            handleNewSession={handleNewSession}
            agentSessions={agentSessions}
            targetSessionId={targetSessionId}
            setActiveAgentSessionId={setActiveAgentSessionId}
            deleteAgentSession={deleteAgentSession}
            renameAgentSession={renameAgentSession}
          />
        )}

        {/* ── Main Chat Area ── */}
        <div className="flex-1 min-w-0 flex flex-col h-full bg-background relative overflow-hidden">
          {!showEmptyState && (
            /* Transparent Subheader */
            <div className="flex items-center justify-between px-4 h-13 shrink-0 bg-transparent select-none border-b border-white/[0.04]">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setLeftPanelOpen(!leftPanelOpen)}
                  className="p-1.5 rounded-[8px] hover:bg-white/5 text-white/60 hover:text-white transition-colors cursor-pointer"
                  title={leftPanelOpen ? "Hide sidebar" : "Show sidebar"}
                >
                  {leftPanelOpen ? <PanelLeftClose size={14} /> : <PanelLeft size={14} />}
                </button>
              </div>

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
                <div className="relative">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowSubheaderMenu(!showSubheaderMenu);
                    }}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-[10px] hover:bg-white/5 transition-colors cursor-pointer text-xs font-semibold text-on-surface border-none bg-transparent"
                    title="Session Actions"
                  >
                    <span>{sessionState.title || "New Session"}</span>
                    <ChevronDown size={12} className="text-white/40" />
                  </button>

                  <MenuView
                    open={showSubheaderMenu}
                    onClose={() => setShowSubheaderMenu(false)}
                    className="absolute left-1/2 -translate-x-1/2 mt-1.5 w-40 z-[999]"
                    style={{ pointerEvents: "auto" }}
                  >
                    <MenuViewItem
                      onClick={() => {
                        setShowSubheaderMenu(false);
                        handleNewSession();
                      }}
                    >
                      New Session
                    </MenuViewItem>
                    <MenuViewItem
                      onClick={() => {
                        setShowSubheaderMenu(false);
                        setTempTitle(sessionState.title || "New Session");
                        setIsEditingTitle(true);
                      }}
                    >
                      Rename Session
                    </MenuViewItem>
                  </MenuView>
                </div>
              )}

              <div className="w-8" />
            </div>
          )}

          {/* Chat Content */}
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden relative">
            {showEmptyState ? (
              <AgentHeroView
                onSend={handleHeroSend}
                selectedModel={selectedModel}
                onModelChange={handleModelChange}
                sessionName={sessionState.title || "New Session"}
                onNewSession={handleNewSession}
                onRenameSession={(newTitle) => targetSessionId && renameAgentSession(targetSessionId, newTitle)}
              />
            ) : (
              <>
                <ChatContainerRoot className="flex-1 overflow-y-auto scrollbar-thin">
                  <ChatContainerContent className="max-w-[900px] w-full mx-auto px-5 py-6 space-y-6">
                    {turns.map((turn, idx) => {
                      const isLastTurn = idx === lastTurnIndex;
                      return (
                        <AgentTurnMessage
                          key={turn.user?.id || turn.assistant?.id || `turn-${idx}`}
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
                  <div className="max-w-[900px] mx-auto w-full flex flex-col overflow-visible">
                    {/* Command Approval Card when awaiting approval */}
                    {status === "paused" && (function () {
                      const pendingCmd = queue.find((c) => c.status === "requires_action");
                      if (!pendingCmd) return null;
                      return (
                        <CommandApprovalCard
                          className="mb-3"
                          command={pendingCmd.command}
                          explanation={pendingCmd.explanation}
                          onApprove={approveAndRunPending}
                          onSkip={skipPending}
                        />
                      );
                    })()}

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
