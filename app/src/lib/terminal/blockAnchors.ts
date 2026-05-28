import { Terminal } from "@xterm/xterm";
import { useBlockStore } from "../../stores/useBlockStore";

/**
 * Derives the active row height in pixels using xterm's public options
 * and DOM measurements to avoid relying on unstable private internal properties.
 */
export function getRowHeight(terminal: Terminal): number {
  if (!terminal) return 19.5;

  // 1. Try to measure directly from the DOM (captures actual subpixel rendering)
  if (terminal.element) {
    const rowEl = terminal.element.querySelector(".xterm-rows > div");
    if (rowEl) {
      const height = rowEl.getBoundingClientRect().height;
      if (height > 0) return height;
    }
  }

  // 2. Fall back to standard public options: fontSize * lineHeight
  const fontSize = terminal.options.fontSize || 13;
  const lineHeight = terminal.options.lineHeight || 1.0;
  return Math.round(fontSize * lineHeight);
}

/**
 * Converts a specific xterm buffer row index into a pixel Y coordinate
 * relative to the current viewport scroll position.
 */
export function rowToPixelY(terminal: Terminal, bufferRow: number): number {
  if (!terminal || !terminal.buffer || !terminal.buffer.active) return 0;

  const rowHeight = getRowHeight(terminal);
  const viewTop = terminal.buffer.active.viewportY ?? 0;
  const rowVal = typeof bufferRow === "number" ? bufferRow : 0;

  const y = (rowVal - viewTop) * rowHeight;
  return isNaN(y) ? 0 : y;
}

/**
 * Recalculates screen coordinates (Y offset and height in pixels) for every command block
 * currently registered in the active session, relative to the scrolled terminal viewport.
 */
export function recalculateAnchors(
  terminal: Terminal,
  sessionId: string
): Record<string, { y: number; height?: number }> {
  const anchors: Record<string, { y: number; height?: number }> = {};
  if (!terminal || !terminal.buffer || !terminal.buffer.active) return anchors;
  const blocks = useBlockStore.getState().blocks[sessionId] || [];

  const rowHeight = getRowHeight(terminal);

  for (const block of blocks) {
    const anchorRow = typeof block.anchor_row === "number" ? block.anchor_row : 0;
    const outputRowEnd = typeof block.output_row_end === "number" ? block.output_row_end : anchorRow;

    const y = rowToPixelY(terminal, anchorRow);
    
    // Height spans from output anchor_row to output_row_end (inclusive)
    const lines = Math.max(1, outputRowEnd - anchorRow);
    const height = lines * rowHeight;
    
    anchors[block.id] = {
      y: isNaN(y) ? 0 : y,
      height: isNaN(height) ? 0 : height,
    };
  }

  return anchors;
}
