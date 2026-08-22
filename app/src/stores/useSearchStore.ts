import { create } from "zustand";
import type { SearchResult } from "@aurora/types";
import { system } from "../lib/ipc";
import { useAppShellStore } from "./useAppShellStore";

interface SearchStore {
  isOpen: boolean;
  query: string;
  replaceQuery: string;
  replaceExpanded: boolean;
  filtersExpanded: boolean;
  includePatterns: string;
  excludePatterns: string;
  caseSensitive: boolean;
  results: SearchResult[];
  isSearching: boolean;
  hasSearched: boolean;
  searchGeneration: number;

  open: () => void;
  close: () => void;
  toggle: () => void;
  setQuery: (query: string) => void;
  setReplaceQuery: (q: string) => void;
  toggleReplaceExpanded: () => void;
  toggleFiltersExpanded: () => void;
  setIncludePatterns: (v: string) => void;
  setExcludePatterns: (v: string) => void;
  toggleCaseSensitive: () => void;
  setResults: (results: SearchResult[]) => void;
  setSearching: (v: boolean) => void;
  clearResults: () => void;
  search: () => Promise<void>;
  refreshResults: () => Promise<void>;
}

export const useSearchStore = create<SearchStore>((set, get) => ({
  isOpen: false,
  query: "",
  replaceQuery: "",
  replaceExpanded: false,
  filtersExpanded: false,
  includePatterns: "",
  excludePatterns: "",
  caseSensitive: false,
  results: [],
  isSearching: false,
  hasSearched: false,
  searchGeneration: 0,

  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false, query: "", replaceQuery: "", results: [], hasSearched: false, includePatterns: "", excludePatterns: "", replaceExpanded: false, filtersExpanded: false }),
  toggle: () => set((s) => ({ isOpen: !s.isOpen, query: "", replaceQuery: "", results: [], hasSearched: false, includePatterns: "", excludePatterns: "", replaceExpanded: false, filtersExpanded: false })),

  setQuery: (query) => set({ query }),
  setReplaceQuery: (replaceQuery) => set({ replaceQuery }),
  toggleReplaceExpanded: () => set((s) => ({ replaceExpanded: !s.replaceExpanded })),
  toggleFiltersExpanded: () => set((s) => ({ filtersExpanded: !s.filtersExpanded })),
  setIncludePatterns: (includePatterns) => set({ includePatterns }),
  setExcludePatterns: (excludePatterns) => set({ excludePatterns }),
  toggleCaseSensitive: () => set((s) => ({ caseSensitive: !s.caseSensitive })),
  setResults: (results) => set({ results }),
  setSearching: (isSearching) => set({ isSearching }),
  clearResults: () => set((s) => ({
    results: [],
    hasSearched: false,
    isSearching: false,
    searchGeneration: s.searchGeneration + 1,
  })),

  search: async () => {
    const { query, includePatterns, excludePatterns, caseSensitive } = get();
    if (!query.trim()) return;

    const projectDir = useAppShellStore.getState().projectDir;
    if (!projectDir) return;

    const generation = get().searchGeneration + 1;
    set({ isSearching: true, hasSearched: true, searchGeneration: generation });

    try {
      const includeList = includePatterns
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const excludeList = excludePatterns
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const results = await system.searchInFiles(
        projectDir,
        query.trim(),
        includeList,
        excludeList,
        caseSensitive,
        2000,
      );

      // Only apply results if this is still the latest search
      if (get().searchGeneration === generation) {
        set({ results, isSearching: false });
      }
    } catch {
      if (get().searchGeneration === generation) {
        set({ isSearching: false });
      }
    }
  },

  // Silently re-run the current search (no loading flicker) so results stay in
  // sync when files change on disk while the panel is open.
  refreshResults: async () => {
    const { query, includePatterns, excludePatterns, caseSensitive, isSearching } = get();
    if (!query.trim() || isSearching) return;

    const projectDir = useAppShellStore.getState().projectDir;
    if (!projectDir) return;

    const generation = get().searchGeneration + 1;
    set({ searchGeneration: generation });

    try {
      const includeList = includePatterns
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const excludeList = excludePatterns
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const results = await system.searchInFiles(
        projectDir,
        query.trim(),
        includeList,
        excludeList,
        caseSensitive,
        2000,
      );

      if (get().searchGeneration === generation) {
        set({ results, hasSearched: true });
      }
    } catch {
      // Keep previous results if the refresh fails
    }
  },
}));
