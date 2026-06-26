import { useState, useRef, useEffect, useCallback } from "react";
import { Terminal, Mic, Paperclip, Plus, ChevronDown } from "lucide-react";

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

export function AgentHeroView({ onSend }: { onSend?: (text: string) => void }) {
  const outerRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const sendBtnRef = useRef<HTMLButtonElement>(null);
  const [input, setInput] = useState("");

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

  // ── Waving Animation Math Loop ────────────────────────────────────────────
  useEffect(() => {
    let running = true;
    const wave = () => {
      if (!running) return;
      waveTRef.current += 0.036;
      letterElsRef.current.forEach((s, i) => {
        if (s) s.style.transform = `translateY(${Math.sin(waveTRef.current + i * 0.35) * 1.5}px)`;
      });
      rafIdRef.current = requestAnimationFrame(wave);
    };
    rafIdRef.current = requestAnimationFrame(wave);
    return () => { running = false; cancelAnimationFrame(rafIdRef.current); };
  }, []);

  // ── Tight-Lock Perimeter Glare Animation Loop ────────────────────────────
  useEffect(() => {
    let running = true;
    const tick = () => {
      if (!running) return;
      // Faster lerp (0.22) and smoother tracking to make glare follow cursor
      curAngleRef.current = lerpAngleDeg(curAngleRef.current, targetAngleRef.current, focusedRef.current ? 0.22 : 0.04);
      if (outerRef.current) setGlare(outerRef.current, curAngleRef.current);
      rafIdRef.current = requestAnimationFrame(tick);
    };
    rafIdRef.current = requestAnimationFrame(tick);
    return () => { running = false; cancelAnimationFrame(rafIdRef.current); };
  }, []);

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

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);

    // Explicit frame cycle recalculation maps changes on typing/deletions instantly
    setTimeout(() => {
      handleCursorMove(); // Ensure border tracks on input change
      if (taRef.current) targetAngleRef.current = calculatePerimeterAngle(taRef.current);
    }, 0);
    if (sendBtnRef.current) sendBtnRef.current.classList.toggle("has-text", val.trim().length > 0);
  }, []);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed) return;
    onSend?.(trimmed);
    setInput("");
    targetAngleRef.current = 225;
    if (sendBtnRef.current) sendBtnRef.current.classList.remove("has-text");
  }, [input, onSend]);

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
          <div className="inline-flex items-center gap-[7px] bg-[rgba(80,90,200,0.18)] border border-[rgba(100,110,220,0.28)] rounded-full px-4 py-1.5 mb-6 select-none">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M8 1.5L9.4 6.6L14.5 8L9.4 9.4L8 14.5L6.6 9.4L1.5 8L6.6 6.6Z" fill="#8899ff" />
            </svg>
            <span className="text-[13px] font-medium tracking-[0.01em] text-[#8899ff]">Aura Agent</span>
          </div>

          {/* Headline component layout - explicitly given h-16 + py-4 padding space so lines never cut */}
          <div className="flex items-center justify-center mb-[32px] min-h-[64px] text-[32px] font-semibold text-[rgba(255,255,255,0.9)] tracking-tight font-sans whitespace-pre overflow-visible">
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

          <div ref={outerRef} className="w-full p-[1px] rounded-[14px] relative transition-all duration-75"
            style={{ background: "conic-gradient(from 225deg, rgba(120,140,255,0.0) 0deg, rgba(120,140,255,0.0) 60deg, rgba(180,200,255,0.9) 120deg, rgba(120,140,255,0.0) 180deg, rgba(120,140,255,0.0) 360deg)" }}
          >
            <div className="bg-[#161929] rounded-[13px] relative overflow-hidden">
              <textarea ref={taRef} value={input} onChange={handleInputChange}
                onFocus={handleFocus} onBlur={handleBlur} onKeyUp={handleCursorMove}
                onClick={handleCursorMove} onSelect={handleCursorMove} onKeyDown={handleKeyDown}
                placeholder="Ask the agent to do something..." rows={1}
                className="aurora-ta block w-full min-h-[80px] max-h-[200px] bg-transparent border-none outline-none resize-none text-[15px] leading-[1.6] text-[rgba(255,255,255,0.85)] px-5 pt-5 pb-2 font-sans overflow-y-auto scrollbar-thin placeholder:text-[rgba(255,255,255,0.22)]"
              />
              <div className="flex items-center gap-1.5 px-3 pb-[14px] pt-1.5">
                <button className="flex items-center justify-center w-[34px] h-[34px] bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.10)] rounded-lg text-[rgba(255,255,255,0.55)] cursor-pointer transition-all duration-150 hover:bg-[rgba(255,255,255,0.10)]">
                  <Plus size={18} />
                </button>
                <button className="inline-flex items-center gap-1.5 bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.09)] rounded-lg px-2.5 py-1.5 text-[13px] text-[rgba(255,255,255,0.58)] cursor-pointer font-sans whitespace-nowrap transition-all duration-150 hover:bg-[rgba(255,255,255,0.08)]">
                  Claude Sonnet <ChevronDown size={12} />
                </button>
                <div className="flex-1" />
                <button className="flex items-center justify-center w-8 h-8 bg-transparent border-none rounded-md text-[rgba(255,255,255,0.32)] cursor-pointer transition-colors duration-150 hover:text-[rgba(255,255,255,0.65)]">
                  <Paperclip size={14} />
                </button>
                <button className="flex items-center justify-center w-8 h-8 bg-transparent border-none rounded-md text-[rgba(255,255,255,0.32)] cursor-pointer transition-colors duration-150 hover:text-[rgba(255,255,255,0.65)]">
                  <Terminal size={14} />
                </button>
                <button className="flex items-center justify-center w-8 h-8 bg-transparent border-none rounded-md text-[rgba(255,255,255,0.32)] cursor-pointer transition-colors duration-150 hover:text-[rgba(255,255,255,0.65)]">
                  <Mic size={14} />
                </button>
                <button ref={sendBtnRef} onClick={handleSend} disabled={!input.trim()}
                  className="flex items-center justify-center w-9 h-9 bg-[#4553d4] border-none rounded-lg cursor-pointer shrink-0 transition-all duration-150 hover:bg-[#5f6df0] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M8 13V3" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
                    <path d="M3.5 7.5L8 3L12.5 7.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}