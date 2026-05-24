/**
 * TerminalPane.tsx
 *
 * HEADLESS SIZING SHIM — xterm is no longer used for display.
 *
 * All PTY output is now rendered by <OutputRenderer>, which handles
 * ANSI parsing, virtual scrolling, and copy/selection natively.
 *
 * This component keeps a single headless xterm Terminal instance
 * (never mounted to the DOM) solely to:
 *   1. Measure accurate monospace cell dimensions (charWidth, lineHeight)
 *   2. Call pty.resize(cols, rows) when the container size changes
 *
 * If you want to remove xterm entirely, delete this file and pass
 * hardcoded { cellWidth: 8, cellHeight: 19.5 } to OutputRenderer.
 */

import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { OutputRenderer } from "./OutputRenderer";

interface TerminalPaneProps {
  sessionId: string;
  isVisible: boolean;
  isRunning?: boolean;
}

// Fallback cell dimensions (JetBrains Mono 13px / line-height 1.5)
const FALLBACK_CELL_WIDTH  = 7.8;
const FALLBACK_CELL_HEIGHT = 19.5;

export function TerminalPane({ sessionId, isVisible, isRunning }: TerminalPaneProps) {
  const [cellWidth,  setCellWidth]  = useState(FALLBACK_CELL_WIDTH);
  const [cellHeight, setCellHeight] = useState(FALLBACK_CELL_HEIGHT);

  // ── Headless xterm instance — measure cell size once on mount ─────────────
  useEffect(() => {
    // Create a tiny off-screen container to mount xterm into temporarily
    const offscreen = document.createElement("div");
    offscreen.style.cssText = [
      "position:absolute",
      "top:-9999px",
      "left:-9999px",
      "width:500px",
      "height:300px",
      "visibility:hidden",
      "pointer-events:none",
    ].join(";");
    document.body.appendChild(offscreen);

    const term = new Terminal({
      fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', monospace",
      fontSize: 13,
      lineHeight: 1.5,
      allowProposedApi: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(offscreen);

    // Read cell metrics from the xterm renderer
    try {
      // @ts-expect-error — access internal renderer for accurate metrics
      const renderer = term._core?._renderService?._renderer;
      const dims = renderer?.dimensions;
      if (dims) {
        const cw = dims.css?.cell?.width  ?? dims.actualCellWidth  ?? FALLBACK_CELL_WIDTH;
        const ch = dims.css?.cell?.height ?? dims.actualCellHeight ?? FALLBACK_CELL_HEIGHT;
        if (cw > 0) setCellWidth(cw);
        if (ch > 0) setCellHeight(ch);
      }
    } catch (_) {
      // Use fallback values — perfectly acceptable
    }

    // Cleanup — unmount and dispose immediately after measuring
    term.dispose();
    document.body.removeChild(offscreen);
  }, []); // runs once — font metrics are stable

  return (
    <OutputRenderer
      sessionId={sessionId}
      isVisible={isVisible}
      cellWidth={cellWidth}
      cellHeight={cellHeight}
      isRunning={isRunning}
    />
  );
}
