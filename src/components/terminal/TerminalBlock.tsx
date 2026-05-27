import { useState } from "react";
import { Block } from "../../types/block";
import { useBlockStore } from "../../stores/useBlockStore";
import { Copy, Bookmark, ChevronUp, ChevronDown, Check, ShieldAlert, Sparkles } from "lucide-react";
import { ai } from "../../lib/ipc";

interface TerminalBlockProps {
  sessionId: string;
  block: Block;
}

export function TerminalBlock({ sessionId, block }: TerminalBlockProps) {
  const store = useBlockStore();
  const [copied, setCopied] = useState(false);
  const [explaining, setExplaining] = useState(false);

  const handleCopy = () => {
    if (!block.output_summary && !block.command) return;
    const textToCopy = `${block.command}\n${block.output_summary || ""}`;
    navigator.clipboard.writeText(textToCopy)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(console.error);
  };

  const handleBookmarkToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    store.toggleBookmark(sessionId, block.id);
  };

  const handleCollapseToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    store.toggleCollapse(sessionId, block.id);
  };

  const handleExplainError = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (explaining || block.ai_explain) return;
    setExplaining(true);
    try {
      // Trigger background Tauri command which calls system LLMs
      await ai.explainError(block.command, block.output_summary || "", block.exit_code ?? 1);
      // Wait briefly for stores/hooks to capture stream or resolve
    } catch (err) {
      console.error("AI Explanation failed:", err);
    } finally {
      setExplaining(false);
    }
  };

  // Hide or skip rendering for placeholder initialization blocks
  if (block.command === "init-aurora") return null;

  const isSuccess = block.status === "success";
  const isError = block.status === "error";
  const isRunning = block.status === "running";

  return (
    <div
      className="absolute left-0 right-0 block-frame group/frame"
      style={{
        top: block.anchor_y,
        height: block.output_height_px ?? "auto",
        pointerEvents: "none",
        backgroundColor: isRunning
          ? "rgba(240, 192, 96, 0.015)"
          : isError
            ? "rgba(243, 139, 168, 0.01)"
            : "transparent",
      }}
    >
      {/* ── Left Bounding Widget Panel (Hover Controls) ─────────────────────── */}
      <div
        className="absolute right-4 bottom-2 z-10 flex items-center gap-1 bg-[var(--color-ui-surface,rgba(30,30,30,0.85))] border border-[var(--color-ui-border,#2a2a2a)] rounded-lg p-0.5 shadow-lg opacity-0 pointer-events-none group-hover/frame:opacity-100 group-hover/frame:pointer-events-auto transition-all duration-150 transform translate-y-1 group-hover/frame:translate-y-0"
      >
        {/* Toggle Collapse */}
        <button
          type="button"
          onClick={handleCollapseToggle}
          className="p-1 hover:bg-[var(--color-term-bg)] rounded text-[var(--color-ui-text)] hover:text-primary transition-colors cursor-pointer"
          title={block.collapsed ? "Expand output block" : "Collapse output block"}
        >
          {block.collapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
        </button>

        {/* Copy command + output */}
        <button
          type="button"
          onClick={handleCopy}
          className="p-1 hover:bg-[var(--color-term-bg)] rounded text-[var(--color-ui-text)] hover:text-primary transition-colors cursor-pointer"
          title="Copy command and output summary"
        >
          {copied ? (
            <Check size={13} className="text-green-400 animate-in zoom-in-50 duration-100" />
          ) : (
            <Copy size={13} />
          )}
        </button>

        {/* Toggle Bookmark */}
        <button
          type="button"
          onClick={handleBookmarkToggle}
          className="p-1 hover:bg-[var(--color-term-bg)] rounded transition-colors cursor-pointer"
          style={{
            color: block.bookmarked ? "var(--color-primary, #f0c060)" : "var(--color-ui-text)",
          }}
          title={block.bookmarked ? "Unbookmark block" : "Bookmark block"}
        >
          <Bookmark size={13} fill={block.bookmarked ? "currentColor" : "none"} />
        </button>

        {/* AI Explain (available on error) */}
        {isError && !block.ai_explain && (
          <button
            type="button"
            onClick={handleExplainError}
            className={`p-1 hover:bg-[var(--color-term-bg)] rounded text-[var(--color-ui-text)] hover:text-primary transition-colors cursor-pointer flex items-center gap-0.5 ${explaining ? "animate-pulse" : ""
              }`}
            title="Ask AI to diagnose error"
            disabled={explaining}
          >
            <Sparkles size={13} />
          </button>
        )}
      </div>

      {/* ── Inline AI Diagnostic Card (error only) ─────────────────────────── */}
      {block.ai_explain && (
        <div
          className="absolute left-6 right-6 bottom-4 pointer-events-auto select-text z-10 bg-[var(--color-ai-bar,#161b22)] border border-[#f38ba8]/30 rounded-lg p-3 text-xs shadow-2xl flex flex-col gap-2 animate-in slide-in-from-bottom-2 duration-200"
        >
          <div className="flex items-center gap-1.5 font-bold text-red-300">
            <ShieldAlert size={14} />
            <span>AI DIAGNOSIS</span>
          </div>
          <div className="text-[var(--color-term-fg)] leading-[1.6] whitespace-pre-wrap">
            {block.ai_explain}
          </div>
        </div>
      )}
    </div>
  );
}
