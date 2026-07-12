import { useState, useRef, useEffect, useCallback } from "react";
import { Terminal, Mic, Paperclip, Plus, ChevronDown, ArrowUp } from "lucide-react";
import { useHasApiKeyConfigured, ProviderSetupPrompt } from "../components/agents/ProviderSetupPrompt";
import { useVoiceInput } from "../hooks/useVoiceInput";
import { AgentPromptInput, AttachedFile } from "../components/agents/AgentPromptInput";
import { system } from "../lib/ipc";
import { MenuView, MenuViewItem } from "../components/ui/MenuView";

// ── Phrases ───────────────────────────────────────────────────────────────
const PHRASES = [
  { before: "How can I ", colored: "help you", after: " today?" },
  { before: "What do you ", colored: "want me to farm", after: " today?" },
];

// ── Chips ─────────────────────────────────────────────────────────────────
const CHIPS = [
  { label: "Code", icon: "code" },
  { label: "Explain", icon: "explain" },
  { label: "Refactor", icon: "refactor" },
  { label: "Debug", icon: "debug" },
  { label: "Test", icon: "test" },
];

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

function lerpAngleDeg(cur: number, tgt: number, t: number): number {
  let d = ((tgt - cur) % 360 + 360) % 360;
  if (d > 180) d -= 360;
  return cur + d * t;
}

/**
 * Maps the cursor character position to a dynamic perimeter track angle.
 * Starts Top-Left (225°) and wraps heavily around the clockwise border geometry.
 */
function calculatePerimeterAngle(ta: HTMLTextAreaElement): number {
  const totalChars = Math.max(ta.value.length, 1);
  const currentPos = ta.selectionStart || 0;
  const progress = currentPos / totalChars; // 0.0 to 1.0

  // Standardize perimeter segments: Top (40%), Right (10%), Bottom (40%), Left (10%)
  if (progress <= 0.4) {
    // Top wall: linear scale across 225° to 315°
    return 225 + (progress / 0.4) * 90;
  } else if (progress <= 0.5) {
    // Right wall: linear scale across 315° to 405° (45°)
    return 315 + ((progress - 0.4) / 0.1) * 90;
  } else if (progress <= 0.9) {
    // Bottom wall: linear scale across 45° to 135°
    return 45 + ((progress - 0.5) / 0.4) * 90;
  } else {
    // Left wall: linear scale across 135° to 225°
    return 135 + ((progress - 0.9) / 0.1) * 90;
  }
}

function setGlare(el: HTMLElement, deg: number): void {
  deg = ((deg % 360) + 360) % 360;
  const half = 40, start = deg - half, p1 = deg - 15, p2 = deg, end = deg + half;
  el.style.background = [
    "conic-gradient(", "  from 0deg at 50% 50%,",
    `  rgba(100,120,255,0.0)   ${mod(start - 20, 360)}deg,`,
    `  rgba(100,120,255,0.15)  ${mod(start, 360)}deg,`,
    `  rgba(160,185,255,0.75)  ${mod(p1, 360)}deg,`,
    `  rgba(210,225,255,0.98)  ${mod(p2, 360)}deg,`,
    `  rgba(160,185,255,0.70)  ${mod(end - 8, 360)}deg,`,
    `  rgba(100,120,255,0.12)  ${mod(end + 10, 360)}deg,`,
    `  rgba(100,120,255,0.0)   ${mod(end + 30, 360)}deg,`,
    `  rgba(100,120,255,0.0)   ${mod(start - 20 + 360, 360)}deg`,
    ")",
  ].join("\n");
}

function ChipIcon({ type }: { type: string }) {
  switch (type) {
    case "code":
      return <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M4 3L1 7L4 11M10 3L13 7L10 11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>;
    case "explain":
      return <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><rect x="1" y="1" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.3" /><path d="M4 7h6M4 5h6M4 9h4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" /></svg>;
    case "refactor":
      return <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M7 2a5 5 0 100 10A5 5 0 007 2zM7 5v2l1.5 1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>;
    case "debug":
      return <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M7 1l1.2 4.8L13 7l-4.8 1.2L7 13l-1.2-4.8L1 7l4.8-1.2z" stroke="currentColor" strokeWidth="1.2" /></svg>;
    case "test":
      return <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M2 4h10M2 7h6M2 10h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>;
    default:
      return null;
  }
}

export function AgentHeroView({
  onSend,
  selectedModel,
  onModelChange,
  sessionName,
  onNewSession,
  onRenameSession,
}: {
  onSend?: (text: string, files?: AttachedFile[]) => void;
  selectedModel?: string;
  onModelChange?: (model: string) => void;
  sessionName: string;
  onNewSession?: () => void;
  onRenameSession?: (newTitle: string) => void;
}) {
  const hasApiKey = useHasApiKeyConfigured();
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [input, setInput] = useState("");
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [showMenu, setShowMenu] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [tempTitle, setTempTitle] = useState(sessionName);

  useEffect(() => {
    setTempTitle(sessionName);
  }, [sessionName]);

  const saveRename = () => {
    if (tempTitle.trim()) {
      onRenameSession?.(tempTitle.trim());
    }
    setIsEditing(false);
  };

  const { isListening, toggleListening } = useVoiceInput({
    onTranscript: (text) => setInput(text),
    getCurrentValue: () => input,
  });

  const curAngleRef = useRef(225);
  const targetAngleRef = useRef(225);
  const focusedRef = useRef(false);
  const rafIdRef = useRef(0);
  const letterElsRef = useRef<HTMLElement[]>([]);
  const waveTRef = useRef(0);

  const [phraseIdx, setPhraseIdx] = useState(0);
  const [warpClass, setWarpClass] = useState("");
  const currentPhrase = PHRASES[phraseIdx];

  // ── Adjusted Warp Animation Loop Timing ──────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      // 1. Kick off fast exit
      setWarpClass("warp-exit");

      // 2. Ultra-short 50ms delay
      setTimeout(() => {
        setPhraseIdx((prev) => (prev + 1) % PHRASES.length);
        setWarpClass("warp-enter");

        // 3. Pop cleanly back down immediately (20ms)
        setTimeout(() => {
          setWarpClass("");
        }, 20);
      }, 50);

    }, 5500); // Phrase sits visible for ~5.3 seconds

    return () => clearInterval(interval);
  }, []);

  // ── Rebind Wave DOM Nodes on Cycle ───────────────────────────────────────
  const coloredSpanRef = useCallback((node: HTMLSpanElement | null) => {
    if (node) {
      letterElsRef.current = Array.from(node.children) as HTMLElement[];
    }
  }, [phraseIdx]);

  const handleFocus = useCallback(() => {
    focusedRef.current = true;
    if (taRef.current) targetAngleRef.current = calculatePerimeterAngle(taRef.current);
  }, []);

  const handleBlur = useCallback(() => {
    focusedRef.current = false;
    targetAngleRef.current = 225; // Snaps back home nicely to top-left corner
  }, []);

  const handleCursorMove = useCallback(() => {
    if (taRef.current) targetAngleRef.current = calculatePerimeterAngle(taRef.current);
  }, []);

  const handleValueChange = useCallback((val: string) => {
    setInput(val);

    // Explicit frame cycle recalculation maps changes on typing/deletions instantly
    setTimeout(() => {
      handleCursorMove(); // Ensure border tracks on input change
      if (taRef.current) targetAngleRef.current = calculatePerimeterAngle(taRef.current);
    }, 0);
  }, [handleCursorMove]);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed) return;
    onSend?.(trimmed, attachedFiles);
    setInput("");
    setAttachedFiles([]);
    targetAngleRef.current = 225;
  }, [input, attachedFiles, onSend]);

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

  const handleRemoveFile = useCallback((idx: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }, [handleSend]);

  const handleChipClick = useCallback((label: string) => {
    const p: Record<string, string> = { Code: "Write code to ", Explain: "Explain ", Refactor: "Refactor ", Debug: "Debug ", Test: "Write tests for " };
    setInput(p[label] || "");
    setTimeout(() => {
      if (taRef.current) {
        taRef.current.focus();
        targetAngleRef.current = calculatePerimeterAngle(taRef.current);
      }
    }, 0);
  }, []);

  if (!hasApiKey) {
    return <ProviderSetupPrompt />;
  }

  return (
    <>
      <style>{`
        /* ── Motion Warp Curve Styling ── */
        .warp-text {
          display: inline-block;
          transform: translateY(0) scaleY(1);
          filter: blur(0px);
          opacity: 1;
          transition: transform 0.15s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.12s linear, filter 0.12s linear;
        }
        .warp-exit {
          transform: translateY(-24px) scaleY(1.6);
          filter: blur(6px);
          opacity: 0;
        }
        .warp-enter {
          transform: translateY(24px) scaleY(1.6);
          filter: blur(6px);
          opacity: 0;
        }
      `}</style>

      <div className="flex items-center justify-center min-h-[480px] h-full px-6 py-[52px] pb-14 relative overflow-hidden bg-background font-sans select-text">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 pointer-events-none"
          style={{ width: "600px", height: "300px", background: "radial-gradient(ellipse at 50% 0%, rgba(55,80,200,0.07) 0%, transparent 70%)" }}
        />

        <div className="w-full max-w-[680px] flex flex-col items-center relative z-10">
          <div className="inline-flex items-center gap-[7px] bg-[rgba(80,90,200,0.18)] border border-[rgba(100,110,220,0.28)] rounded-full px-4 py-1.5 mb-2 select-none relative">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M8 1.5L9.4 6.6L14.5 8L9.4 9.4L8 14.5L6.6 9.4L1.5 8L6.6 6.6Z" fill="#8899ff" />
            </svg>
            {isEditing ? (
              <input
                type="text"
                className="bg-transparent border-none text-[13px] font-medium tracking-[0.01em] text-[#8899ff] focus:outline-none w-32 text-center"
                value={tempTitle}
                onChange={(e) => setTempTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    saveRename();
                  } else if (e.key === "Escape") {
                    setIsEditing(false);
                  }
                }}
                onBlur={saveRename}
                autoFocus
              />
            ) : (
              <div className="relative flex items-center">
                <button
                  onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }}
                  className="text-[13px] font-medium tracking-[0.01em] text-[#8899ff] hover:text-[#a0b0ff] flex items-center gap-1 cursor-pointer select-none border-none bg-transparent"
                >
                  <span>{sessionName}</span>
                  <ChevronDown size={12} />
                </button>

                <MenuView
                  open={showMenu}
                  onClose={() => setShowMenu(false)}
                  className="absolute left-1/2 -translate-x-1/2 mt-6 w-40 z-[999]"
                  style={{ pointerEvents: "auto" }}
                >
                  <MenuViewItem onClick={() => { setShowMenu(false); onNewSession?.(); }}>New Session</MenuViewItem>
                  <MenuViewItem onClick={() => { setShowMenu(false); setIsEditing(true); }}>Rename Session</MenuViewItem>
                </MenuView>
              </div>
            )}
          </div>

          {/* Headline component layout - explicitly given h-16 + py-4 padding space so lines never cut */}
          <div className="flex items-center justify-center select-none min-h-[64px] text-[32px] font-semibold text-[rgba(255,255,255,0.9)] tracking-tight font-sans whitespace-pre overflow-visible">
            <span className="leading-[1.2]">{currentPhrase.before}</span>
            <span className="inline-grid relative overflow-visible align-baseline">
              <span
                ref={coloredSpanRef}
                className={`warp-text text-[#8899ff] col-start-1 row-start-1 leading-[1.2] py-4 ${warpClass}`}
              >
                {currentPhrase.colored.split("").map((char, index) => (
                  <span key={index} className="inline-block transition-transform duration-75">
                    {char === " " ? "\u00A0" : char}
                  </span>
                ))}
              </span>
            </span>
            <span className="leading-[1.2]">{currentPhrase.after}</span>
          </div>

          <div className="flex flex-wrap gap-2 justify-center mb-5">
            {CHIPS.map((chip) => (
              <button key={chip.label} onClick={() => handleChipClick(chip.label)}
                className="inline-flex items-center gap-1.5 bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-1.5 text-[13px] text-[rgba(255,255,255,0.42)] cursor-pointer transition-all duration-150 font-sans hover:bg-[rgba(255,255,255,0.07)] hover:text-[rgba(255,255,255,0.75)] hover:border-[rgba(255,255,255,0.14)]"
              >
                <ChipIcon type={chip.icon} />{chip.label}
              </button>
            ))}
          </div>

          <div className="w-full">
            <AgentPromptInput
              value={input}
              onValueChange={handleValueChange}
              onSubmit={handleSend}
              isLoading={false}
              attachedFiles={attachedFiles}
              onRemoveFile={handleRemoveFile}
              isListening={isListening}
              toggleListening={toggleListening}
              onAttachClick={handleAttachFileClick}
              taRef={taRef}
              onFocus={handleFocus}
              onBlur={handleBlur}
              onKeyUp={handleCursorMove}
              onClick={handleCursorMove}
              onSelect={handleCursorMove}
              selectedModel={selectedModel}
              onModelChange={onModelChange}
            />
          </div>
        </div>
      </div>
    </>
  );
}