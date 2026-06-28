import { getCurrentWindow } from "@tauri-apps/api/window";
import React, { useEffect, useState } from "react";

export function WindowControls() {
  const [isMac, setIsMac] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    setIsMac(navigator.userAgent.includes("Mac"));

    // Check initial maximized state
    const checkMaximized = async () => {
      try {
        const maximized = await getCurrentWindow().isMaximized();
        setIsMaximized(maximized);
      } catch (err) {
        console.error("Failed to check maximized state:", err);
      }
    };

    checkMaximized();

    // Listen for window resize/maximize events to update the icon dynamically
    let unlisten: () => void;
    getCurrentWindow().onResized(() => {
      checkMaximized();
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) unlisten();
    };
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
          className="w-3.5 h-3.5 rounded-full bg-[#ff5f56] border border-[#e0443e] cursor-pointer hover:opacity-80 transition-opacity"
          title="Close"
        />
        <button
          type="button"
          onClick={handleMinimize}
          onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
          data-tauri-no-drag
          className="w-3.5 h-3.5 rounded-full bg-[#ffbd2e] border border-[#dea123] cursor-pointer hover:opacity-80 transition-opacity"
          title="Minimize"
        />
        <button
          type="button"
          onClick={handleMaximize}
          onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
          data-tauri-no-drag
          className="w-3.5 h-3.5 rounded-full bg-[#27c93f] border border-[#1aab29] cursor-pointer hover:opacity-80 transition-opacity"
          title="Maximize"
        />
      </div>
    );
  }

  // Windows / Linux layout: minimize | maximize/restore | close on the right
  return (
    <div
      data-tauri-no-drag
      className="flex items-center h-full select-none"
    >
      {/* Minimize */}
      <button
        type="button"
        onClick={handleMinimize}
        onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
        data-tauri-no-drag
        className="w-11 min-h-8 h-full flex items-center justify-center hover:bg-white/10 text-white/50 hover:text-white transition-colors cursor-pointer"
        title="Minimize"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M1 6H11" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>

      {/* Maximize / Restore */}
      <button
        type="button"
        onClick={handleMaximize}
        onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
        data-tauri-no-drag
        className="w-11 min-h-8 h-full flex items-center justify-center hover:bg-white/10 text-white/50 hover:text-white transition-colors cursor-pointer"
        title={isMaximized ? "Restore Down" : "Maximize"}
      >
        {isMaximized ? (
          /* Standard Windows Restore Down Icon (Overlapping Squares) - Scaled Up */
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3.5 1.5H10.5V8.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
            <rect x="1.5" y="3.5" width="7" height="7" stroke="currentColor" strokeWidth="1.2" fill="none" />
          </svg>
        ) : (
          /* Standard Windows Maximize Icon (Single Square) - Scaled Up */
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="2" y="2" width="8" height="8" stroke="currentColor" strokeWidth="1.2" fill="none" />
          </svg>
        )}
      </button>

      {/* Close */}
      <button
        type="button"
        onClick={handleClose}
        onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
        data-tauri-no-drag
        className="w-11 min-h-8 h-full flex items-center justify-center hover:bg-red-500 text-white/50 hover:text-white transition-colors cursor-pointer"
        title="Close"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M2 2L10 10M10 2L2 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}