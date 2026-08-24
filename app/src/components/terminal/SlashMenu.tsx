import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { CornerDownLeft } from "lucide-react";

export interface SlashCommandItem {
  command: string;
  description: string;
  usage?: string;
}

export const SLASH_COMMANDS: SlashCommandItem[] = [
  { command: "/skills", description: "List available agent skills" },
  { command: "/mcp", description: "List configured MCP servers" },
  { command: "/btw", description: "Ask a side question while a task runs", usage: "<message>" },
  { command: "/file", description: "Load file(s) into agent context", usage: "<path> [goal]" },
];

export interface SlashMenuHandle {
  count: () => number;
  move: (delta: number) => void;
  selectHighlighted: () => void;
}

interface SlashMenuProps {
  open: boolean;
  value: string;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  onInsert: (text: string) => void;
}

// Read the exact resolved style of the input container so the popup is a pixel-
// perfect continuation of it (same color, transparency, blur, border, radius).
// Hardcoding the values would drift from CommandInputBar's inline styles and the
// two surfaces would be visibly distinguishable.
function readContainerStyle(el: HTMLElement) {
  const cs = getComputedStyle(el);
  const blur = cs.backdropFilter && cs.backdropFilter !== "none"
    ? cs.backdropFilter
    : (cs.webkitBackdropFilter && cs.webkitBackdropFilter !== "none"
      ? cs.webkitBackdropFilter
      : "none");
  return {
    background: cs.backgroundColor,
    // Use the left side: it always carries the full border even when the
    // container collapses its top border while the menu is open.
    borderColor: cs.borderLeftColor,
    borderStyle: cs.borderLeftStyle,
    borderWidth: cs.borderLeftWidth,
    blur,
  };
}

export const SlashMenu = forwardRef<SlashMenuHandle, SlashMenuProps>(
  ({ open, value, inputRef, onInsert }, ref) => {
    const [highlight, setHighlight] = useState(0);
    const listRef = useRef<HTMLDivElement>(null);

    const filter = value.match(/(?:^|\s)\/(\w*)$/)?.[1] ?? "";
    const filtered = useMemo(
      () => SLASH_COMMANDS.filter((c) => c.command.slice(1).startsWith(filter)),
      [filter]
    );

    useEffect(() => setHighlight(0), [filter]);
    useEffect(() => {
      if (highlight >= filtered.length) {
        setHighlight(Math.max(0, filtered.length - 1));
      }
    }, [filtered.length, highlight]);
    useEffect(() => {
      const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${highlight}"]`);
      el?.scrollIntoView({ block: "nearest" });
    }, [highlight]);

    useImperativeHandle(
      ref,
      () => ({
        count: () => filtered.length,
        move: (delta) => {
          setHighlight((h) => (h + delta + filtered.length) % filtered.length);
        },
        selectHighlighted: () => {
          const item = filtered[highlight];
          if (item) onInsert(`${item.command} `);
        },
      }),
      [filtered, highlight, onInsert]
    );

    if (!open || filtered.length === 0) return null;

    const inputEl = inputRef.current;
    if (!inputEl) return null;
    // Anchor to the full input container (.warp-input-glow) rather than the
    // bare textarea, so the popup spans the whole bar (including the icon
    // buttons) and lines up flush with its left/right edges.
    const anchorEl = (inputEl.closest(".warp-input-glow") as HTMLElement | null) ?? inputEl;
    const rect = anchorEl.getBoundingClientRect();
    if (!rect) return null;

    const theme = readContainerStyle(anchorEl);
    return createPortal(
      <div
        className="fixed z-[99999] overflow-hidden"
        style={{
          bottom: window.innerHeight - rect.top,
          left: rect.left,
          width: rect.width,
          background: theme.background,
          border: `${theme.borderWidth} ${theme.borderStyle} ${theme.borderColor}`,
          borderBottom: "none",
          borderRadius: "10px 10px 0 0",
          backdropFilter: theme.blur,
          WebkitBackdropFilter: theme.blur,
        }}
      >
        <div ref={listRef} className="max-h-64 overflow-y-auto scrollbar-thin py-1">
          {filtered.map((item, idx) => (
            <button
              key={item.command}
              type="button"
              data-index={idx}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onInsert(`${item.command} `)}
              onMouseEnter={() => setHighlight(idx)}
              className="w-[calc(100%-16px)] flex items-center gap-2 px-4 py-2 mx-2 my-1 text-left cursor-pointer transition-all duration-150 border border-transparent hover:border-[rgba(79,140,255,0.45)]"
              style={{
                background: idx === highlight ? "rgba(79,140,255,0.12)" : "transparent",
                border: idx === highlight ? "1px solid rgba(79,140,255,0.5)" : undefined,
                borderRadius: "6px",
              }}
            >
              <span className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                <span className="text-[12.5px] font-semibold text-[#E8EAF0]">{item.command}</span>
                {item?.usage && <span className="text-[12.5px] text-[#4F8CFF] font-mono">{item.usage}</span> }
                <span className="text-[11px] text-white/40">{item.description}</span>
              </span>
              {idx === highlight && (
                <CornerDownLeft size={12} className="text-white/30 shrink-0" />
              )}
            </button>
          ))}
        </div>
      </div>,
      document.body
    );
  }
);

SlashMenu.displayName = "SlashMenu";
