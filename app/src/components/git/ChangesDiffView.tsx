import { useState, useEffect, useCallback } from "react";
import { ChevronDown, X, FileSymlink } from "lucide-react";
import type { GitStatusEntry } from "../../lib/ipc";
import { system } from "../../lib/ipc";
import { CommitDiffView } from "../editor/CommitDiffView";
import { IconButton } from "../ui/IconButton";
import { LoadingSpinner } from "../ui/LoadingSpinner";

interface FileDiffEntry {
  path: string;
  diff: string;
  added: number;
  removed: number;
  loading: boolean;
  error?: string;
}

function countDiffLines(diff: string): { added: number; removed: number } {
  let added = 0, removed = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) added++;
    if (line.startsWith("-") && !line.startsWith("---")) removed++;
  }
  return { added, removed };
}

const STATUS_COLOR: Record<string, string> = {
  M: "rgba(255,179,0,0.75)",
  A: "rgba(80,227,194,0.75)",
  D: "rgba(255,107,107,0.75)",
  R: "rgba(79,140,255,0.75)",
  "?": "rgba(232,234,240,0.35)",
};

function statusIcon(x: string, y: string): string {
  if (x === "?") return "A";
  if (x !== " ") return x;
  return y === "?" ? "A" : y;
}

function statusColor(x: string, y: string): string {
  if (x === "?" || y === "?") return STATUS_COLOR.A;
  const k = x !== " " ? x : y;
  return STATUS_COLOR[k] || "rgba(232,234,240,0.35)";
}

interface ChangesDiffViewProps {
  files: GitStatusEntry[];
  cwd: string;
  onClose: () => void;
  onOpenFile: (path: string) => void;
}

export function ChangesDiffView({ files, cwd, onClose, onOpenFile }: ChangesDiffViewProps) {
  const [entries, setEntries] = useState<Record<string, FileDiffEntry>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const entriesRef = useState<Record<string, FileDiffEntry>>({})[0];

  // Reverse order: newest files at top
  const reversed = [...files].reverse();

  const loadDiff = useCallback(async (path: string) => {
    if (entriesRef[path]?.diff) return;
    setEntries(prev => ({ ...prev, [path]: { path, diff: "", added: 0, removed: 0, loading: true } }));
    entriesRef[path] = { path, diff: "", added: 0, removed: 0, loading: true };
    try {
      const diff = await system.gitDiffUnstaged(cwd, path);
      const { added, removed } = countDiffLines(diff);
      const entry: FileDiffEntry = { path, diff, added, removed, loading: false };
      setEntries(prev => ({ ...prev, [path]: entry }));
      entriesRef[path] = entry;
    } catch {
      const entry: FileDiffEntry = { path, diff: "", added: 0, removed: 0, loading: false, error: "Failed to load diff" };
      setEntries(prev => ({ ...prev, [path]: entry }));
      entriesRef[path] = entry;
    }
  }, [cwd]);

  // Load all diffs on mount
  useEffect(() => {
    for (const file of files) {
      loadDiff(file.path);
    }
  }, [files, loadDiff]);

  const toggleExpanded = (path: string) => {
    setExpanded(prev => ({ ...prev, [path]: !prev[path] }));
  };

  const totalAdded = Object.values(entries).reduce((sum, e) => sum + e.added, 0);
  const totalRemoved = Object.values(entries).reduce((sum, e) => sum + e.removed, 0);

  return (
    <div className="flex flex-col h-full select-text">
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 shrink-0 border-b gap-1"
        style={{ borderColor: "rgba(255,255,255,0.05)", minHeight: 28 }}
      >
        <span className="text-[11px] truncate" style={{ color: "rgba(232,234,240,0.5)" }}>
          Changes
          {totalAdded > 0 && <span className="ml-1" style={{ color: "rgba(80,227,194,0.7)" }}>+{totalAdded}</span>}
          {totalRemoved > 0 && <span className="ml-1" style={{ color: "rgba(255,107,107,0.7)" }}>-{totalRemoved}</span>}
        </span>
        <div className="flex items-center gap-0.5">
          <IconButton icon={<X />} tooltip="Close changes view" onClick={onClose} size="sm" className="w-5 h-5 [&_svg]:w-3 [&_svg]:h-3" />
        </div>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto">
        {reversed.map((file) => {
          const entry = entries[file.path];
          const isExpanded = expanded[file.path];

          return (
            <div key={file.path} className="border-b" style={{ borderColor: "rgba(255,255,255,0.04)" }}>
              {/* Collapse header */}
              <div
                className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-white/[0.03] transition-colors"
                onClick={() => toggleExpanded(file.path)}
              >
                <ChevronDown
                  size={12}
                  className="shrink-0 transition-transform duration-150"
                  style={{
                    color: "rgba(232,234,240,0.3)",
                    transform: isExpanded ? "rotate(0deg)" : "rotate(-90deg)",
                  }}
                />
                <span
                  className="text-[9px] font-mono shrink-0 px-1 rounded"
                  style={{
                    color: statusColor(file.x, file.y),
                    background: `${statusColor(file.x, file.y)}15`,
                  }}
                >
                  {statusIcon(file.x, file.y)}
                </span>
                <span className="text-[12px] truncate flex-1" style={{ color: "rgba(232,234,240,0.75)" }}>
                  {file.path}
                </span>
                {entry && !entry.loading && (
                  <span className="text-[10px] shrink-0 font-medium" style={{ color: "rgba(232,234,240,0.25)" }}>
                    {entry.added > 0 && <span style={{ color: "rgba(80,227,194,0.7)" }}>+{entry.added}</span>}
                    {entry.added > 0 && entry.removed > 0 && <span className="mx-0.5"> </span>}
                    {entry.removed > 0 && <span style={{ color: "rgba(255,107,107,0.7)" }}>-{entry.removed}</span>}
                    {entry.added === 0 && entry.removed === 0 && <span>0</span>}
                  </span>
                )}
                {entry?.loading && (
                  <LoadingSpinner size={10} inline className="opacity-40" />
                )}
                <IconButton
                  icon={<FileSymlink />}
                  tooltip="Open file"
                  onClick={(e) => { e.stopPropagation(); onOpenFile(file.path); }}
                  size="sm"
                  className="w-5 h-5 [&_svg]:w-[11px] [&_svg]:h-[11px] opacity-0 group-hover:opacity-100"
                />
              </div>

              {/* Diff content (collapsible) */}
              {isExpanded && entry && (
                <div className="border-t" style={{ borderColor: "rgba(255,255,255,0.04)" }}>
                  {entry.loading ? (
                    <div className="flex items-center justify-center py-4">
                      <LoadingSpinner size={12} inline className="opacity-40" />
                    </div>
                  ) : entry.error ? (
                    <div className="px-3 py-2 text-[11px]" style={{ color: "rgba(255,107,107,0.6)" }}>
                      {entry.error}
                    </div>
                  ) : (
                    <div className="max-h-[500px] overflow-y-auto">
                      <CommitDiffView
                        diff={entry.diff}
                        commitHash=""
                        filePath={file.path}
                        showBreadcrumb={false}
                        collapsible={true}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Summary footer */}
      {Object.keys(entries).length > 0 && (
        <div
          className="shrink-0 px-3 py-2 border-t text-[10px]"
          style={{ borderColor: "rgba(255,255,255,0.05)", color: "rgba(232,234,240,0.3)" }}
        >
          {files.length} file{files.length !== 1 ? "s" : ""} changed
          {totalAdded > 0 && <span className="ml-1" style={{ color: "rgba(80,227,194,0.6)" }}>+{totalAdded}</span>}
          {totalRemoved > 0 && <span className="ml-1" style={{ color: "rgba(255,107,107,0.6)" }}>-{totalRemoved}</span>}
        </div>
      )}
    </div>
  );
}
