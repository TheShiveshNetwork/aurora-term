import { X } from "lucide-react";
import { PeekResult } from "../../extensions/lsp/client";

interface PeekPanelProps {
  peek: PeekResult;
  onNavigate: () => void;
  onClose: () => void;
}

// Inline "peek definition" preview: shows the target file's name and a window of
// its source around the definition (with the definition lines highlighted).
// Clicking the header or a line navigates to that location and closes the peek.
export function PeekPanel({ peek, onNavigate, onClose }: PeekPanelProps) {
  const fileName = peek.path.split(/[/\\]/).pop() || peek.path;

  return (
    <div
      className="absolute top-12 right-3 z-40 w-[520px] max-w-[80%] max-h-[60%] flex flex-col rounded-xl overflow-hidden shadow-2xl border border-outline-variant/20"
      style={{
        background: "rgba(15,18,25,0.92)",
        backdropFilter: "blur(24px)",
        WebkitBackdropFilter: "blur(24px)",
      }}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/8 shrink-0">
        <button className="flex items-center gap-2 min-w-0 text-left hover:opacity-80 transition-opacity" onClick={onNavigate} title={peek.path}>
          <span className="text-[12px] text-white/85 font-medium truncate">{fileName}</span>
          <span className="text-[10px] text-white/35 truncate">{peek.path}</span>
        </button>
        <button className="p-1 rounded hover:bg-white/10 text-white/50 hover:text-white/80 shrink-0" onClick={onClose} title="Close peek (Esc)">
          <X size={14} />
        </button>
      </div>
      <div className="overflow-auto flex-1 py-1 font-mono text-xs leading-relaxed">
        {peek.lines.map((ln) => (
          <div
            key={ln.lineNumber}
            className={`flex items-start cursor-pointer hover:bg-white/5 ${ln.isTarget ? "bg-primary/15" : ""}`}
            onClick={onNavigate}
          >
            <span className="select-none text-right pr-3 pl-3 w-12 shrink-0 text-white/30 tabular-nums">
              {ln.lineNumber}
            </span>
            <span className="whitespace-pre pr-4 flex-1 text-white/80">{ln.text || " "}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
