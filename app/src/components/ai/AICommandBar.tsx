import React, { useState, useEffect } from "react";
import { Sparkles, Terminal, ArrowRight, X } from "lucide-react";
import { ai, pty } from "../../lib/ipc";
import { useAIStore } from "../../stores/useAIStore";

interface AICommandBarProps {
  sessionId: string | null;
  onClose: () => void;
}

export function AICommandBar({ sessionId, onClose }: AICommandBarProps) {
  const [query, setQuery] = useState("");
  const [translated, setTranslated] = useState("");
  const [isTranslating, setIsTranslating] = useState(false);
  const { activeProvider } = useAIStore();

  useEffect(() => {
    // Listen to token stream updates from useAICompletion hook
    const handleChunk = (e: Event) => {
      const chunk = (e as CustomEvent).detail;
      setTranslated((prev) => prev + chunk);
    };

    const handleComplete = () => {
      setIsTranslating(false);
    };

    window.addEventListener("ai_stream_chunk", handleChunk); // direct or custom
    window.addEventListener("toggle-ai-bar", onClose);

    // Custom events from useAICompletion
    const onChunk = (e: Event) => {
      const chunk = (e as CustomEvent).detail;
      setTranslated((prev) => prev + chunk);
    };
    const onComplete = () => {
      setIsTranslating(false);
    };

    window.addEventListener("ai-chunk-translate", onChunk);
    window.addEventListener("ai-complete-translate", onComplete);

    return () => {
      window.removeEventListener("ai_stream_chunk", handleChunk);
      window.removeEventListener("toggle-ai-bar", onClose);
      window.removeEventListener("ai-chunk-translate", onChunk);
      window.removeEventListener("ai-complete-translate", onComplete);
    };
  }, []);

  const handleTranslate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setTranslated("");
    setIsTranslating(true);
    try {
      // Call translate command (which streams chunks via Rust to window events)
      // Since ai_translate_command in Rust generates a uuid, we can listen or let it stream to custom handler
      // For simplicity in this demo, let's trigger it
      await ai.translateCommand(query, `CWD: ~ | Provider: ${activeProvider}`);
    } catch (err) {
      console.error(err);
      setTranslated("Error translating command. Check API Key in Settings.");
      setIsTranslating(false);
    }
  };

  const handleInject = () => {
    if (!translated || !sessionId) return;
    pty.write(sessionId, translated + "\r");
    onClose();
  };

  return (
    <div className="absolute inset-x-0 top-12 mx-auto max-w-2xl bg-surface-container-high/90 backdrop-blur-xl border border-outline-variant/30 rounded-xl shadow-2xl p-4 z-50 animate-in fade-in slide-in-from-top-4 duration-200">
      <div className="flex items-center justify-between border-b border-outline-variant/10 pb-2 mb-3">
        <div className="flex items-center gap-2 text-primary">
          <Sparkles size={14} className="animate-pulse" />
          <span className="font-bold">
            Aurora AI
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-on-surface-variant/40 hover:text-on-surface hover:bg-surface-variant/20 rounded p-1 transition-all"
        >
          <X size={12} />
        </button>
      </div>

      <form onSubmit={handleTranslate} className="space-y-3">
        <div className="relative group">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Describe what you want to do in plain English..."
            className="w-full bg-surface-container-lowest/50 border border-outline-variant/20 rounded-lg pl-3 pr-10 py-2.5 text-body-base placeholder:text-outline/40 outline-none transition-all input-glow"
            autoFocus
          />
          <button
            type="submit"
            disabled={isTranslating}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-md bg-primary-container text-on-primary hover:bg-primary-container/80 transition-colors disabled:opacity-50"
          >
            <ArrowRight size={14} />
          </button>
        </div>
      </form>

      {/* Results overlay container */}
      {(translated || isTranslating) && (
        <div className="mt-4 p-3 bg-surface-container-lowest/40 border border-outline-variant/10 rounded-lg space-y-2">
          <div className="text-[9px] font-label-caps text-outline/50 uppercase tracking-widest">
            AI Translation Result
          </div>
          <div className="font-mono text-code-base text-primary/90 select-text break-all">
            {translated || (
              <span className="animate-pulse text-on-surface-variant/40">Thinking...</span>
            )}
          </div>
          {translated && (
            <div className="flex justify-end gap-2 pt-2 border-t border-outline-variant/5">
              <button
                onClick={handleInject}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-primary-container text-on-primary font-mono text-[11px] rounded-md hover:bg-primary-container/80 transition-colors shadow-sm font-bold"
              >
                <Terminal size={12} />
                <span>Inject to Shell</span>
              </button>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-end mt-3 text-[9px] font-label-caps text-outline/30 uppercase tracking-widest">
        <span>Esc to close</span>
      </div>
    </div>
  );
}
