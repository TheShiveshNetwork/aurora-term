import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { SquareTerminal, CornerDownLeft } from "lucide-react";

export interface SlashCommandItem {
  command: string;
  description: string;
  usage: string;
}

export const SLASH_COMMANDS: SlashCommandItem[] = [
  { command: "/skills", description: "List available agent skills", usage: "/skills" },
  { command: "/mcp", description: "List configured MCP servers", usage: "/mcp" },
  { command: "/btw", description: "Ask a side question while a task runs", usage: "/btw <message>" },
  { command: "/file", description: "Load file(s) into agent context", usage: "/file <path> ... [goal]" },
];

export interface SlashMenuHandle {
  isOpen: () => boolean;
  count: () => number;
  move: (delta: number) => void;
  selectHighlighted: () => void;
  close: () => void;
}

interface SlashMenuProps {
  value: string;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  onInsert: (text: string) => void;
}

export const SlashMenu = forwardRef<SlashMenuHandle, SlashMenuProps>(
  ({ value, inputRef, onInsert }, ref) => {
    const [highlight, setHighlight] = useState(0);
    const [dismissed, setDismissed] = useState(false);
    const listRef = useRef<HTMLDivElement>(null);

    const match = useMemo(() => value.match(/^\/\S*$/), [value]);
    const filter = match ? match[0].slice(1) : "";
    const isOpen = !!match && !dismissed;

    const filtered = useMemo(
      () => (isOpen ? SLASH_COMMANDS.filter((c) => c.command.slice(1).startsWith(filter)) : []),
      [isOpen, filter]
    );

    // Reopen once the user types again after an Esc dismissal
    useEffect(() => {
      setDismissed(false);
    }, [filter]);

    // Reset highlight whenever the filter changes and clamp it into range
    useEffect(() => {
      setHighlight(0);
    }, [filter]);
    useEffect(() => {
      if (highlight >= filtered.length) {
        setHighlight(Math.max(0, filtered.length - 1));
      }
    }, [filtered.length, highlight]);

    // Keep the highlighted item visible inside the scroll container
    useEffect(() => {
      const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${highlight}"]`);
      el?.scrollIntoView({ block: "nearest" });
    }, [highlight]);

    useImperativeHandle(
      ref,
      () => ({
        isOpen: () => isOpen && filtered.length > 0,
        count: () => filtered.length,
        move: (delta) => {
          setHighlight((h) => (h + delta + filtered.length) % filtered.length);
        },
        selectHighlighted: () => {
          const item = filtered[highlight];
          if (item) onInsert(`${item.command} `);
        },
        close: () => setDismissed(true),
      }),
      [isOpen, filtered, highlight, onInsert]
    );

    if (!isOpen || filtered.length === 0) return null;

    const inputEl = inputRef.current;
    const rect = inputEl?.getBoundingClientRect();
    if (!rect) return null;

    // The input bar sits at the bottom of the window — anchor the menu above
    // its top edge so it always grows upward into the visible viewport.
    return createPortal(
      <div
        className="fixed z-[999] overflow-hidden rounded-md"
        style={{
          bottom: window.innerHeight - rect.top + 6,
          left: rect.left + 16,
          width: Math.max(340, rect.width - 32),
          background: "#1b1f2b",
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "0 12px 32px rgba(0,0,0,0.45)",
        }}
      >
        <div ref={listRef} className="max-h-64 overflow-y-auto scrollbar-thin py-1">
          {filtered.map((item, idx) => (
            <button
              key={item.command}
              type="button"
              data-index={idx}
              onClick={() => onInsert(`${item.command} `)}
              onMouseEnter={() => setHighlight(idx)}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-left cursor-pointer transition-colors"
              style={{
                background: idx === highlight ? "rgba(255,255,255,0.06)" : "transparent",
              }}
            >
              <span
                className="flex items-center justify-center w-6 h-6 rounded-sm shrink-0"
                style={{
                  background: idx === highlight ? "rgba(79,140,255,0.16)" : "rgba(255,255,255,0.05)",
                  color: idx === highlight ? "#4F8CFF" : "rgba(232,234,240,0.45)",
                }}
              >
                <SquareTerminal size={12} />
              </span>
              <span className="flex-1 min-w-0">
                <span className="flex items-center gap-2">
                  <span className="text-[12.5px] font-semibold text-[#E8EAF0]">{item.command}</span>
                  <span className="text-[10px] text-[#4F8CFF] font-mono">{item.usage}</span>
                </span>
                <span className="block text-[11px] text-white/40 mt-0.5 truncate">{item.description}</span>
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
