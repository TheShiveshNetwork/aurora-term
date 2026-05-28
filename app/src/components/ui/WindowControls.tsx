import { getCurrentWindow } from "@tauri-apps/api/window";
import React, { useEffect, useState } from "react";

export function WindowControls() {
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    setIsMac(navigator.userAgent.includes("Mac"));
  }, []);

  const handleMinimize = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      await getCurrentWindow().minimize();
    } catch (err) {
      console.error("minimize failed:", err);
    }
  };

  const handleMaximize = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      await getCurrentWindow().toggleMaximize();
    } catch (err) {
      console.error("toggleMaximize failed:", err);
    }
  };

  const handleClose = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      await getCurrentWindow().close();
    } catch (err) {
      console.error("close failed:", err);
    }
  };

  if (isMac) {
    return (
      <div
        data-tauri-no-drag
        className="flex items-center gap-1.5 pr-2 select-none"
      >
        <button
          type="button"
          onClick={handleClose}
          onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
          data-tauri-no-drag
          className="w-3 h-3 rounded-full bg-[#ff5f56] border border-[#e0443e] cursor-pointer hover:opacity-80 transition-opacity"
          title="Close"
        />
        <button
          type="button"
          onClick={handleMinimize}
          onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
          data-tauri-no-drag
          className="w-3 h-3 rounded-full bg-[#ffbd2e] border border-[#dea123] cursor-pointer hover:opacity-80 transition-opacity"
          title="Minimize"
        />
        <button
          type="button"
          onClick={handleMaximize}
          onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
          data-tauri-no-drag
          className="w-3 h-3 rounded-full bg-[#27c93f] border border-[#1aab29] cursor-pointer hover:opacity-80 transition-opacity"
          title="Maximize"
        />
      </div>
    );
  }

  // Windows / Linux layout: minimize | maximize | close on the right
  return (
    <div
      data-tauri-no-drag
      className="flex items-center h-full select-none"
    >
      <button
        type="button"
        onClick={handleMinimize}
        onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
        data-tauri-no-drag
        className="w-10 h-8 flex items-center justify-center hover:bg-white/10 text-white/50 hover:text-white transition-colors cursor-pointer"
        title="Minimize"
      >
        <svg width="10" height="1" viewBox="0 0 10 1" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M0 0.5H10" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
        </svg>
      </button>
      <button
        type="button"
        onClick={handleMaximize}
        onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
        data-tauri-no-drag
        className="w-10 h-8 flex items-center justify-center hover:bg-white/10 text-white/50 hover:text-white transition-colors cursor-pointer"
        title="Maximize"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="1" y="1" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1"/>
        </svg>
      </button>
      <button
        type="button"
        onClick={handleClose}
        onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
        data-tauri-no-drag
        className="w-10 h-8 flex items-center justify-center hover:bg-red-500 text-white/50 hover:text-white transition-colors cursor-pointer"
        title="Close"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M1.5 1.5L8.5 8.5M8.5 1.5L1.5 8.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
        </svg>
      </button>
    </div>
  );
}
