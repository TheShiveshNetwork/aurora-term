import { useState, useRef, useEffect, useCallback } from "react";
import { Command, Send, Terminal, RotateCcw, Paperclip, Plus, Check, Copy } from "lucide-react";
import { useAgentStore, CONST_DEFAULT_SESSION_STATE } from "../stores/useAgentStore";
import { useSessionStore } from "../stores/useSessionStore";
import { useAppShellStore } from "../stores/useAppShellStore";
import { useAgentExecution } from "../hooks/useAgentExecution";
import { AgentHeroView } from "../components/terminal/AgentHeroView";

function renderInline(text: string): React.ReactNode {
  const tokens = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`\n]+`)/g);
  return tokens.map((tok, i) => {
    if (tok.startsWith("**") && tok.endsWith("**")) {
      return <strong key={i} className="font-semibold text-on-surface">{tok.slice(2, -2)}</strong>;
    }
    if (tok.startsWith("*") && tok.endsWith("*") && tok.length > 2) {
      return <em key={i}>{tok.slice(1, -1)}</em>;
    }
    if (tok.startsWith("`") && tok.endsWith("`") && tok.length > 2) {
      return (
        <code key={i} className="px-1.5 py-0.5 mx-0.5 bg-surface-variant/40 rounded text-[10.5px] font-mono border border-outline-variant/10 text-on-surface/90 font-medium">
          {tok.slice(1, -1)}
        </code>
      );
    }
    return tok || null;
  });
}

function renderMarkdown(text: string | null): React.ReactNode {
  if (!text) return null;
  try {
    const lines = text.split(/\r?\n/);
    const elements: React.ReactNode[] = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      if (line.trimStart().startsWith("```")) {
        const codeLines: string[] = [];
        i++;
        while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
          codeLines.push(lines[i]);
          i++;
        }
        elements.push(
          <pre key={`cb-${i}`} className="my-2.5 p-3 bg-surface-variant/20 rounded-xl overflow-x-auto text-[11px] font-mono border border-outline-variant/10 text-on-surface/90 leading-relaxed whitespace-pre-wrap break-all">
            <code>{codeLines.join("\n").trim()}</code>
          </pre>
        );
        i++;
        continue;
      }

      const h3 = /^### (.+)/.exec(line);
      if (h3) {
        elements.push(<p key={`h3-${i}`} className="text-[12px] font-bold text-on-surface mt-2 mb-0.5">{renderInline(h3[1])}</p>);
        i++; continue;
      }
      const h2 = /^## (.+)/.exec(line);
      if (h2) {
        elements.push(<p key={`h2-${i}`} className="text-[13px] font-bold text-on-surface mt-2.5 mb-1">{renderInline(h2[1])}</p>);
        i++; continue;
      }
      const h1 = /^# (.+)/.exec(line);
      if (h1) {
        elements.push(<p key={`h1-${i}`} className="text-[14px] font-bold text-on-surface mt-3 mb-1">{renderInline(h1[1])}</p>);
        i++; continue;
      }

      if (/^[-*] /.test(line)) {
        const items: string[] = [];
        while (i < lines.length && /^[-*] /.test(lines[i])) {
          items.push(lines[i].slice(2));
          i++;
        }
        elements.push(
          <ul key={`ul-${i}`} className="my-1.5 pl-4 space-y-0.5 list-disc list-outside">
            {items.map((item, j) => (
              <li key={j} className="text-[12.5px] leading-relaxed text-on-surface/90">
                {renderInline(item)}
              </li>
            ))}
          </ul>
        );
        continue;
      }

      if (/^\d+\. /.test(line)) {
        const items: string[] = [];
        while (i < lines.length && /^\d+\. /.test(lines[i])) {
          items.push(lines[i].replace(/^\d+\. /, ""));
          i++;
        }
        elements.push(
          <ol key={`ol-${i}`} className="my-1.5 pl-4 space-y-0.5 list-decimal list-outside">
            {items.map((item, j) => (
              <li key={j} className="text-[12.5px] leading-relaxed text-on-surface/90">
                {renderInline(item)}
              </li>
            ))}
          </ol>
        );
        continue;
      }

      if (line.trim() === "") {
        if (elements.length > 0) {
          elements.push(<div key={`sp-${i}`} className="h-1.5" />);
        }
        i++; continue;
      }

      elements.push(
        <p key={`p-${i}`} className="text-[12.5px] leading-relaxed text-on-surface/90">
          {renderInline(line)}
        </p>
      );
      i++;
    }

    return <div className="space-y-0.5">{elements}</div>;
  } catch (e) {
    console.error("Markdown rendering error:", e);
    return <p className="text-red-400">Error rendering content.</p>;
  }
}

export function AgentView() {
  const [input, setInput] = useState("");
  const [copiedStates, setCopiedStates] = useState<Record<string, boolean>>({});
  const chatEndRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const sendBtnRef = useRef<HTMLButtonElement>(null);

  const lastActiveTerminalId = useAppShellStore((s) => s.lastActiveTerminalId);
  const tabs = useSessionStore((s) => s.tabs);
  const sessions = useAgentStore((s) => s.sessions);

  const targetSessionId = lastActiveTerminalId && tabs.some((t) => t.id === lastActiveTerminalId)
    ? lastActiveTerminalId
    : tabs.find((t) => t.type === "terminal")?.id || null;

  const {
    startTask,
    status,
    chatHistory,
    retryTask,
  } = useAgentExecution(targetSessionId);

  const sessionState = targetSessionId ? sessions[targetSessionId] || CONST_DEFAULT_SESSION_STATE : CONST_DEFAULT_SESSION_STATE;
  const isThinking = status === "planning" || status === "executing";

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory, isThinking]);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || isThinking) return;
    setInput("");
    startTask(trimmed);
  }, [input, isThinking, startTask]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleHeroSend = useCallback((text: string) => {
    if (isThinking) return;
    useAppShellStore.getState().setViewMode("agent");
    startTask(text);
  }, [isThinking, startTask]);

  const showEmptyState = chatHistory.length === 0 && !isThinking;

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      {showEmptyState && (
        <AgentHeroView onSend={handleHeroSend} />
      )}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="max-w-[800px] w-full mx-auto px-5 py-6 space-y-6">
          {chatHistory.map((msg, idx) => {
            const isUser = msg.role === "user";
            // Group user + assistant (if following)
            if (isUser) {
              const assistant = chatHistory[idx + 1]?.role === "assistant" ? chatHistory[idx + 1] : null;
              return (
                <div key={msg.id} className="flex flex-col w-full items-end">
                  {/* User message sticky */}
                  <div
                    className={`max-w-[70%] rounded-2xl px-4 py-3 text-[14px] leading-relaxed ${isUser
                      ? "bg-[#272B36] text-[rgba(255,255,255,0.9)]"
                      : "bg-transparent text-[rgba(255,255,255,0.8)]"
                      }`}
                  >
                    {msg.content}
                  </div>

                  {/* AI response */}
                  {assistant && (
                    <div className="space-y-2 mt-3 pb-4 text-left w-full">
                      <div className="text-[13px] leading-relaxed break-words text-[rgba(232,234,240,0.9)]">
                        {renderMarkdown(assistant.content)}
                      </div>

                      <div className="flex items-center justify-end gap-3 text-[rgba(232,234,240,0.4)]">
                        {assistant.durationMs !== undefined && assistant.durationMs > 0 && (
                          <span className="text-[10px] text-[rgba(232,234,240,0.3)]">Worked for {Math.round(assistant.durationMs / 1000)}s</span>
                        )}
                        <button onClick={() => {
                          navigator.clipboard.writeText(assistant.content);
                          setCopiedStates((p) => ({ ...p, [assistant.id]: true }));
                          setTimeout(() => setCopiedStates((p) => ({ ...p, [assistant.id]: false })), 2000);
                        }} className="hover:text-[rgba(232,234,240,0.8)] transition-colors cursor-pointer">
                          {copiedStates[assistant.id] ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            }
            // Skip assistant message if already handled in turn grouping
            if (msg.role === "assistant" && chatHistory[idx - 1]?.role === "user") return null;

            return null; // Should not happen with turn grouping
          })}
        </div>
        <div ref={chatEndRef} />
      </div>

      {/* Input area - only visible if not empty state */}
      {!showEmptyState && (
        <div className="shrink-0 pt-3 pb-6 px-5">
          <div className="max-w-[800px] mx-auto w-full">
            <div className="w-full p-[1px] rounded-[14px] bg-[rgba(255,255,255,0.08)]">
              <div className="bg-[#161929] rounded-[13px] relative overflow-hidden">
                <textarea
                  ref={taRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask the agent to do something..."
                  rows={1}
                  className="block w-full min-h-[60px] max-h-[200px] bg-transparent border-none outline-none resize-none text-[15px] leading-[1.6] text-[rgba(255,255,255,0.85)] px-5 pt-4 pb-2 font-sans overflow-y-auto scrollbar-thin placeholder:text-[rgba(255,255,255,0.22)]"
                />
                <div className="flex items-center justify-between px-3 pb-[10px]">
                  <div className="flex items-center gap-1">
                    <button className="p-1.5 rounded-lg text-[rgba(255,255,255,0.32)] hover:text-[rgba(255,255,255,0.65)] hover:bg-[rgba(255,255,255,0.05)] transition-colors">
                      <Paperclip size={14} />
                    </button>
                    <button className="p-1.5 rounded-lg text-[rgba(255,255,255,0.32)] hover:text-[rgba(255,255,255,0.65)] hover:bg-[rgba(255,255,255,0.05)] transition-colors">
                      <Plus size={14} />
                    </button>
                  </div>
                  <button
                    ref={sendBtnRef}
                    onClick={handleSend}
                    disabled={!input.trim() || isThinking}
                    className="flex items-center justify-center w-8 h-8 bg-[#4553d4] border-none rounded-lg cursor-pointer transition-all hover:bg-[#5f6df0] disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <Send size={14} className="text-white" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AgentView;
