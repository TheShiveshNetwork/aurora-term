import React, { useState, useRef, useEffect } from "react";
import { ProviderName } from "@aurora/types";
import { ProviderIcon, DISPLAY_NAMES } from "./ProviderIcon";

interface ProviderSelectorProps {
  providers: ProviderName[];
  activeProvider: ProviderName;
  onChange: (name: ProviderName) => void;
}

export function ProviderSelector({ providers, activeProvider, onChange }: ProviderSelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-3 w-full p-3 rounded-xl border border-white/[0.04] bg-[#161920]/40 hover:bg-[#1c202a]/60 transition-all cursor-pointer text-left"
      >
        <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-white/[0.02] border border-white/[0.04] shrink-0">
          <ProviderIcon name={activeProvider} size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-[#E8EAF0]">{DISPLAY_NAMES[activeProvider]}</div>
          <div className="text-[11px] text-[#E8EAF0]/40">Default provider</div>
        </div>
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          className={`transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-white/30" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50 rounded-xl border border-white/[0.06] bg-[#1c202a] shadow-xl overflow-hidden">
          {providers.map((name) => {
            const selected = name === activeProvider;
            return (
              <button
                key={name}
                onClick={() => {
                  onChange(name);
                  setOpen(false);
                }}
                className={`flex items-center gap-3 w-full px-3 py-2.5 text-left transition-all cursor-pointer hover:bg-white/[0.04] ${selected ? "bg-blue-500/8" : ""}`}
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center bg-white/[0.02] border shrink-0 ${selected ? "border-blue-500/30" : "border-white/[0.04]"}`}>
                  <ProviderIcon name={name} size={16} />
                </div>
                <span className={`text-[13px] ${selected ? "text-[#E8EAF0] font-medium" : "text-[#E8EAF0]/60"}`}>
                  {DISPLAY_NAMES[name]}
                </span>
                {selected && (
                  <svg className="ml-auto" width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M13.333 4L6 11.333 2.667 8" stroke="#4F8CFF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
