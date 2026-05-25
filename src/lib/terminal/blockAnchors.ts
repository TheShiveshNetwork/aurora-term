import { Terminal } from "@xterm/xterm";
import { useBlockStore } from "../../stores/useBlockStore";

/**
 * Converts a specific xterm buffer row index into a pixel Y coordinate
 * relative to the current viewport scroll position.
 */
export function rowToPixelY(terminal: Terminal, bufferRow: number): number {
  if (!terminal || !terminal.buffer || !terminal.buffer.active) return 0;
  const core = (terminal as any)._core;
  if (!core) return 0;

  // Read actual measured row height from xterm's viewport service, falling back if unavailable
  const rowHeight = (core.viewport?._rowHeight as number) ?? (terminal.options.fontSize || 13) * 1.5;
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

  const core = (terminal as any)._core;
  const rowHeight = core ? ((core.viewport?._rowHeight as number) ?? (terminal.options.fontSize || 13) * 1.5) : 19.5;

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
