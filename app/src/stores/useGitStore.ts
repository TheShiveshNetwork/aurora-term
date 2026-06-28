import { create } from "zustand";
import type { GitStatusEntry, GitBranchInfo, GitLogResult } from "../lib/ipc";

const CACHE_TTL_MS = 5000;
const LOG_CACHE_TTL_MS = 30000;

interface GitCacheEntry {
  status: { data: GitStatusEntry[]; fetchedAt: number } | null;
  branches: { data: GitBranchInfo[]; fetchedAt: number } | null;
  gitLog: { data: GitLogResult; fetchedAt: number } | null;
}

interface GitStore {
  cache: Record<string, GitCacheEntry>;
  gitLogVersion: Record<string, number>;
  getStatus: (cwd: string) => GitStatusEntry[] | null;
  getBranches: (cwd: string) => GitBranchInfo[] | null;
  getGitLog: (cwd: string) => GitLogResult | null;
  setStatus: (cwd: string, status: GitStatusEntry[]) => void;
  setBranches: (cwd: string, branches: GitBranchInfo[]) => void;
  setGitLog: (cwd: string, data: GitLogResult) => void;
  invalidateAll: (cwd: string) => void;
  invalidateStatus: (cwd: string) => void;
  invalidateBranches: (cwd: string) => void;
}

export const useGitStore = create<GitStore>((set, get) => ({
  cache: {},
  gitLogVersion: {},

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

  getGitLog: (cwd) => {
    const entry = get().cache[cwd];
    if (!entry?.gitLog) return null;
    if (Date.now() - entry.gitLog.fetchedAt > LOG_CACHE_TTL_MS) return null;
    return entry.gitLog.data;
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

  setGitLog: (cwd, data) =>
    set((state) => ({
      cache: {
        ...state.cache,
        [cwd]: {
          ...state.cache[cwd],
          gitLog: { data, fetchedAt: Date.now() },
        },
      },
    })),

  invalidateAll: (cwd) =>
    set((state) => ({
      cache: {
        ...state.cache,
        [cwd]: { status: null, branches: null, gitLog: null },
      },
      gitLogVersion: {
        ...state.gitLogVersion,
        [cwd]: (state.gitLogVersion[cwd] || 0) + 1,
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
