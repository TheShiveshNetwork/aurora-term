import { useEffect, useState, useCallback, useRef } from "react";
import { GitCommitHorizontal } from "lucide-react";
import { system, type GitLogResult } from "../../lib/ipc";
import { useAppShellStore } from "../../stores/useAppShellStore";
import { useSessionStore } from "../../stores/useSessionStore";
import { relativeDate } from "../../lib/time";
import { getFileDiffAtCommit, openDiffTab } from "../../lib/gitUtils";

export function FileTimeline({ filePath }: { filePath?: string }) {
  const [data, setData] = useState<GitLogResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cwdAbsolute = useAppShellStore((s) => s.projectDir || s.cwdAbsolute);
  const addTab = useSessionStore((s) => s.addTab);
  const setActiveTabId = useSessionStore((s) => s.setActiveTabId);

  const fetchLog = useCallback(async () => {
    if (!cwdAbsolute || !filePath) return;
    setLoading(true);
    setError(null);
    try {
      const result = await system.getGitFileLog(cwdAbsolute, filePath);
      setData(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [cwdAbsolute, filePath]);

  useEffect(() => {
    fetchLog();
  }, [fetchLog]);

  const handleSelectCommit = useCallback(async (hash: string) => {
    if (!cwdAbsolute || !filePath) return;
    try {
      const [oldContent, newContent] = await getFileDiffAtCommit(cwdAbsolute, filePath, hash);
      openDiffTab(addTab, setActiveTabId, filePath, hash, oldContent, newContent);
    } catch {
      // silent
    }
  }, [cwdAbsolute, filePath, addTab, setActiveTabId]);

  if (!filePath) {
    return <div className="px-3 py-2 text-sm" style={{ color: "rgba(232,234,240,0.25)" }}>No file open</div>;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4" style={{ color: "rgba(232,234,240,0.25)" }}>
        <GitCommitHorizontal size={13} className="mr-2 animate-pulse" />
        <span className="text-sm">Loading history...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-3 py-2 text-sm" style={{ color: "rgba(232,234,240,0.35)" }}>
        {error.includes("not a git repository") || error.includes("No commits") ? (
          <span>Not a git repository</span>
        ) : (
          <span>Failed to load history</span>
        )}
      </div>
    );
  }

  if (!data || data.commits.length === 0) {
    return <div className="px-3 py-2 text-sm" style={{ color: "rgba(232,234,240,0.25)" }}>No history for this file</div>;
  }

  return (
    <div className="flex flex-col overflow-x-hidden">
      <div className="flex flex-col">
        {data.commits.map((commit) => {
          const shortMsg = commit.message.split("\n")[0];

          return (
            <div
              key={commit.hash}
              className="flex items-center gap-2 px-3 py-1.5 transition-colors cursor-pointer border-b border-outline-variant/5 last:border-b-0"
              onClick={() => handleSelectCommit(commit.hash)}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              <span style={{ color: "rgba(232,234,240,0.3)", fontSize: "10px" }}>◆</span>
              <div className="flex-1 min-w-0">
                <div className="truncate text-sm" style={{ color: "rgba(232,234,240,0.65)" }}>
                  {shortMsg}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0 text-xs" style={{ color: "rgba(232,234,240,0.25)" }}>
                <span>{relativeDate(commit.date)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
