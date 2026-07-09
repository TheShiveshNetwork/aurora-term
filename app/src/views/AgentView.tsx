import { useState, useRef, useEffect, useCallback } from "react";
import { Command, Send, Terminal, RotateCcw, Paperclip, Plus, Check, Copy, X } from "lucide-react";
import { useAgentStore, CONST_DEFAULT_SESSION_STATE } from "../stores/useAgentStore";
import { useAppShellStore } from "../stores/useAppShellStore";
import { useAgentExecution } from "../hooks/useAgentExecution";
import { AgentHeroView } from "../components/terminal/AgentHeroView";
import { StatusDrawer } from "../components/terminal/StatusDrawer";
import { system } from "../lib/ipc";

// Import prompt-kit components
import {
  ChatContainerRoot,
  ChatContainerContent,
  ChatContainerScrollAnchor,
} from "../components/prompt-kit/chat-container";
import { ScrollButton } from "../components/prompt-kit/scroll-button";
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageActions,
  MessageAction,
} from "../components/prompt-kit/message";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputActions,
  PromptInputAction,
} from "../components/prompt-kit/prompt-input";
import {
  ChainOfThought,
  ChainOfThoughtStep,
  ChainOfThoughtTrigger,
  ChainOfThoughtContent,
  ChainOfThoughtItem,
} from "../components/prompt-kit/chain-of-thought";
import {
  Steps,
  StepsItem,
  StepsTrigger,
  StepsContent,
} from "../components/prompt-kit/steps";
import { TextShimmer } from "../components/prompt-kit/text-shimmer";
import { FileUpload, FileUploadContent } from "../components/prompt-kit/file-upload";

interface AttachedFile {
  name: string;
  path: string;
  content: string;
}

const AGENT_VIEW_SESSION_ID = "agent-view";

export function AgentView() {
  const [input, setInput] = useState("");
  const [copiedStates, setCopiedStates] = useState<Record<string, boolean>>({});
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sessions = useAgentStore((s) => s.sessions);
  const setAgentMode = useAgentStore((s) => s.setAgentMode);

  const targetSessionId = AGENT_VIEW_SESSION_ID;

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
    agentLogs,
    activeSubagent,
  } = useAgentExecution(targetSessionId);

  const sessionState = targetSessionId ? sessions[targetSessionId] || CONST_DEFAULT_SESSION_STATE : CONST_DEFAULT_SESSION_STATE;
  const isThinking = status === "planning" || status === "executing";
  const isThinkingOrPaused = isThinking || status === "paused";

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || isThinking) return;

    let finalPrompt = trimmed;
    if (attachedFiles.length > 0) {
      const fileContentsBlock = attachedFiles
        .map((f) => `### File: ${f.name} (${f.path})\n\`\`\`\n${f.content}\n\`\`\``)
        .join("\n\n");
      finalPrompt = `${trimmed}\n\nHere are some relevant files to reference:\n\n${fileContentsBlock}`;
    }

    setInput("");
    setAttachedFiles([]);
    startTask(finalPrompt, "developer");
  }, [input, isThinking, attachedFiles, startTask]);

  const handleHeroSend = useCallback((text: string) => {
    if (isThinking) return;
    useAppShellStore.getState().setViewMode("agent");
    startTask(text, "developer");
  }, [isThinking, startTask]);

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

  return (
    <FileUpload onFilesAdded={handleFilesAdded}>
      <FileUploadContent className="bg-background/80 fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm">
        <div className="border border-outline bg-surface-container-high/90 p-8 rounded-2xl flex flex-col items-center gap-3 max-w-sm text-center shadow-2xl">
          <Paperclip className="h-8 w-8 text-primary animate-pulse" />
          <h3 className="font-semibold text-sm text-on-surface">Add files to Agent Context</h3>
          <p className="text-xs text-on-surface-variant/70">Release your mouse button to attach files to your next message.</p>
        </div>
      </FileUploadContent>

      <div className="flex flex-col h-full bg-background overflow-hidden relative">
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

        {showEmptyState ? (
          <AgentHeroView onSend={handleHeroSend} />
        ) : (
          <ChatContainerRoot className="flex-1 overflow-y-auto scrollbar-thin">
            <ChatContainerContent className="max-w-[800px] w-full mx-auto px-5 py-6 space-y-6">
              {chatHistory.map((msg, idx) => {
                const isUser = msg.role === "user";
                if (isUser) {
                  const assistant = chatHistory[idx + 1]?.role === "assistant" ? chatHistory[idx + 1] : null;
                  return (
                    <div key={msg.id} className="w-full space-y-4">
                      {/* User Message */}
                      <Message className="justify-end flex-row-reverse items-start">
                        <MessageAvatar src="" alt="User" fallback="U" />
                        <div className="flex flex-col items-end max-w-[70%]">
                          <MessageContent className="bg-[#272B36] text-[rgba(255,255,255,0.9)] rounded-2xl px-4 py-3 text-[14px] leading-relaxed">
                            {msg.content}
                          </MessageContent>
                        </div>
                      </Message>

                      {/* Assistant Response */}
                      {assistant && (
                        <Message className="justify-start items-start">
                          <MessageAvatar src="" alt="Agent" fallback="A" className="bg-[#3A43EE]/10 text-[#4F8CFF]" />
                          <div className="flex flex-col items-start w-full max-w-[85%] space-y-2">
                            <MessageContent markdown className="bg-[#0F131A] border border-outline text-[rgba(232,234,240,0.9)] rounded-2xl px-4 py-3 text-[13px] leading-relaxed w-full">
                              {assistant.content}
                            </MessageContent>

                            <MessageActions className="w-full flex items-center justify-end gap-3 text-[rgba(232,234,240,0.4)] px-1">
                              {assistant.durationMs !== undefined && assistant.durationMs > 0 && (
                                <span className="text-[10px] text-[rgba(232,234,240,0.3)]">
                                  Worked for {Math.round(assistant.durationMs / 1000)}s
                                </span>
                              )}
                              <MessageAction tooltip="Copy response">
                                <button
                                  onClick={() => {
                                    navigator.clipboard.writeText(assistant.content);
                                    setCopiedStates((p) => ({ ...p, [assistant.id]: true }));
                                    setTimeout(() => setCopiedStates((p) => ({ ...p, [assistant.id]: false })), 2000);
                                  }}
                                  className="hover:text-[rgba(232,234,240,0.8)] transition-colors cursor-pointer p-0.5"
                                >
                                  {copiedStates[assistant.id] ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                                </button>
                              </MessageAction>
                            </MessageActions>
                          </div>
                        </Message>
                      )}
                    </div>
                  );
                }
                if (msg.role === "assistant" && chatHistory[idx - 1]?.role === "user") return null;
                return null;
              })}

              {/* Shimmer Response State */}
              {isThinking && (
                <div className="flex items-center gap-2 py-2 w-full animate-fadeIn">
                  <TextShimmer className="text-xs text-white/50">
                    Farming response and running commands...
                  </TextShimmer>
                </div>
              )}

              {/* Detailed reasoning, chain of thought, execution logs */}
              {isThinkingOrPaused && (
                <div className="w-full space-y-4 border-t border-white/[0.03] bg-white/[0.01] p-4 rounded-2xl mt-4">
                  {activeSubagent && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-white/50">Active Agent:</span>
                      <span className="text-xs font-bold text-primary bg-primary/10 border border-primary/20 px-2 py-0.5 rounded-full">
                        {activeSubagent}
                      </span>
                    </div>
                  )}

                  {chainNodes.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-xs font-bold text-white/40 uppercase tracking-wider">Plan & Chain of Thought</div>
                      <ChainOfThought className="border border-white/[0.04] p-3 rounded-xl bg-black/10">
                        {chainNodes.map((node, i) => (
                          <ChainOfThoughtStep key={node.id} isLast={i === chainNodes.length - 1} open={node.status === "active" || node.status === "pending"}>
                            <ChainOfThoughtTrigger
                              leftIcon={
                                node.status === "active" ? (
                                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-ping" />
                                ) : node.status === "done" ? (
                                  <Check size={11} className="text-emerald-400" />
                                ) : node.status === "failed" ? (
                                  <X size={11} className="text-red-400" />
                                ) : (
                                  <span className="h-1.5 w-1.5 rounded-full bg-white/20" />
                                )
                              }
                            >
                              <span className="font-semibold text-xs text-white/80">{node.label}</span>
                            </ChainOfThoughtTrigger>
                            <ChainOfThoughtContent>
                              <ChainOfThoughtItem className="pl-6 pb-2 text-xs text-white/60">
                                {node.subLabel && <p className="mb-1">{node.subLabel}</p>}
                                {node.command && (
                                  <code className="block font-mono text-[10px] p-2 bg-black/40 rounded border border-white/[0.04] text-white/80 break-all select-text mt-1">
                                    {node.command}
                                  </code>
                                )}
                              </ChainOfThoughtItem>
                            </ChainOfThoughtContent>
                          </ChainOfThoughtStep>
                        ))}
                      </ChainOfThought>
                    </div>
                  )}

                  {agentLogs.length > 0 && (
                    <div className="space-y-2">
                      <Steps className="border border-white/[0.04] rounded-xl bg-black/10">
                        <StepsTrigger className="px-3 py-2 text-xs font-semibold text-white/80">
                          Execution Logs ({agentLogs.length})
                        </StepsTrigger>
                        <StepsContent className="px-3 pb-3">
                          <div className="space-y-1 max-h-40 overflow-y-auto scrollbar-thin pr-1">
                            {agentLogs.map((log, i) => (
                              <StepsItem key={i} className="font-mono text-[10.5px] leading-relaxed text-white/50 break-all">
                                <span className="text-white/25 mr-1.5">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                                <span>{log.content}</span>
                              </StepsItem>
                            ))}
                          </div>
                        </StepsContent>
                      </Steps>
                    </div>
                  )}
                </div>
              )}
            </ChatContainerContent>

            <ChatContainerScrollAnchor />
            <ScrollButton className="fixed bottom-24 right-8 z-30" />
          </ChatContainerRoot>
        )}

        {/* Input Area */}
        <div className="shrink-0 pt-3 pb-6 px-5 w-full">
          <div className="max-w-[800px] mx-auto w-full flex flex-col">
            
            {/* Status Drawer inside Input container */}
            {targetSessionId && (
              <div className="border-b border-white/[0.04] bg-[#0c0e17]/80 backdrop-blur-md rounded-t-2xl overflow-hidden shadow-md">
                <StatusDrawer
                  sessionId={targetSessionId}
                  onApprove={approveAndRunPending}
                  onDecline={declinePending}
                  onSkip={skipPending}
                  onSubmitAnswer={submitAnswer}
                />
              </div>
            )}

            {/* Prompt Input Form */}
            <div className="w-full bg-[#131722] border border-outline-variant/10 rounded-b-2xl shadow-xl overflow-hidden">
              
              {/* Attached Files List */}
              {attachedFiles.length > 0 && (
                <div className="flex flex-wrap gap-2 px-4 py-2 bg-white/[0.01] border-b border-white/[0.04] items-center">
                  {attachedFiles.map((file, idx) => (
                    <div key={idx} className="flex items-center gap-1.5 bg-white/[0.05] border border-white/[0.05] rounded-full pl-2.5 pr-1.5 py-1 text-xs text-white/80">
                      <Paperclip size={11} className="text-primary/70" />
                      <span className="max-w-[150px] truncate">{file.name}</span>
                      <button
                        onClick={() => setAttachedFiles(prev => prev.filter((_, i) => i !== idx))}
                        className="p-0.5 rounded-full hover:bg-white/10 text-white/40 hover:text-white/80 transition-colors cursor-pointer"
                      >
                        <X size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Mode Selector & Input text */}
              <PromptInput
                isLoading={isThinking}
                value={input}
                onValueChange={setInput}
                onSubmit={handleSend}
                disabled={isThinking}
                className="bg-transparent border-none p-4"
              >
                <PromptInputTextarea
                  placeholder="Ask the developer agent to build, modify, or debug..."
                  className="text-[14px] text-on-background placeholder:text-white/20 min-h-[44px] focus-visible:ring-0 focus-visible:ring-offset-0"
                />
                
                <PromptInputActions className="justify-between mt-3 pt-3 border-t border-white/[0.03]">
                  <div className="flex items-center gap-1">
                    <PromptInputAction tooltip="Attach file from dialog">
                      <button
                        onClick={handleAttachFileClick}
                        disabled={isThinking}
                        className="p-2 rounded-lg text-white/40 hover:text-white/70 hover:bg-white/[0.05] transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <Paperclip size={14} />
                      </button>
                    </PromptInputAction>
                    
                    {/* Mode Selector Header */}
                    <div className="flex items-center gap-1 ml-2">
                      <button
                        onClick={() => targetSessionId && setAgentMode(targetSessionId, "plan")}
                        className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-all cursor-pointer ${
                          sessionState.agentMode === "plan"
                            ? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                            : "text-white/30 border border-transparent"
                        }`}
                      >
                        Plan Mode
                      </button>
                      <button
                        onClick={() => targetSessionId && setAgentMode(targetSessionId, "build")}
                        className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-all cursor-pointer ${
                          sessionState.agentMode === "build"
                            ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                            : "text-white/30 border border-transparent"
                        }`}
                      >
                        Build Mode
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <PromptInputAction tooltip="Send to Agent">
                      <button
                        onClick={handleSend}
                        disabled={!input.trim() || isThinking}
                        className="flex items-center justify-center w-8 h-8 bg-[#4F8CFF] border-none rounded-lg cursor-pointer transition-all hover:bg-primary-fixed-dim disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <Send size={13} className="text-white" />
                      </button>
                    </PromptInputAction>
                  </div>
                </PromptInputActions>
              </PromptInput>
            </div>
          </div>
        </div>
      </div>
    </FileUpload>
  );
}

export default AgentView;
