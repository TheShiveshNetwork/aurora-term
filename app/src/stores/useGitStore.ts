import { create } from "zustand";
import type { GitStatusEntry, GitBranchInfo } from "../lib/ipc";

const CACHE_TTL_MS = 5000;

interface GitCacheEntry {
  status: { data: GitStatusEntry[]; fetchedAt: number } | null;
  branches: { data: GitBranchInfo[]; fetchedAt: number } | null;
}

interface GitStore {
  cache: Record<string, GitCacheEntry>;
  getStatus: (cwd: string) => GitStatusEntry[] | null;
  getBranches: (cwd: string) => GitBranchInfo[] | null;
  setStatus: (cwd: string, status: GitStatusEntry[]) => void;
  setBranches: (cwd: string, branches: GitBranchInfo[]) => void;
  invalidateAll: (cwd: string) => void;
  invalidateStatus: (cwd: string) => void;
  invalidateBranches: (cwd: string) => void;
}

export const useGitStore = create<GitStore>((set, get) => ({
  cache: {},

  getStatus: (cwd) => {
    const entry = get().cache[cwd];
    if (!entry?.status) return null;
    if (Date.now() - entry.status.fetchedAt > CACHE_TTL_MS) return null;
    return entry.status.data;
  },

  getBranches: (cwd) => {
    const entry = get().cache[cwd];
    if (!entry?.branches) return null;
    if (Date.now() - entry.branches.fetchedAt > CACHE_TTL_MS) return null;
    return entry.branches.data;
  },

  setStatus: (cwd, status) =>
    set((state) => ({
      cache: {
        ...state.cache,
        [cwd]: {
          ...state.cache[cwd],
          status: { data: status, fetchedAt: Date.now() },
        },
      },
    })),

  setBranches: (cwd, branches) =>
    set((state) => ({
      cache: {
        ...state.cache,
        [cwd]: {
          ...state.cache[cwd],
          branches: { data: branches, fetchedAt: Date.now() },
        },
      },
    })),

  invalidateAll: (cwd) =>
    set((state) => ({
      cache: {
        ...state.cache,
        [cwd]: { status: null, branches: null },
      },
    })),

  invalidateStatus: (cwd) =>
    set((state) => ({
      cache: {
        ...state.cache,
        [cwd]: { ...state.cache[cwd], status: null },
      },
    })),

  invalidateBranches: (cwd) =>
    set((state) => ({
      cache: {
        ...state.cache,
        [cwd]: { ...state.cache[cwd], branches: null },
      },
    })),
}));
