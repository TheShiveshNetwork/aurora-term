import { create } from "zustand";
import { Block } from "../types/block";

interface BlockStore {
  blocks: Record<string, Block[]>; // keyed by session_id
  runningBlockId: Record<string, string | null>; // keyed by session_id
  addBlock: (sessionId: string, block: Block) => void;
  updateBlock: (sessionId: string, blockId: string, updates: Partial<Block>) => void;
  setRunningBlockId: (sessionId: string, blockId: string | null) => void;
  appendBlockOutput: (sessionId: string, blockId: string, chunk: string) => void;
  setAIExplain: (sessionId: string, blockId: string, explain: string) => void;
  toggleBookmark: (sessionId: string, blockId: string) => void;
  toggleCollapse: (sessionId: string, blockId: string) => void;
  clearBlocks: (sessionId: string) => void;
}

export const useBlockStore = create<BlockStore>((set) => ({
  blocks: {},
  runningBlockId: {},
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
  appendBlockOutput: (sessionId, blockId, chunk) =>
    set((state) => {
      const sessionBlocks = state.blocks[sessionId] || [];
      const updated = sessionBlocks.map((b) =>
        b.id === blockId
          ? { ...b, output_summary: (b.output_summary || "") + chunk }
          : b
      );
      return {
        blocks: {
          ...state.blocks,
          [sessionId]: updated,
        },
      };
    }),
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
}));
