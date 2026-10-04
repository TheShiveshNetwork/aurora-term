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
import { StatusDrawer } from "../components/agents/StatusDrawer"; // eslint-disable-line @typescript-eslint/no-unused-vars -- re-enabled with the StatusDrawer block below
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { AgentPromptInput, AttachedFile } from "../components/agents/AgentPromptInput";
import { useVoiceInput } from "../hooks/useVoiceInput";
import { system } from "../lib/ipc";
import { resolveSlashCommand } from "../lib/agentSlash";
import { useSessionStore } from "../stores/useSessionStore";
import { agentSessionRepository } from "../lib/agentSessions";
import { useRevertTurn } from "../hooks/useRevertTurn";
import { UNTITLED_SESSION } from "../lib/sessionTitle";

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
import { makeApprovalCard } from "../components/agents/ToolApprovalCard";
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
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null);
  const [revertingMessageId, setRevertingMessageId] = useState<string | null>(null);
  // A model picked on the hero view has nowhere to live until a session exists, so
  // it is held here and applied to the session `ensureSession` creates.
  const [pendingModel, setPendingModel] = useState("");

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
  const revertTurn = useRevertTurn();

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
    declinePending, // eslint-disable-line @typescript-eslint/no-unused-vars -- only used by the disabled StatusDrawer
    skipPending,
    stopAgentRun,
    submitAnswer,
    chainNodes,
    stepCount,
    maxSteps,
    activeSubagent,
    pendingToolCall,
  } = useAgentExecution(targetSessionId);

  const sessionState = targetSessionId ? sessions[targetSessionId] || CONST_DEFAULT_SESSION_STATE : CONST_DEFAULT_SESSION_STATE;
  const isThinking = status === "planning" || status === "executing";

  const selectedModel = sessionState.model || pendingModel;

  // Keyed by the message that was actually clicked, so copying a user message
  // never ticks the agent's reply (they are separate clipboard actions).
  const copyMessage = useCallback((messageId: string | undefined, content: string) => {
    if (!messageId) return;
    navigator.clipboard.writeText(content);
    setCopiedStates((prev) => ({ ...prev, [messageId]: true }));
    setTimeout(() => setCopiedStates((prev) => ({ ...prev, [messageId]: false })), 2000);
  }, []);

  const handleRevertTurn = useCallback(
    async (userMessageId: string) => {
      if (!targetSessionId || isThinking) return;
      setRevertingMessageId(userMessageId);
      try {
        await revertTurn(targetSessionId, userMessageId);
      } finally {
        setRevertingMessageId(null);
      }
    },
    [targetSessionId, isThinking, revertTurn],
  );

  // Duration timer — derived from the store's `startedAt` so it survives
  // remounting when the window loses focus (otherwise it resets to 0).
  const [durationSecs, setDurationSecs] = useState<number>(0);
  const timerRef = useRef<any>(null);
  const startedAt = useAgentStore((s) => s.sessions[targetSessionId || ""]?.startedAt);

  useEffect(() => {
    const base = startedAt ?? Date.now();
    if (status === "planning" || status === "executing") {
      setDurationSecs(Math.round((Date.now() - base) / 1000));
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        setDurationSecs(Math.round((Date.now() - (startedAt ?? Date.now())) / 1000));
      }, 1000);
    } else if (status === "completed" || status === "error") {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      const totalMs = queue.reduce((acc, cmd) => acc + (cmd.durationMs || 0), 0);
      setDurationSecs(totalMs > 0 ? Math.round(totalMs / 1000) : Math.round((Date.now() - base) / 1000));
    } else if (status === "idle") {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      setDurationSecs(0);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [status, queue, startedAt]);

  // A model picked on the hero view has nowhere to live until a session exists, so
  // it is held here and applied to the session `ensureSession` creates.
  const handleModelChange = useCallback((model: string) => {
    if (targetSessionId) {
      useAgentStore.getState().setAgentModel(targetSessionId, model);
    } else {
      setPendingModel(model);
    }
  }, [targetSessionId]);

  // The agent view starts with no session at all. This materializes one at the
  // moment a message is actually sent, so opening the app or clicking "New
  // Session" never leaves empty rows in history.
  const ensureSession = useCallback(() => {
    if (targetSessionId) return targetSessionId;
    const sessionId = useAgentStore.getState().createAgentSession();
    if (pendingModel) {
      useAgentStore.getState().setAgentModel(sessionId, pendingModel);
    }
    return sessionId;
  }, [targetSessionId, pendingModel]);

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isThinking) return;

    setInput("");
    setAttachedFiles([]);

    if (sessionState.pendingToolCall?.name === "ask_user") {
      submitAnswer(trimmed);
      return;
    }

    // Slash-command dispatch (/skills /mcp /btw /file)
    const slash = await resolveSlashCommand(trimmed, {
      cwd: useAppShellStore.getState().projectDir || useAppShellStore.getState().cwdAbsolute,
      sessionId: targetSessionId,
      model: selectedModel,
      isTaskRunning: isThinking,
    });
    if (slash.handled) {
      if (slash.assistantMessage) {
        const sessionId = ensureSession();
        const store = useAgentStore.getState();
        store.addChatMessage(sessionId, { role: "user", content: trimmed, agentType: "developer" });
        store.addChatMessage(sessionId, { role: "assistant", content: slash.assistantMessage, agentType: "developer" });
      } else if (slash.goal) {
        startTask(slash.goal, "developer", selectedModel, ensureSession());
      }
      return;
    }

    let finalPrompt = trimmed;
    if (attachedFiles.length > 0) {
      const fileContentsBlock = attachedFiles
        .map((f) => `### File: ${f.name} (${f.path})\n\`\`\`\n${f.content}\n\`\`\``)
        .join("\n\n");
      finalPrompt = `${trimmed}\n\nHere are some relevant files to reference:\n\n${fileContentsBlock}`;
    }

    startTask(finalPrompt, "developer", selectedModel, ensureSession());
  }, [input, isThinking, attachedFiles, startTask, selectedModel, sessionState.pendingToolCall, submitAnswer, targetSessionId, ensureSession]);

  const handleHeroSend = useCallback(async (text: string, files?: AttachedFile[]) => {
    if (isThinking) return;
    useAppShellStore.getState().setViewMode("agent");

    const slash = await resolveSlashCommand(text, {
      cwd: useAppShellStore.getState().projectDir || useAppShellStore.getState().cwdAbsolute,
      sessionId: targetSessionId,
      model: selectedModel,
      isTaskRunning: isThinking,
    });
    if (slash.handled) {
      if (slash.assistantMessage) {
        const sessionId = ensureSession();
        const store = useAgentStore.getState();
        store.addChatMessage(sessionId, { role: "user", content: text, agentType: "developer" });
        store.addChatMessage(sessionId, { role: "assistant", content: slash.assistantMessage, agentType: "developer" });
      } else if (slash.goal) {
        startTask(slash.goal, "developer", selectedModel, ensureSession());
      }
      return;
    }

    let finalPrompt = text;
    if (files && files.length > 0) {
      const fileContentsBlock = files
        .map((f) => `### File: ${f.name} (${f.path})\n\`\`\`\n${f.content}\n\`\`\``)
        .join("\n\n");
      finalPrompt = `${text}\n\nHere are some relevant files to reference:\n\n${fileContentsBlock}`;
    }

    startTask(finalPrompt, "developer", selectedModel, ensureSession());
  }, [isThinking, startTask, selectedModel, targetSessionId, ensureSession]);

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

  const handleRename = (id: string, title: string) => {
    renameAgentSession(id, title);
    void agentSessionRepository.rename(id, title).catch(console.warn);
  };

  // Save session title rename
  const saveRename = () => {
    if (targetSessionId && tempTitle.trim()) {
      handleRename(targetSessionId, tempTitle.trim());
    }
    setIsEditingTitle(false);
  };

  // "New Session" is only the empty state — clearing the active id renders the hero
  // view. The session record itself is created by `ensureSession` when a message
  // is actually sent.
  const handleNewSession = () => {
    setActiveAgentSessionId(null);
  };

  // Every agent-view session has a title (a random placeholder at worst), so the
  // sidebar list needs no extra filter.
  const agentSessions = Object.entries(sessions)
    .filter(([_, s]) => s.isAgentViewSession)
    .map(([id, s]) => ({
      id,
      title: s.title,
      isNaming: s.titlePending === true,
      // Grouped by creation time: `updatedAt` moves with run progress and would
      // reshuffle the list on every reload.
      updatedAt: s.createdAt ?? s.updatedAt ?? 0,
    }));

  // Deleting a session drops its transcript for good, so it is always confirmed.
  const requestDelete = (id: string) => {
    setPendingDelete({ id, title: sessions[id]?.title ?? "this session" });
  };

  const confirmDelete = useCallback(() => {
    if (!pendingDelete) return;
    const { id } = pendingDelete;
    setPendingDelete(null);

    deleteAgentSession(id);
    void agentSessionRepository.remove(id).catch(console.warn);
    // The sidecar thread is a derived cache, but leaving it behind would let a
    // re-used id inherit stale LLM context.
    void system.agentClearThread(id);
  }, [pendingDelete, deleteAgentSession]);

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
            deleteAgentSession={requestDelete}
            renameAgentSession={handleRename}
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
                    <span>{sessionState.title || UNTITLED_SESSION}</span>
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
                        setTempTitle(sessionState.title || UNTITLED_SESSION);
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
                sessionName={sessionState.title || UNTITLED_SESSION}
                hasSession={targetSessionId !== null}
                onNewSession={handleNewSession}
                onRenameSession={(newTitle) =>
                  targetSessionId && handleRename(targetSessionId, newTitle)
                }
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
                          durationSecs={durationSecs}
                          stepCount={isLastTurn ? stepCount : 0}
                          maxSteps={isLastTurn ? maxSteps : 0}
                          variant="full"
                          copied={!!copiedStates[turn.assistant?.id || ""]}
                          onCopy={(content) => copyMessage(turn.assistant?.id, content)}
                          copiedUser={!!copiedStates[turn.user?.id || ""]}
                          onCopyUser={(content) => copyMessage(turn.user?.id, content)}
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
                          onRetry={retryTask}
                          onRevert={
                            turn.user && !isThinking
                              ? () => handleRevertTurn(turn.user!.id)
                              : undefined
                          }
                          isReverting={revertingMessageId === turn.user?.id}
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
                    {/* Approval cards (command / file write / patch / question) */}
                    {makeApprovalCard({
                      isPaused: status === "paused",
                      pendingToolCall,
                      pendingApprovalCmd: (function () {
                        const pendingCmd = queue.find((c) => c.status === "requires_action");
                        return pendingCmd
                          ? { command: pendingCmd.command, explanation: pendingCmd.explanation }
                          : null;
                      })(),
                      pendingAsk:
                        status === "paused" && pendingToolCall?.name === "ask_user"
                          ? {
                              question:
                                pendingToolCall.args?.question || "The agent has a clarifying question.",
                            }
                          : null,
                      onApprove: approveAndRunPending,
                      onSkip: skipPending,
                      onSubmit: submitAnswer,
                      className: "mb-3",
                    })}

                    {/* Status Drawer inside Input container
                    Disabled for now: the files-changed / commands / artifacts panel
                    above the input bar is not wanted in this build.
                    {targetSessionId && showStatusDrawer && (
                      <StatusDrawer
                        sessionId={targetSessionId}
                        onApprove={approveAndRunPending}
                        onDecline={declinePending}
                        onSkip={skipPending}
                        onSubmitAnswer={submitAnswer}
                      />
                    )} */}

                    {/* Prompt Input Form */}
                    <AgentPromptInput
                      value={input}
                      onValueChange={setInput}
                      onSubmit={handleSend}
                      isLoading={isThinking}
                      onStop={stopAgentRun}
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
    <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete session?"
        description={`"${pendingDelete?.title ?? ""}" and its entire transcript will be permanently deleted. This cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />

    </FileUpload>
  );
}

export default AgentView;
