import React, { useEffect, useState, useRef, useCallback } from "react";
import { GitBranch, GitCommitHorizontal, Tag, GitFork } from "lucide-react";
import { system, type GitLogResult, type GitCommit, type GitRef } from "../../lib/ipc";
import { useAppShellStore } from "../../stores/useAppShellStore";

const BRANCH_COLORS = [
  "#4F8CFF", "#9A7CFF", "#42C6FF", "#3DDC84", "#FF6B6B",
  "#FFB300", "#FF7043", "#AB47BC", "#26C6DA", "#66BB6A",
];

type LaneState = { hash: string; continuation: boolean; col: number };

function buildLaneLayout(commits: GitCommit[]): { col: number; lanes: LaneState[] }[] {
  const rows: { col: number; lanes: LaneState[] }[] = [];
  const lanes: LaneState[] = [];
  const hashSet = new Set(commits.map((c) => c.hash));

  for (const commit of commits) {
    let laneIdx = lanes.findIndex((l) => l.hash === commit.hash);
    if (laneIdx === -1) {
      lanes.unshift({ hash: commit.hash, continuation: false, col: 0 });
      laneIdx = 0;
    }
    lanes.forEach((l, i) => (l.col = i));

    rows.push({
      col: laneIdx,
      lanes: lanes.map((l) => ({ ...l })),
    });

    const nextLanes: LaneState[] = [];
    let inserted = false;
    for (let i = 0; i < lanes.length; i++) {
      if (i === laneIdx) {
        if (commit.parents.length > 0) {
          nextLanes.push({ hash: commit.parents[0], continuation: hashSet.has(commit.parents[0]), col: nextLanes.length });
        }
        if (commit.parents.length > 1) {
          const p2 = commit.parents[1];
          nextLanes.push({ hash: p2, continuation: hashSet.has(p2), col: nextLanes.length });
        }
        inserted = true;
      } else if (lanes[i].continuation) {
        nextLanes.push({ ...lanes[i], col: nextLanes.length });
      }
    }
    lanes.length = 0;
    lanes.push(...nextLanes);
  }

  return rows;
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffDays === 0) return "today";
    if (diffDays === 1) return "yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return dateStr;
  }
}

function shortHash(hash: string): string {
  return hash.length > 7 ? hash.slice(0, 7) : hash;
}

function getRefsForCommit(hash: string, branches: GitRef[], tags: GitRef[]): { branches: string[]; tags: string[] } {
  return {
    branches: branches.filter((r) => r.commit_hash === hash).map((r) => r.name),
    tags: tags.filter((r) => r.commit_hash === hash).map((r) => r.name),
  };
}

export function GitGraph() {
  const [data, setData] = useState<GitLogResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const cwdAbsolute = useAppShellStore((s) => s.cwdAbsolute);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchLog = useCallback(async () => {
    if (!cwdAbsolute) return;
    setLoading(true);
    setError(null);
    try {
      const result = await system.getGitLog(cwdAbsolute);
      setData(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [cwdAbsolute]);

  useEffect(() => {
    fetchLog();
  }, [fetchLog]);

  useEffect(() => {
    const handler = () => fetchLog();
    window.addEventListener("cwd-change", handler);
    window.addEventListener("fs-tree-changed", handler);
    return () => {
      window.removeEventListener("cwd-change", handler);
      window.removeEventListener("fs-tree-changed", handler);
    };
  }, [fetchLog]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6" style={{ color: "rgba(232,234,240,0.35)" }}>
        <GitCommitHorizontal size={14} className="mr-2 animate-pulse" />
        <span className="text-[11px]">Loading graph...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-3 py-3 text-[11px]" style={{ color: "rgba(232,234,240,0.35)" }}>
        {error.includes("not a git repository") || error.includes("No commits") ? (
          <span>Not a git repository</span>
        ) : (
          <span>Failed to load: {error}</span>
        )}
      </div>
    );
  }

  if (!data || data.commits.length === 0) {
    return (
      <div className="px-3 py-3 text-[11px]" style={{ color: "rgba(232,234,240,0.35)" }}>
        No commits yet
      </div>
    );
  }

  return <GitGraphInner data={data} />;
}

function GitGraphInner({ data }: { data: GitLogResult }) {
  const layout = buildLaneLayout(data.commits);
  const branchColorMap = useRef<Record<string, string>>({});

  const getBranchColor = (name: string): string => {
    if (!branchColorMap.current[name]) {
      const keys = Object.keys(branchColorMap.current);
      branchColorMap.current[name] = BRANCH_COLORS[keys.length % BRANCH_COLORS.length];
    }
    return branchColorMap.current[name];
  };

  return (
    <div className="flex flex-col select-text" style={{ fontSize: 0 }}>
      {data.commits.map((commit, idx) => {
        const row = layout[idx];
        if (!row) return null;
        const refs = getRefsForCommit(commit.hash, data.branches, data.tags);
        const isCurrent = data.current_branch && refs.branches.includes(data.current_branch);

        return (
          <div
            key={commit.hash}
            className="flex items-start py-1.5 px-2 transition-colors"
            style={{ minHeight: "28px" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
          >
            {/* Graph lanes */}
            <div className="flex items-start shrink-0" style={{ fontFamily: "monospace", fontSize: "11px", lineHeight: "18px", letterSpacing: "1px" }}>
              {row.lanes.map((lane, li) => {
                const isCommitLane = li === row.col;
                return (
                  <div key={li} className="flex items-center justify-center" style={{ width: "14px", height: "18px" }}>
                    {isCommitLane ? (
                      <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{
                        background: "#4F8CFF",
                        boxShadow: "0 0 4px rgba(79,140,255,0.4)",
                      }} />
                    ) : lane.continuation ? (
                      <span style={{ color: "rgba(232,234,240,0.2)" }}>
                        {"│"}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>

            {/* Branch / tag labels */}
            <div className="flex items-center gap-1 shrink-0 flex-wrap" style={{ marginRight: "6px", marginTop: "1px" }}>
              {refs.branches.map((name) => (
                <span
                  key={name}
                  className="text-[9px] font-semibold px-1.5 py-0.5 rounded-sm leading-none"
                  style={{
                    background: `${getBranchColor(name)}18`,
                    color: getBranchColor(name),
                    border: `0.5px solid ${getBranchColor(name)}30`,
                  }}
                >
                  {name === data.current_branch ? (
                    <span className="flex items-center gap-0.5">
                      <GitBranch size={8} />
                      {name}
                    </span>
                  ) : name}
                </span>
              ))}
              {refs.tags.map((name) => (
                <span
                  key={name}
                  className="text-[9px] font-semibold px-1.5 py-0.5 rounded-sm leading-none flex items-center gap-0.5"
                  style={{
                    background: "rgba(255,179,0,0.12)",
                    color: "#FFB300",
                    border: "0.5px solid rgba(255,179,0,0.25)",
                  }}
                >
                  <Tag size={8} />
                  {name}
                </span>
              ))}
            </div>

            {/* Commit message + meta */}
            <div className="flex-1 min-w-0 overflow-hidden">
              <div className="flex items-baseline gap-1.5">
                <span
                  className="truncate text-[12px] leading-[18px]"
                  style={{ color: isCurrent ? "#E8EAF0" : "rgba(232,234,240,0.78)" }}
                >
                  {commit.message}
                </span>
                <span className="text-[9px] shrink-0 font-mono" style={{ color: "rgba(232,234,240,0.25)" }}>
                  {shortHash(commit.hash)}
                </span>
              </div>
              <div className="flex items-center gap-2 text-[10px] leading-[14px]" style={{ color: "rgba(232,234,240,0.35)" }}>
                <span>{commit.author}</span>
                <span>·</span>
                <span>{formatDate(commit.date)}</span>
              </div>
            </div>
          </div>
        );
      })}

      {data.branches.length > 0 && data.tags.length > 0 && (
        <div className="border-t border-outline-variant/10 mt-1 pt-2 px-3 pb-1 flex flex-wrap gap-2">
          {data.branches.map((b) => {
            if (b.name === data.current_branch) return null;
            return (
              <span
                key={b.name}
                className="text-[9px] font-semibold px-1.5 py-0.5 rounded-sm leading-none"
                style={{
                  background: `${getBranchColor(b.name)}18`,
                  color: getBranchColor(b.name),
                  border: `0.5px solid ${getBranchColor(b.name)}30`,
                }}
              >
                <span className="flex items-center gap-0.5">
                  <GitBranch size={8} />
                  {b.name}
                </span>
              </span>
            );
          })}
          {data.tags.map((t) => (
            <span
              key={t.name}
              className="text-[9px] font-semibold px-1.5 py-0.5 rounded-sm leading-none flex items-center gap-0.5"
              style={{
                background: "rgba(255,179,0,0.12)",
                color: "#FFB300",
                border: "0.5px solid rgba(255,179,0,0.25)",
              }}
            >
              <Tag size={8} />
              {t.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
