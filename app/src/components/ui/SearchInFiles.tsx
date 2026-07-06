import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  Search, X, FileCode, ChevronRight, ChevronDown, CaseSensitive,
  ArrowUp, ArrowDown, Replace, Plus, Minus, Loader, MoreHorizontal,
} from "lucide-react";
import { useSearchStore } from "../../stores/useSearchStore";
import { Button } from "../ui/Button";
import type { SearchResult } from "@aurora/types";

interface SearchInFilesProps {
  onOpenFileAtPath?: (path: string) => void;
}

function highlightMatch(line: string, matchStart: number, matchEnd: number) {
  return (
    <>
      <span>{line.slice(0, matchStart)}</span>
      <span style={{ color: "#FFD700", background: "rgba(255,215,0,0.12)" }}>
        {line.slice(matchStart, matchEnd)}
      </span>
      <span>{line.slice(matchEnd)}</span>
    </>
  );
}

export function SearchInFiles({ onOpenFileAtPath }: SearchInFilesProps) {
  const {
    query, setQuery, replaceQuery, setReplaceQuery,
    replaceExpanded, toggleReplaceExpanded,
    filtersExpanded, toggleFiltersExpanded,
    includePatterns, setIncludePatterns,
    excludePatterns, setExcludePatterns,
    caseSensitive, toggleCaseSensitive,
    results, isSearching, hasSearched, search, close, isOpen,
  } = useSearchStore();

  const inputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Debounced auto-search
  const prevQueryRef = useRef(query);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    // If query became empty after having content, reset to initial state
    if (prevQueryRef.current && !query.trim()) {
      useSearchStore.getState().clearResults();
      prevQueryRef.current = query;
      return;
    }
    prevQueryRef.current = query;

    if (!query.trim()) {
      useSearchStore.getState().setSearching(false);
      return;
    }

    useSearchStore.getState().setSearching(true);
    debounceRef.current = setTimeout(() => {
      search();
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, includePatterns, excludePatterns, caseSensitive]);

  const totalMatches = useMemo(
    () => results.reduce((acc, r) => acc + r.matches.length, 0),
    [results],
  );

  // Auto-expand files with <= 5 matches; collapse those with more
  useEffect(() => {
    if (!hasSearched || results.length === 0) return;
    const autoExpand = new Set<string>();
    for (const r of results) {
      if (r.matches.length <= 5) autoExpand.add(r.path);
    }
    setExpandedFiles(autoExpand);
  }, [results, hasSearched]);

  const toggleFile = useCallback((path: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const handleResultClick = useCallback(
    (path: string) => {
      onOpenFileAtPath?.(path);
    },
    [onOpenFileAtPath],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") close();
    },
    [close],
  );

  return (
      <div className="flex flex-col h-full overflow-hidden select-none" style={{ background: "#0F131A" }}>
      {/* ─── Search Header ─── */}
      <div className="shrink-0">
        {/* Search input row */}
        <div className="flex items-center gap-1 px-2 pt-2 pb-1">
          {/* Chevron to toggle replace */}
          <button
            onClick={toggleReplaceExpanded}
            className="flex items-center justify-center rounded cursor-pointer flex-shrink-0 transition-colors"
            style={{ color: "rgba(232,234,240,0.3)" }}
            title="Toggle replace"
          >
            {replaceExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>

          {/* Search field */}
          <div
            className="relative flex-1 flex items-center gap-1.5 px-2 py-1 rounded min-w-0"
            style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}
          >
            {!query && <Search size={12} style={{ color: "rgba(232,234,240,0.3)", flexShrink: 0 }} /> }
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search in files..."
              className="flex-1 min-w-0 bg-transparent outline-none text-xs"
              style={{ color: "#E8EAF0" }}
            />

            {/* Case sensitive toggle */}
            <button
              onClick={toggleCaseSensitive}
              className="absolute right-0 flex h-6 w-6 text-xs items-center justify-center rounded cursor-pointer transition-colors flex-shrink-0"
              style={{
                color: caseSensitive ? "#4F8CFF" : "rgba(232,234,240,0.35)",
                background: caseSensitive ? "rgba(79,140,255,0.12)" : "transparent",
                flexShrink: 0,
              }}
              title="Case sensitive"
            >
              Aa
            </button>
          </div>

            <Button
              onClick={toggleFiltersExpanded}
              variant="secondary"
              style={{ padding: "6px"}}
              title="Toggle file filters"
            >
              <MoreHorizontal size={12} />
            </Button>
        </div>

        {/* Replace input row */}
        {replaceExpanded && (
          <div className="flex items-center gap-1 pr-2 pb-1">
            <div className="w-5 flex-shrink-0" />
            <div
              className="flex-1 flex items-center gap-1.5 px-2 py-1 rounded min-w-0"
              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}
            >
              {!replaceQuery && <Replace size={12} style={{ color: "rgba(232,234,240,0.3)", flexShrink: 0 }} /> }
              <input
                ref={replaceInputRef}
                type="text"
                value={replaceQuery}
                onChange={(e) => setReplaceQuery(e.target.value)}
                placeholder="Replace with..."
                className="flex-1 min-w-0 bg-transparent outline-none text-xs"
                style={{ color: "#E8EAF0" }}
              />
            </div>
            <Button
              variant="primary"
              className="w-6 h-6 text-[10px] font-medium rounded-xs"
              title="Replace all matches"
            >
              All
            </Button>
          </div>
        )}

        {/* Include/Exclude inputs */}
        {filtersExpanded && (
          <div className="px-3 pb-2">
              <span
                className="text-[10px] font-medium tracking-wider flex-shrink-0"
              >
                Files to include
              </span>
              <input
                type="text"
                value={includePatterns}
                onChange={(e) => setIncludePatterns(e.target.value)}
                placeholder="e.g. *.ts, src/**"
                className="flex-1 w-full min-w-0 bg-transparent outline-none text-[11px] px-2 py-1 rounded"
                style={{ color: "#E8EAF0", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
              />
              <span
                className="text-[10px] font-medium tracking-wider flex-shrink-0"
              >
                Files to exclude
              </span>
              <input
                type="text"
                value={excludePatterns}
                onChange={(e) => setExcludePatterns(e.target.value)}
                placeholder="e.g. node_modules/**"
                className="flex-1 w-full min-w-0 bg-transparent outline-none text-[11px] px-2 py-1 rounded"
                style={{ color: "#E8EAF0", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
              />
          </div>
        )}
      </div>

      {/* ─── Results ─── */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {/* Loading */}
        {isSearching && (
          <div className="flex items-center justify-center gap-2 py-8">
            <Loader size={14} className="animate-spin" style={{ color: "rgba(232,234,240,0.35)" }} />
            <span className="text-[11px]" style={{ color: "rgba(232,234,240,0.35)" }}>Searching...</span>
          </div>
        )}

        {/* No results */}
        {!isSearching && hasSearched && results.length === 0 && query.trim() && (
          <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
            <FileCode size={20} style={{ color: "rgba(232,234,240,0.15)", marginBottom: "6px" }} />
            <span className="text-[11px]" style={{ color: "rgba(232,234,240,0.25)" }}>
              No results found
            </span>
          </div>
        )}

        {/* Results list */}
        {!isSearching && hasSearched && results.length > 0 && (
          <div className="py-1">
            {results.map((result) => {
              const isExpanded = expandedFiles.has(result.path);
              const matchCount = result.matches.length;

              return (
                <div key={result.path}>
                  {/* File header */}
                  <button
                    onClick={() => toggleFile(result.path)}
                    className="w-full flex items-center gap-1 px-3 py-1 text-left cursor-pointer transition-colors hover:bg-white/5"
                  >
                    {isExpanded ? (
                      <ChevronDown size={10} style={{ color: "rgba(232,234,240,0.25)", flexShrink: 0 }} />
                    ) : (
                      <ChevronRight size={10} style={{ color: "rgba(232,234,240,0.25)", flexShrink: 0 }} />
                    )}
                    <FileCode size={11} style={{ color: "rgba(232,234,240,0.3)", flexShrink: 0 }} />
                    <span className="text-[11px] font-medium truncate" style={{ color: "rgba(232,234,240,0.7)" }}>
                      {result.path}
                    </span>
                    <span className="text-[10px] ml-auto flex-shrink-0" style={{ color: "rgba(232,234,240,0.25)" }}>
                      {matchCount} match{matchCount !== 1 ? "es" : ""}
                    </span>
                  </button>

                  {/* Match lines */}
                  {isExpanded &&
                    result.matches.map((match, mi) => (
                      <button
                        key={mi}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleResultClick(result.path);
                        }}
                        className="w-full flex items-start gap-1 px-3 py-0.5 text-left cursor-pointer transition-colors hover:bg-white/5"
                        style={{ paddingLeft: "32px" }}
                      >
                        <span
                          className="text-[10px] font-mono flex-shrink-0 mt-[2px]"
                          style={{ color: "rgba(232,234,240,0.2)", minWidth: "32px" }}
                        >
                          {match.line_number}
                        </span>
                        <span
                          className="text-[11px] font-mono truncate leading-tight"
                          style={{ color: "rgba(232,234,240,0.5)" }}
                        >
                          {highlightMatch(match.line, match.match_start, match.match_end)}
                        </span>
                      </button>
                    ))}
                </div>
              );
            })}
          </div>
        )}

        {/* Initial hint */}
        {!hasSearched && !isSearching && (
          <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
            <Search size={20} style={{ color: "rgba(232,234,240,0.12)", marginBottom: "8px" }} />
            <span className="text-[11px]" style={{ color: "rgba(232,234,240,0.2)" }}>
              Type to search across all files
            </span>
          </div>
        )}
      </div>

      {/* Status bar */}
      {hasSearched && !isSearching && (
        <div
          className="shrink-0 px-3 py-1 text-[10px] text-center select-none"
          style={{
            color: "rgba(232,234,240,0.25)",
            borderTop: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          {results.length > 0
            ? `${totalMatches} result${totalMatches !== 1 ? "s" : ""} in ${results.length} file${results.length !== 1 ? "s" : ""}`
            : query.trim()
              ? "No results"
              : "Enter a query to search"}
        </div>
      )}
    </div>
  );
}
