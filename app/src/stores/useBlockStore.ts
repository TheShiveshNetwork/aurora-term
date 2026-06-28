import { create } from "zustand";
import { Block } from "@aurora/types";

const runningOutputs = new Map<string, string>();

interface BlockStore {
  blocks: Record<string, Block[]>; // keyed by session_id
  runningBlockId: Record<string, string | null>; // keyed by session_id
  commandOutputReceived: Record<string, boolean>; // keyed by session_id
  addBlock: (sessionId: string, block: Block) => void;
  updateBlock: (sessionId: string, blockId: string, updates: Partial<Block>) => void;
  setRunningBlockId: (sessionId: string, blockId: string | null) => void;
  setCommandOutputReceived: (sessionId: string, received: boolean) => void;
  appendBlockOutput: (sessionId: string, blockId: string, chunk: string) => void;
  setAIExplain: (sessionId: string, blockId: string, explain: string) => void;
  toggleBookmark: (sessionId: string, blockId: string) => void;
  toggleCollapse: (sessionId: string, blockId: string) => void;
  clearBlocks: (sessionId: string) => void;
  
  // ── Compound Actions ───────────────────────────────────────────────────────
  beginBlockExecution: (sessionId: string, block: Block) => void;
  endBlockExecution: (sessionId: string) => void;

  // ── Warp-Style Coordinates API ─────────────────────────────────────────────
  beginBlock: (sessionId: string, command: string, anchorRow: number) => Block;
  finalizeBlock: (sessionId: string, blockId: string, exitCode: number) => void;
  setAnchorY: (sessionId: string, anchors: Record<string, { y: number; height?: number }>) => void;
}

export const useBlockStore = create<BlockStore>((set) => ({
  blocks: {},
  runningBlockId: {},
  commandOutputReceived: {},
  
  addBlock: (sessionId, block) =>
    set((state) => {
      const sessionBlocks = state.blocks[sessionId] || [];
      return {
        blocks: {
          ...state.blocks,
          [sessionId]: [...sessionBlocks, block],
        },
      };
    }),
    
  updateBlock: (sessionId, blockId, updates) =>
    set((state) => {
      const sessionBlocks = state.blocks[sessionId] || [];
      const updated = sessionBlocks.map((b) =>
        b.id === blockId ? { ...b, ...updates } : b
      );
      return {
        blocks: {
          ...state.blocks,
          [sessionId]: updated,
        },
      };
    }),
    
  setRunningBlockId: (sessionId, blockId) =>
    set((state) => ({
      runningBlockId: {
        ...state.runningBlockId,
        [sessionId]: blockId,
      },
    })),
    
  setCommandOutputReceived: (sessionId, received) =>
    set((state) => {
      if (state.commandOutputReceived[sessionId] === received) return state;
      return {
        commandOutputReceived: {
          ...state.commandOutputReceived,
          [sessionId]: received,
        },
      };
    }),
    
  appendBlockOutput: (sessionId, blockId, chunk) => {
    const current = runningOutputs.get(blockId) || "";
    runningOutputs.set(blockId, current + chunk);
  },
    
  setAIExplain: (sessionId, blockId, explain) =>
    set((state) => {
      const sessionBlocks = state.blocks[sessionId] || [];
      const updated = sessionBlocks.map((b) =>
        b.id === blockId ? { ...b, ai_explain: explain } : b
      );
      return {
        blocks: {
          ...state.blocks,
          [sessionId]: updated,
        },
      };
    }),
    
  toggleBookmark: (sessionId, blockId) =>
    set((state) => {
      const sessionBlocks = state.blocks[sessionId] || [];
      const updated = sessionBlocks.map((b) =>
        b.id === blockId ? { ...b, bookmarked: !b.bookmarked } : b
      );
      return {
        blocks: {
          ...state.blocks,
          [sessionId]: updated,
        },
      };
    }),
    
  toggleCollapse: (sessionId, blockId) =>
    set((state) => {
      const sessionBlocks = state.blocks[sessionId] || [];
      const updated = sessionBlocks.map((b) =>
        b.id === blockId ? { ...b, collapsed: !b.collapsed } : b
      );
      return {
        blocks: {
          ...state.blocks,
          [sessionId]: updated,
        },
      };
    }),
    
  clearBlocks: (sessionId) =>
    set((state) => {
      const copy = { ...state.blocks };
      delete copy[sessionId];
      return { blocks: copy };
    }),

  // ── Compound Action Implementations ────────────────────────────────────────
  beginBlockExecution: (sessionId, block) => {
    set((state) => {
      const sessionBlocks = state.blocks[sessionId] || [];
      return {
        blocks: { ...state.blocks, [sessionId]: [...sessionBlocks, block] },
        runningBlockId: { ...state.runningBlockId, [sessionId]: block.id },
        commandOutputReceived: { ...state.commandOutputReceived, [sessionId]: false },
      };
    });
  },

  endBlockExecution: (sessionId) => {
    set((state) => ({
      runningBlockId: { ...state.runningBlockId, [sessionId]: null },
      commandOutputReceived: { ...state.commandOutputReceived, [sessionId]: false },
    }));
  },

  // ── Warp-Style Coordinates API Implementations ─────────────────────────────
  beginBlock: (sessionId, command, anchorRow) => {
    const blockId = "block-" + Math.random().toString(36).substring(2, 11);
    const newBlock: Block = {
      id: blockId,
      session_id: sessionId,
      command,
      started_at: Date.now(),
      status: "running",
      output_type: "plain",
      collapsed: false,
      bookmarked: false,
      output_summary: "",
      anchor_row: anchorRow,
      output_row_end: anchorRow,
      anchor_y: 0,
      output_height_px: undefined,
    };

    set((state) => {
      const sessionBlocks = state.blocks[sessionId] || [];
      return {
        blocks: {
          ...state.blocks,
          [sessionId]: [...sessionBlocks, newBlock],
        },
        runningBlockId: {
          ...state.runningBlockId,
          [sessionId]: blockId,
        },
      };
    });

    return newBlock;
  },

  finalizeBlock: (sessionId, blockId, exitCode) => {
    set((state) => {
      const sessionBlocks = state.blocks[sessionId] || [];
      const outputSummary = runningOutputs.get(blockId) || "";
      runningOutputs.delete(blockId);
      const updated = sessionBlocks.map((b) =>
        b.id === blockId
          ? {
              ...b,
              exit_code: exitCode,
              status: (exitCode === 0 ? "success" : "error") as Block["status"],
              finished_at: Date.now(),
              output_summary: outputSummary,
            }
          : b
      );
      return {
        blocks: {
          ...state.blocks,
          [sessionId]: updated,
        },
        runningBlockId: {
          ...state.runningBlockId,
          [sessionId]: null,
        },
      };
    });
  },

  setAnchorY: (sessionId, anchors) => {
    set((state) => {
      const sessionBlocks = state.blocks[sessionId] || [];
      let changed = false;
      const updated = sessionBlocks.map((b) => {
        const coords = anchors[b.id];
        if (coords) {
          const nextY = coords.y;
          const nextHeight = coords.height ?? b.output_height_px;
          if (b.anchor_y !== nextY || b.output_height_px !== nextHeight) {
            changed = true;
            return {
              ...b,
              anchor_y: nextY,
              output_height_px: nextHeight,
            };
          }
        }
        return b;
      });
      if (!changed) return state;
      return {
        blocks: {
          ...state.blocks,
          [sessionId]: updated,
        },
      };
    });
  },
}));
