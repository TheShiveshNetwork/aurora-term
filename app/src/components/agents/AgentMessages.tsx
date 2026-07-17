import { useState, useEffect } from "react";
import { Check, Copy, ThumbsUp, ThumbsDown, ChevronRight, RotateCcw } from "lucide-react";
import type { ChatMessage, ChainNode } from "../../stores/useAgentStore";
import { Markdown } from "../prompt-kit/markdown";
import {
  MessageContent,
  MessageActions,
  MessageAction,
} from "../prompt-kit/message";
import { AgentChainOfThought } from "./AgentChainOfThought";
import { AgentStepsLogs } from "./AgentStepsLogs";
import { TextShimmer } from "../prompt-kit/text-shimmer";

// ── Animated Farming Icon ──────────────────────────────────────────────────

export function SproutFarmingIcon() {
  return (
    <div className="relative w-5 h-5 flex items-center justify-center shrink-0">
      {/* floating particles */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <span className="absolute w-[2px] h-[2px] bg-amber-400 rounded-full left-[18%] bottom-[28%] animate-[floatUp_1.6s_ease-out_infinite]" />
        <span className="absolute w-[2.5px] h-[2.5px] bg-amber-300 rounded-full left-[72%] bottom-[18%] animate-[floatUp_2.1s_ease-out_infinite_0.4s]" />
        <span className="absolute w-[1.5px] h-[1.5px] bg-amber-400 rounded-full left-[48%] bottom-[38%] animate-[floatUp_1.9s_ease-out_infinite_0.9s]" />
        <span className="absolute w-[2px] h-[2px] bg-amber-300 rounded-full left-[35%] bottom-[15%] animate-[floatUp_1.7s_ease-out_infinite_1.3s]" />
      </div>

      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="w-4 h-4 text-amber-400 origin-bottom animate-[sway_2.5s_ease-in-out_infinite]"
      >
        {/* ground line */}
        <path d="M4 20h16" className="opacity-40" strokeWidth="2" />

        {/* stem, gently curved, with a subtle grow pulse */}
        <path
          d="M12 20V9c0-1 .4-1.8 1.2-2.6"
          className="origin-bottom animate-[grow_2.5s_ease-in-out_infinite]"
        />

        {/* left leaf (teardrop shape) */}
        <path
          d="M12 13c-3.5.2-5.5-1.6-6-4.5 3.6-.7 6.2 1 6.6 3.8.1.4.1.5-.6.7Z"
          fill="currentColor"
          fillOpacity="0.25"
          strokeWidth="1.5"
        />

        {/* right leaf, higher up, mirrored */}
        <path
          d="M13.4 9.4c3.3-1 5.7.2 6.6 3-3.3 1.4-6.2.2-7-2.4-.1-.4-.1-.5.4-.6Z"
          fill="currentColor"
          fillOpacity="0.25"
          strokeWidth="1.5"
        />

        {/* sprout tip */}
        <path
          d="M13.2 6.4c.3-1.4 1.4-2.3 2.8-2.4-.1 1.5-1 2.6-2.5 2.9-.3.1-.4 0-.3-.5Z"
          fill="currentColor"
          fillOpacity="0.35"
          strokeWidth="1.4"
        />
      </svg>
    </div>
  );
}

// ── User Message Bubble ───────────────────────────────────────────────────

export interface UserMessageProps {
  content: string;
  className?: string;
  overlay?: boolean;
}

export function UserMessage({ content, className, overlay }: UserMessageProps) {
  if (overlay) {
    return (
      <div className={`w-full max-w-[200px] self-end ${className ?? ""}`}>
        <div className="rounded-[14px] px-4 py-3 text-[13px] font-medium leading-relaxed select-text bg-on-surface-variant/20 border border-outline text-on-surface">
          {content}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col items-end max-w-[70%] min-w-0 ${className ?? ""}`}>
      <MessageContent className="w-full min-w-0 bg-on-surface-variant/20 border border-outline text-on-surface rounded-2xl px-4 py-3 text-[14px] leading-relaxed break-words">
        {content}
      </MessageContent>
    </div>
  );
}

// ── Agent Response Message ────────────────────────────────────────────────

export interface AgentResponseMessageProps {
  msg: ChatMessage;
  onCopy?: (content: string) => void;
  copied?: boolean;
  onLike?: () => void;
  onDislike?: () => void;
  className?: string;
}

export function AgentResponseMessage({
  msg,
  onCopy,
  copied,
  onLike,
  onDislike,
  className,
}: AgentResponseMessageProps) {
  return (
    <div className={`flex flex-col items-start w-full min-w-0 space-y-2 ${className ?? ""}`}>
      {msg.chainNodes && msg.chainNodes.length > 0 && (
        <div className="w-full space-y-2">
          <AgentChainOfThought nodes={msg.chainNodes} />

          {msg.agentLogs && msg.agentLogs.length > 0 && (
            <AgentStepsLogs logs={msg.agentLogs} />
          )}
        </div>
      )}

      <div
        className={`w-full min-w-0 rounded-2xl px-0 py-3 text-[13px] leading-relaxed break-words select-text ${msg.isError ? "text-red-400" : "text-on-surface/90"
          }`}
      >
        <Markdown className="prose prose-sm dark:prose-invert max-w-none">
          {msg.content}
        </Markdown>
      </div>

      {(onCopy || onLike || onDislike) && (
        <MessageActions className="w-full flex items-center justify-end gap-3 text-on-surface-variant/40 px-1">
          {msg.durationMs !== undefined && msg.durationMs > 0 && (
            <span className="text-[10px] text-on-surface-variant/30">
              Worked for {Math.round(msg.durationMs / 1000)}s
            </span>
          )}
          {onCopy && (
            <MessageAction tooltip="Copy response">
              <button
                onClick={() => onCopy(msg.content)}
                className="hover:text-on-surface/80 transition-colors cursor-pointer p-0.5"
              >
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              </button>
            </MessageAction>
          )}
          {onLike && (
            <MessageAction tooltip="Like response">
              <button
                onClick={onLike}
                className="hover:text-on-surface/80 transition-colors cursor-pointer p-0.5"
              >
                <ThumbsUp className="size-4" />
              </button>
            </MessageAction>
          )}
          {onDislike && (
            <MessageAction tooltip="Dislike response">
              <button
                onClick={onDislike}
                className="hover:text-on-surface/80 transition-colors cursor-pointer p-0.5"
              >
                <ThumbsDown className="size-4" />
              </button>
            </MessageAction>
          )}
        </MessageActions>
      )}
    </div>
  );
}

// ── Agent Turn Message ─────────────────────────────────────────────────────

export interface AgentTurnMessageProps {
  userMsg: ChatMessage;
  assistantMsg: ChatMessage | null;
  isThinking: boolean;
  isLastTurn: boolean;
  chainNodes: ChainNode[];
  durationSecs: number;
  stepCount: number;
  maxSteps: number;
  onCopy?: (content: string) => void;
  copied?: boolean;
  onLike?: () => void;
  onDislike?: () => void;
  onRetry?: () => void;
  variant?: "overlay" | "full";
  className?: string;
}

export function AgentTurnMessage({
  userMsg,
  assistantMsg,
  isThinking,
  isLastTurn,
  chainNodes,
  durationSecs,
  stepCount,
  maxSteps,
  onCopy,
  copied,
  onLike,
  onDislike,
  onRetry,
  variant = "overlay",
  className,
}: AgentTurnMessageProps) {
  const [detailsOpen, setDetailsOpen] = useState(isThinking);

  useEffect(() => {
    setDetailsOpen(isThinking);
  }, [isThinking]);

  const hasDetails = isThinking || chainNodes.length > 0 || (assistantMsg?.durationMs !== undefined && assistantMsg.durationMs > 0);
  const durationMs = assistantMsg?.durationMs;
  const durationLabel = durationMs !== undefined && durationMs > 0
    ? Math.round(durationMs / 1000)
    : durationSecs;

  const isOverlay = variant === "overlay";

  return (
    <div className={`flex flex-col ${className ?? ""}`}>
      {/* User message */}
      {isOverlay ? (
        <div className="sticky flex w-full justify-end self-end top-0 z-10 pb-2">
          <UserMessage content={userMsg.content} className="max-w-full" overlay />
        </div>
      ) : (
        <div className="flex justify-end pb-1">
          <UserMessage content={userMsg.content} />
        </div>
      )}

      {/* Response area */}
      <div className="flex flex-col gap-2 pb-4">
        {/* Steps header — farming or worked for */}
        {hasDetails && (
          <div className="space-y-1.5 mt-1">
            <div
              onClick={() => setDetailsOpen((v) => !v)}
              className="flex items-center gap-2 cursor-pointer select-none group"
            >
              <div className="flex items-center gap-2 text-[11px] text-on-surface-variant/50 group-hover:text-on-surface-variant/70 transition-colors">
                {isThinking ? (
                  <div className="flex items-center gap-2">
                    <SproutFarmingIcon />
                    <TextShimmer
                      duration={3}
                      spread={3}
                      className="text-[11px] font-semibold text-transparent"
                      style={{
                        backgroundImage:
                          "linear-gradient(to right, rgba(251,191,36,0.4) 47%, rgba(251,191,36,0.9) 50%, rgba(251,191,36,0.4) 53%)",
                      }}
                    >
                      Farming…
                    </TextShimmer>
                  </div>
                ) : (
                  <span className="font-medium text-on-surface-variant/70">
                    Worked for {durationLabel}s
                  </span>
                )}
              </div>
              {chainNodes.length > 0 && (
                <ChevronRight
                  size={11}
                  className={`text-on-surface-variant/70 transition-transform duration-200 ${detailsOpen ? "rotate-90" : ""}`}
                />
              )}
            </div>

            {/* Collapsible chain of thought */}
            {detailsOpen && chainNodes.length > 0 && (
              <div className="py-2 space-y-3 border-l border-outline-variant/15 ml-3 text-[11px] text-on-surface-variant/80 leading-normal animate-fadeIn">
                <AgentChainOfThought nodes={chainNodes} />
              </div>
            )}
          </div>
        )}

        {/* AI response content */}
        {assistantMsg && (
          <div className="space-y-2 mt-1">
            <div
              className={`w-full min-w-0 text-[12.5px] leading-relaxed break-words select-text ${assistantMsg.isError ? "text-red-400" : "text-on-surface/90"
                }`}
            >
              <Markdown className="prose prose-sm dark:prose-invert max-w-none">
                {assistantMsg.content}
              </Markdown>
            </div>

            {/* Action bar — copy, like, dislike */}
            <div className="flex items-center justify-end gap-3 text-on-surface-variant/80">
              {onCopy && (
                <button
                  onClick={() => onCopy(assistantMsg.content)}
                  className="hover:text-on-surface/70 p-1 rounded transition-colors cursor-pointer"
                  title="Copy Response"
                >
                  {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                </button>
              )}
              {onLike && (
                <button
                  onClick={onLike}
                  className="hover:text-on-surface/70 p-1 rounded transition-colors cursor-pointer"
                  title="Like Response"
                >
                  <ThumbsUp size={12} />
                </button>
              )}
              {onDislike && (
                <button
                  onClick={onDislike}
                  className="hover:text-on-surface/70 p-1 rounded transition-colors cursor-pointer"
                  title="Dislike Response"
                >
                  <ThumbsDown size={12} />
                </button>
              )}
            </div>

            {/* Retry button for errors */}
            {isLastTurn && assistantMsg.isError && onRetry && (
              <div className="flex gap-2 pt-1">
                <button
                  onClick={onRetry}
                  className="flex-1 flex items-center justify-center gap-1.5 text-[10px] font-bold py-1.5 px-3 rounded-[10px] transition-all cursor-pointer"
                  style={{
                    background: "rgba(79,140,255,0.10)",
                    border: "1px solid rgba(79,140,255,0.20)",
                    color: "#4F8CFF",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(79,140,255,0.16)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(79,140,255,0.10)")}
                >
                  <RotateCcw size={11} />
                  Retry
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
