import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { system, type GitLogResult, type ChangedFile } from "../../lib/ipc";
import { useAppShellStore } from "../../stores/useAppShellStore";
import { useSessionStore } from "../../stores/useSessionStore";
import { relativeDate } from "../../lib/time";
import { getFileDiffAtCommit, openDiffTab } from "../../lib/gitUtils";
import { LoadingSpinner } from "./LoadingSpinner";
import { ScrollLoader } from "./ScrollLoader";

// ─── constants ────────────────────────────────────────────────────────────────
const BRANCH_COLORS = [
  "#FFB300", // main  (amber)
  "#4F8CFF", // lane1 (blue)
  "#FF6B6B", // lane2 (red)
  "#50E3C2", // lane3 (teal)
  "#9A7CFF", // lane4 (purple)
  "#FF7043", // lane5
  "#42C6FF",
  "#69F0AE",
  "#FF80AB",
  "#B388FF",
];

const ROW_H = 20;     // px per commit row
const FILE_ROW_H = 18; // px per file row in expanded area
const LANE_W = 12;     // px per graph lane
const DOT_R = 2.5;    // commit dot radius
const LINE_W = 1.5;    // branch line width

interface CommitLayout {
  rowIndex: number;
  y: number;
  height: number;
  expanded: boolean;
  expandedHeight: number;
}

const STATUS_ICON: Record<string, string> = { M: "◆", A: "+", D: "−", R: "→", C: "+" };
const STATUS_COLOR: Record<string, string> = {
  M: "rgba(255,179,0,0.75)",
  A: "rgba(80,227,194,0.75)",
  D: "rgba(255,107,107,0.75)",
  R: "rgba(79,140,255,0.75)",
  C: "rgba(80,227,194,0.75)",
};

// ─── graph computation ────────────────────────────────────────────────────────
interface GraphData {
  branchColors: Record<string, string>;
  currentBranch: string;
  commitColors: Record<string, string>;
  branchByHash: Record<string, string[]>;
  commitLane: Record<string, number>;
  nLanes: number;
}

function buildGraphData(data: GitLogResult): GraphData {
  const { commits, branches, current_branch } = data;
  const currentBranch = current_branch || "main";

  // branch-tip hash → branch names
  const branchByHash: Record<string, string[]> = {};
  for (const b of branches) {
    (branchByHash[b.commit_hash] ??= []).push(b.name);
  }

  // colour per branch — main always gets index 0
  const branchColors: Record<string, string> = {};
  branchColors[currentBranch] = BRANCH_COLORS[0];
  let ci = 1;
  for (const b of branches) {
    if (!branchColors[b.name]) {
      branchColors[b.name] = BRANCH_COLORS[ci % BRANCH_COLORS.length];
      ci++;
    }
  }

  // ── lane assignment ──────────────────────────────────────────────────────
  // Main branch is always lane 0. We detect whether a commit is on main by
  // walking parents: if a commit is reachable from the currentBranch tip it
  // stays on lane 0.  Everything else gets lane 1+.
  const mainTipHash = branches.find(b => b.name === currentBranch)?.commit_hash;
  const mainSet = new Set<string>();
  if (mainTipHash) {
    const hashIdx: Record<string, number> = {};
    commits.forEach((c, i) => (hashIdx[c.hash] = i));
    const q = [mainTipHash];
    while (q.length) {
      const h = q.pop()!;
      if (mainSet.has(h)) continue;
      mainSet.add(h);
      const ci2 = hashIdx[h];
      if (ci2 == null) continue;
      // only follow the *first* parent to stay on the main spine
      const firstParent = commits[ci2].parents[0];
      if (firstParent) q.push(firstParent);
    }
  }

  // active branch lanes: branchName → lane number
  const branchLane: Record<string, number> = {};
  let nextLane = 1;

  const commitLane: Record<string, number> = {};
  const commitColors: Record<string, string> = {};

  for (const c of commits) {
    const tags = branchByHash[c.hash] || [];

    if (mainSet.has(c.hash)) {
      // ── spine commit ──────────────────────────────────────────────────
      commitLane[c.hash] = 0;
      commitColors[c.hash] = BRANCH_COLORS[0];

      // if this commit is the tip of any non-main branch, open that lane
      for (const t of tags) {
        if (t !== currentBranch && branchLane[t] == null) {
          branchLane[t] = nextLane++;
        }
      }

      // close lanes for branches that merged here (second+ parents)
      for (const p of c.parents.slice(1)) {
        // find which branch this parent belongs to and free the lane
        // (we don't need to do anything explicit; nextLane just keeps growing)
      }
    } else {
      // ── off-spine commit ──────────────────────────────────────────────
      // determine which branch this commit belongs to
      const branchName =
        tags.find(t => t !== currentBranch) ??
        (() => {
          // propagate from children: find a child whose branch we know
          // (commits are newest-first, so children are earlier in array)
          return undefined;
        })();

      let lane = 1;
      if (branchName && branchLane[branchName] != null) {
        lane = branchLane[branchName];
      } else if (branchName) {
        branchLane[branchName] = nextLane;
        lane = nextLane++;
      }

      commitLane[c.hash] = lane;
      const color =
        branchName ? (branchColors[branchName] ?? BRANCH_COLORS[lane % BRANCH_COLORS.length])
          : BRANCH_COLORS[lane % BRANCH_COLORS.length];
      commitColors[c.hash] = color;
    }
  }

  const nLanes = Math.max(1, nextLane);
  return { branchColors, currentBranch, commitColors, branchByHash, commitLane, nLanes };
}

// ─── canvas draw ──────────────────────────────────────────────────────────────
interface CommitBounds {
  center: number;
  top: number;
  bottom: number;
}

function drawGraph(
  canvas: HTMLCanvasElement,
  commits: GitLogResult["commits"],
  graph: GraphData,
  dpr: number,
  w: number,
  commitCenters: Record<string, number>,
  totalHeight: number,
  commitBounds?: Record<string, CommitBounds>,
  laneWidth: number = LANE_W,
) {
  const { commitLane, commitColors, branchByHash, currentBranch } = graph;
  const ctx = canvas.getContext("2d")!;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w * dpr, totalHeight * dpr);
  ctx.scale(dpr, dpr);

  const lx = (lane: number) => (lane + 0.5) * laneWidth;

  // ── draw edges ────────────────────────────────────────────────────────────
  for (let i = 0; i < commits.length; i++) {
    const c = commits[i];
    const cLane = commitLane[c.hash] ?? 0;
    const color = commitColors[c.hash] ?? "rgba(232,234,240,0.3)";
    const cy1 = commitCenters[c.hash] ?? (i + 0.5) * ROW_H;
    const top1 = commitBounds?.[c.hash]?.top ?? cy1 - ROW_H / 2;
    const bot1 = commitBounds?.[c.hash]?.bottom ?? cy1 + ROW_H / 2;

    for (const p of c.parents) {
      const pCy = commitCenters[p];
      if (pCy == null) continue;
      const pLane = commitLane[p] ?? 0;
      const pColor = commitColors[p] ?? color;
      const top2 = commitBounds?.[p]?.top ?? pCy - ROW_H / 2;
      const bot2 = commitBounds?.[p]?.bottom ?? pCy + ROW_H / 2;

      if (commitBounds) {
        // expanded — vertical column lines + center-to-center connector
        const cx = lx(cLane);
        const px = lx(cLane === pLane ? cLane : pLane);

        // vertical through current row — only top→center for off-spine lanes (no tail below dot)
        ctx.beginPath();
        ctx.lineWidth = LINE_W;
        ctx.globalAlpha = 0.65;
        ctx.strokeStyle = color;
        ctx.moveTo(cx, top1);
        ctx.lineTo(cx, cLane === 0 ? bot1 : cy1);
        ctx.stroke();

        // connector — center to center (matches the dot position)
        ctx.beginPath();
        ctx.lineWidth = LINE_W;
        ctx.globalAlpha = 0.65;
        ctx.moveTo(cx, cy1);
        if (cLane === pLane) {
          ctx.strokeStyle = pColor;
          ctx.lineTo(px, pCy);
        } else if (cLane === 0) {
          ctx.strokeStyle = color;
          const cpY = pCy - ROW_H * 0.4;
          ctx.bezierCurveTo(cx, cpY, px, cpY, px, pCy);
        } else {
          ctx.strokeStyle = color;
          const cpY = cy1 + ROW_H * 0.4;
          ctx.bezierCurveTo(cx, cpY, px, cpY, px, pCy);
        }
        ctx.stroke();

        // vertical through parent row
        ctx.beginPath();
        ctx.lineWidth = LINE_W;
        ctx.globalAlpha = 0.65;
        ctx.strokeStyle = pColor;
        ctx.moveTo(px, top2);
        ctx.lineTo(px, bot2);
        ctx.stroke();

        ctx.globalAlpha = 1;
      } else {
        // compact — direct center-to-center connector
        const x1 = lx(cLane), y1 = cy1;
        const x2 = lx(pLane), y2 = pCy;

        ctx.beginPath();
        ctx.lineWidth = LINE_W;
        ctx.globalAlpha = 0.65;

        if (cLane === pLane) {
          ctx.strokeStyle = pColor;
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
        } else if (cLane === 0) {
          ctx.strokeStyle = color;
          ctx.moveTo(x1, y1);
          const cpY = y2 - ROW_H * 0.4;
          ctx.bezierCurveTo(x1, cpY, x2, cpY, x2, y2);
        } else {
          ctx.strokeStyle = color;
          ctx.moveTo(x1, y1);
          const cpY = y1 + ROW_H * 0.4;
          ctx.bezierCurveTo(x1, cpY, x2, cpY, x2, y2);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  }

  // ── draw dots ─────────────────────────────────────────────────────────────
  for (let i = 0; i < commits.length; i++) {
    const c = commits[i];
    const lane = commitLane[c.hash] ?? 0;
    const cx = lx(lane);
    const cy = commitCenters[c.hash] ?? (i + 0.5) * ROW_H;
    const color = commitColors[c.hash] ?? "rgba(232,234,240,0.3)";
    const isHead = !!(branchByHash[c.hash]?.includes(currentBranch));

    if (isHead) {
      ctx.beginPath();
      ctx.arc(cx, cy, DOT_R + 2.5, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = 0.8;
      ctx.globalAlpha = 0.2;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    ctx.beginPath();
    ctx.arc(cx, cy, isHead ? DOT_R + 0.5 : DOT_R, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = isHead ? 1 : 0.85;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

// ─── GraphCanvas component ────────────────────────────────────────────────────
interface GraphCanvasProps {
  data: GitLogResult;
  graph: GraphData;
  width: number;
  commitCenters: Record<string, number>;
  totalHeight: number;
  commitBounds?: Record<string, CommitBounds>;
  laneWidth?: number;
}

function GraphCanvas({ data, graph, width, commitCenters, totalHeight, commitBounds, laneWidth }: GraphCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { commits } = data;
  const dpr = window.devicePixelRatio || 1;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width === 0) return;
    drawGraph(canvas, commits, graph, dpr, width, commitCenters, totalHeight, commitBounds, laneWidth);
  }, [commits, graph, width, dpr, commitCenters, totalHeight, commitBounds, laneWidth]);

  return (
    <canvas
      ref={canvasRef}
      width={width * dpr}
      height={totalHeight * dpr}
      style={{ position: "absolute", left: 0, top: 0, width, height: totalHeight, pointerEvents: "none" }}
    />
  );
}

// ─── GitTree ──────────────────────────────────────────────────────────────────
interface GitTreeProps {
  variant?: "compact" | "expanded";
}

export function GitTree({ variant = "compact" }: GitTreeProps) {
  const [data, setData] = useState<GitLogResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedHash, setExpandedHash] = useState<string | null>(null);
  const [commitFiles, setCommitFiles] = useState<Record<string, ChangedFile[]>>({});
  const [filesLoading, setFilesLoading] = useState<Record<string, boolean>>({});

  const INITIAL_COUNT = 100;
  const PAGE_SIZE = 100;
  const maxCountRef = useRef(INITIAL_COUNT);

  const [copiedHash, setCopiedHash] = useState<string | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copyHash = useCallback((hash: string) => {
    navigator.clipboard.writeText(hash).catch(console.error);
    setCopiedHash(hash);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopiedHash(null), 1500);
  }, []);

  const rootRef = useRef<HTMLDivElement>(null);
  const fetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cwdAbsolute = useAppShellStore((s) => s.cwdAbsolute);
  const addTab = useSessionStore((s) => s.addTab);
  const setActiveTabId = useSessionStore((s) => s.setActiveTabId);

  // ── fetch log ──────────────────────────────────────────────────────────────
  const fetchLog = useCallback(async () => {
    if (!cwdAbsolute) return;
    setLoading(true);
    setError(null);
    maxCountRef.current = INITIAL_COUNT;
    try {
      const result = await system.getGitLog(cwdAbsolute, INITIAL_COUNT);
      setData(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [cwdAbsolute]);

  useEffect(() => {
    if (fetchTimer.current) clearTimeout(fetchTimer.current);
    fetchTimer.current = setTimeout(fetchLog, 150);
    return () => { if (fetchTimer.current) clearTimeout(fetchTimer.current); };
  }, [fetchLog]);

  // ── scroll-based loading ────────────────────────────────────────────────────
  const fetchMore = useCallback(async () => {
    if (!cwdAbsolute || !data?.has_more || loadingMore) return;
    setLoadingMore(true);
    maxCountRef.current += PAGE_SIZE;
    try {
      const result = await system.getGitLog(cwdAbsolute, maxCountRef.current);
      setData(result);
    } catch { /* keep existing data */ }
    finally { setLoadingMore(false); }
  }, [cwdAbsolute, data?.has_more, loadingMore]);



  // ── expand commit ──────────────────────────────────────────────────────────
  const handleToggleCommit = useCallback(async (hash: string) => {
    if (expandedHash === hash) { setExpandedHash(null); return; }
    setExpandedHash(hash);
    if (!commitFiles[hash] && cwdAbsolute) {
      setFilesLoading(p => ({ ...p, [hash]: true }));
      try {
        setCommitFiles(p => ({ ...p, [hash]: ([] as ChangedFile[]) }));
        const files = await system.getGitCommitFiles(cwdAbsolute, hash);
        setCommitFiles(p => ({ ...p, [hash]: files }));
      }
      catch { setCommitFiles(p => ({ ...p, [hash]: [] })); }
      finally { setFilesLoading(p => ({ ...p, [hash]: false })); }
    }
  }, [expandedHash, commitFiles, cwdAbsolute]);

  // ── open diff tab ──────────────────────────────────────────────────────────
  const handleOpenFileDiff = useCallback(async (hash: string, filePath: string) => {
    if (!cwdAbsolute) return;
    try {
      const [oldContent, newContent] = await getFileDiffAtCommit(cwdAbsolute, filePath, hash);
      openDiffTab(addTab, setActiveTabId, filePath, hash, oldContent, newContent);
    } catch { /* silent */ }
  }, [cwdAbsolute, addTab, setActiveTabId]);

  // ── commit layouts (moved before early returns — hooks must be unconditional) ──
  const commitBounds = useMemo(() => {
    const cs = data?.commits ?? [];
    if (cs.length === 0) return {};
    const map: Record<string, CommitBounds> = {};
    let y = 0;
    for (const c of cs) {
      const top = y;
      y += ROW_H;
      if (expandedHash === c.hash) {
        const files = commitFiles[c.hash];
        if (files && files.length > 0) {
          y += files.length * FILE_ROW_H;
        } else if (files && files.length === 0) {
          y += FILE_ROW_H;
        }
      }
      map[c.hash] = { center: top + ROW_H / 2, top, bottom: y };
    }
    return map;
  }, [data, expandedHash, commitFiles]);

  const commitCenters = useMemo(() => {
    const keys = Object.keys(commitBounds);
    if (keys.length === 0) return {};
    const map: Record<string, number> = {};
    for (const [hash, b] of Object.entries(commitBounds)) {
      map[hash] = b.center;
    }
    return map;
  }, [commitBounds]);

  const totalHeight = useMemo(() => {
    const keys = Object.keys(commitBounds);
    if (keys.length === 0) return 0;
    const maxY = Math.max(...Object.values(commitBounds).map(b => b.bottom));
    return maxY;
  }, [commitBounds]);

  // ── early returns ──────────────────────────────────────────────────────────
  if (!cwdAbsolute)
    return <div className="px-3 py-2 text-xs" style={{ color: "rgba(232,234,240,0.25)" }}>No workspace open</div>;

  if (loading && !data)
    return <LoadingSpinner text="Loading commits..." />;

  if (error && !data)
    return (
      <div className="px-3 py-2 text-xs" style={{ color: "rgba(232,234,240,0.35)" }}>
        {error.includes("not a git repository") ? "Not a git repository" : "Failed to load"}
      </div>
    );

  if (!data || data.commits.length === 0)
    return <div className="px-3 py-2 text-xs" style={{ color: "rgba(232,234,240,0.25)" }}>No commits yet</div>;

  // ── build graph ────────────────────────────────────────────────────────────
  const graph = buildGraphData(data);
  const { commits } = data;
  const { branchColors, currentBranch, commitColors, branchByHash, commitLane, nLanes } = graph;

  const isExpanded = variant === "expanded";
  const canvasW = nLanes * LANE_W + 4;

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div ref={rootRef} className={"flex flex-col select-text overflow-x-hidden overflow-y-auto" + (isExpanded && " font-mono text-xs")} style={{ minHeight: 0, flex: "1 1 0%" }}>
      {isExpanded && (
        <div
          className="flex items-center gap-2 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider select-none sticky top-0 z-10 shrink-0"
          style={{ color: "rgba(232,234,240,0.3)", background: "var(--surface-container-low, #12131a)" }}
        >
          <div className="flex items-center" style={{ width: canvasW, minWidth: canvasW }} />
          <span className="flex-1 min-w-0">Message</span>
          <span className="w-24 shrink-0 hidden md:inline">Author</span>
          <span className="w-20 shrink-0">Hash</span>
          <span className="w-16 shrink-0 text-right">Date</span>
        </div>
      )}

      <div className={"relative" + (isExpanded ? " flex-1 min-h-0" : "")} style={{ minWidth: 0 }}>
        {/* canvas — absolute, behind rows */}
        <div style={{ position: "absolute", left: 8, top: 0, width: canvasW, height: totalHeight, pointerEvents: "none" }}>
          <GraphCanvas data={data} graph={graph} width={canvasW} commitCenters={commitCenters} totalHeight={totalHeight} commitBounds={isExpanded ? commitBounds : undefined} />
        </div>

        <ScrollLoader
          loading={loadingMore}
          hasMore={data?.has_more ?? false}
          onLoadMore={fetchMore}
          scrollContainerRef={rootRef}
        >
          {commits.map((commit) => {
            const color = commitColors[commit.hash] ?? "rgba(232,234,240,0.25)";
            const tags = branchByHash[commit.hash] ?? [];
            const isCurrent = tags.includes(currentBranch);
            const isRowExpanded = expandedHash === commit.hash;
            const files = commitFiles[commit.hash];
            const isLoadingFiles = filesLoading[commit.hash];

            return (
              <div key={commit.hash}>
                {/* row header */}
                <div
                  className={"flex items-center cursor-pointer" + (isExpanded ? " gap-2 px-3" : " px-2")}
                  style={{ height: ROW_H, background: isCurrent ? "rgba(79,140,255,0.04)" : "transparent" }}
                  onClick={() => handleToggleCommit(commit.hash)}
                  onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = isCurrent ? "rgba(79,140,255,0.04)" : "transparent"; }}
                >
                  {/* graph spacer */}
                  <div style={{ width: canvasW, flexShrink: 0 }} />

                  {isExpanded ? (
                    /* expanded row: message + tags + author + hash + date */
                    <>
                      <span className="truncate flex-1 min-w-0" style={{ fontSize: 11, color }}>
                        {commit.message.split("\n")[0]}
                      </span>

                      {tags.length > 0 && (
                        <span className="flex items-center gap-0.5 shrink-0">
                          {tags.map(t => {
                            const tc = branchColors[t] ?? "rgba(232,234,240,0.3)";
                            return (
                              <span key={t} className="font-mono px-1 rounded-sm" style={{
                                fontSize: 9, lineHeight: "15px",
                                background: `${tc}18`, color: tc, border: `1px solid ${tc}28`,
                              }}>
                                {isCurrent && t === currentBranch ? `★ ${t}` : t}
                              </span>
                            );
                          })}
                        </span>
                      )}

                      <span className="w-24 shrink-0 truncate hidden md:inline" style={{ fontSize: 10, color: "rgba(232,234,240,0.35)" }}>
                        {commit.author}
                      </span>

                      <span
                        className="w-20 shrink-0 font-mono cursor-pointer flex items-center gap-1"
                        style={{ fontSize: 9, color: "rgba(232,234,240,0.25)" }}
                        title="Click to copy full hash"
                        onClick={e => { e.stopPropagation(); copyHash(commit.hash); }}
                      >
                        {copiedHash === commit.hash ? (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#50E3C2" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        ) : (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "rgba(232,234,240,0.2)" }}>
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                          </svg>
                        )}
                        <span>{commit.hash.slice(0, 7)}</span>
                      </span>

                      <span className="w-16 shrink-0 text-right" style={{ fontSize: 9, color: "rgba(232,234,240,0.22)" }}>
                        {relativeDate(commit.date)}
                      </span>
                    </>
                  ) : (
                    /* compact row: message + tags + date */
                    <div className="flex items-center gap-1 flex-1 min-w-0">
                      <span className="font-mono truncate flex-1 min-w-0" style={{ fontSize: 11, color }}>
                        {commit.message.split("\n")[0]}
                      </span>

                      {tags.length > 0 && (
                        <span className="flex items-center gap-0.5 shrink-0 max-w-[40%] overflow-hidden">
                          {tags.map(t => {
                            const tc = branchColors[t] ?? "rgba(232,234,240,0.3)";
                            return (
                              <span key={t} className="font-mono truncate max-w-[100px] px-1 rounded-sm" style={{
                                fontSize: 9, lineHeight: "15px",
                                background: `${tc}18`, color: tc, border: `1px solid ${tc}28`,
                              }}>
                                {isCurrent && t === currentBranch ? `★ ${t}` : t}
                              </span>
                            );
                          })}
                        </span>
                      )}

                      <span className="font-mono shrink-0" style={{ fontSize: 9, color: "rgba(232,234,240,0.22)" }}>
                        {relativeDate(commit.date)}
                      </span>
                    </div>
                  )}
                </div>

                {/* expanded file list */}
                {isRowExpanded && (
                  <div>
                    {isLoadingFiles ? (
                      <div className="flex items-center gap-1.5 py-1" style={{ paddingLeft: canvasW + 12 }}>
                        <LoadingSpinner size={9} inline />
                        <span style={{ fontSize: 10, color: "rgba(232,234,240,0.25)" }}>Loading…</span>
                      </div>
                    ) : files && files.length > 0 ? (
                      files.map(file => (
                        <div
                          key={file.file_path}
                          className="flex items-center gap-1.5 cursor-pointer"
                          style={{ paddingLeft: canvasW + 12, paddingRight: 8, paddingTop: 2, paddingBottom: 2 }}
                          onClick={e => { e.stopPropagation(); handleOpenFileDiff(commit.hash, file.file_path); }}
                          onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
                          onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                        >
                          <span className="font-mono shrink-0" style={{
                            fontSize: 9, width: 10, textAlign: "center",
                            color: STATUS_COLOR[file.status] ?? "rgba(232,234,240,0.3)",
                          }}>
                            {STATUS_ICON[file.status] ?? "?"}
                          </span>
                          <span className="truncate" style={{ fontSize: 10, color: "rgba(232,234,240,0.42)" }}>
                            {file.file_path}
                          </span>
                        </div>
                      ))
                    ) : (
                      <div style={{ paddingLeft: canvasW + (isExpanded ? 12 : 6), paddingTop: 3, paddingBottom: 3, fontSize: 10, color: "rgba(232,234,240,0.18)" }}>
                        No files changed
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </ScrollLoader>
      </div>
    </div>
  );
}