import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { RefreshCw } from "lucide-react";
import { system, type GitLogResult, type ChangedFile } from "../../lib/ipc";
import { useAppShellStore } from "../../stores/useAppShellStore";
import { useSessionStore } from "../../stores/useSessionStore";
import { relativeDate } from "../../lib/time";
import { getFileDiffAtCommit, openDiffTab } from "../../lib/gitUtils";

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
function drawGraph(
  canvas: HTMLCanvasElement,
  commits: GitLogResult["commits"],
  graph: GraphData,
  dpr: number,
  w: number,
  commitCenters: Record<string, number>,
  totalHeight: number,
) {
  const { commitLane, commitColors, branchByHash, currentBranch } = graph;
  const ctx = canvas.getContext("2d")!;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w * dpr, totalHeight * dpr);
  ctx.scale(dpr, dpr);

  const lx = (lane: number) => (lane + 0.5) * LANE_W;

  // ── draw edges ────────────────────────────────────────────────────────────
  for (let i = 0; i < commits.length; i++) {
    const c = commits[i];
    const cLane = commitLane[c.hash] ?? 0;
    const color = commitColors[c.hash] ?? "rgba(232,234,240,0.3)";
    const cy1 = commitCenters[c.hash] ?? (i + 0.5) * ROW_H;

    for (const p of c.parents) {
      const pCy = commitCenters[p];
      if (pCy == null) continue;
      const pLane = commitLane[p] ?? 0;
      const pColor = commitColors[p] ?? color;

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
}

function GraphCanvas({ data, graph, width, commitCenters, totalHeight }: GraphCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { commits } = data;
  const dpr = window.devicePixelRatio || 1;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width === 0) return;
    drawGraph(canvas, commits, graph, dpr, width, commitCenters, totalHeight);
  }, [commits, graph, width, dpr, commitCenters, totalHeight]);

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
export function GitTree() {
  const [data, setData] = useState<GitLogResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedHash, setExpandedHash] = useState<string | null>(null);
  const [commitFiles, setCommitFiles] = useState<Record<string, ChangedFile[]>>({});
  const [filesLoading, setFilesLoading] = useState<Record<string, boolean>>({});

  const rootRef = useRef<HTMLDivElement>(null);

  const cwdAbsolute = useAppShellStore((s) => s.cwdAbsolute);
  const addTab = useSessionStore((s) => s.addTab);
  const setActiveTabId = useSessionStore((s) => s.setActiveTabId);

  // ── fetch log ──────────────────────────────────────────────────────────────
  const fetchLog = useCallback(async () => {
    if (!cwdAbsolute) return;
    setLoading(true);
    setError(null);
    try { setData(await system.getGitLog(cwdAbsolute)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [cwdAbsolute]);

  useEffect(() => { fetchLog(); }, [fetchLog]);

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
  const commitCenters = useMemo(() => {
    const cs = data?.commits ?? [];
    if (cs.length === 0) return {};
    const map: Record<string, number> = {};
    let y = 0;
    for (const c of cs) {
      map[c.hash] = y + ROW_H / 2;
      y += ROW_H;
      if (expandedHash === c.hash) {
        const files = commitFiles[c.hash];
        if (files && files.length > 0) {
          y += files.length * FILE_ROW_H;
        } else if (files && files.length === 0) {
          y += FILE_ROW_H;
        }
      }
    }
    return map;
  }, [data, expandedHash, commitFiles]);

  const totalHeight = useMemo(() => {
    const keys = Object.keys(commitCenters);
    if (keys.length === 0) return 0;
    const maxY = Math.max(...Object.values(commitCenters));
    return maxY + ROW_H / 2;
  }, [commitCenters]);

  // ── early returns ──────────────────────────────────────────────────────────
  if (!cwdAbsolute)
    return <div className="px-3 py-2 text-xs" style={{ color: "rgba(232,234,240,0.25)" }}>No workspace open</div>;

  if (loading && !data)
    return (
      <div className="flex items-center gap-1.5 justify-center py-3" style={{ color: "rgba(232,234,240,0.25)" }}>
        <RefreshCw size={11} className="animate-spin" />
        <span className="text-xs">Loading graph…</span>
      </div>
    );

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

  const canvasW = nLanes * LANE_W + 4;

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div ref={rootRef} className="flex flex-col px-3 select-text overflow-x-hidden overflow-y-auto" style={{ minHeight: 0, flex: "1 1 0%" }}>
      <div className="relative" style={{ minWidth: 0 }}>

        {/* canvas — absolute, behind rows */}
        <div style={{ position: "absolute", left: 0, top: 0, width: canvasW, height: totalHeight, pointerEvents: "none" }}>
          <GraphCanvas data={data} graph={graph} width={canvasW} commitCenters={commitCenters} totalHeight={totalHeight} />
        </div>

        {/* ── commit rows ── */}
        {commits.map((commit) => {
            const color = commitColors[commit.hash] ?? "rgba(232,234,240,0.25)";
            const tags = branchByHash[commit.hash] ?? [];
            const isCurrent = tags.includes(currentBranch);
            const isExpanded = expandedHash === commit.hash;
            const files = commitFiles[commit.hash];
            const isLoadingFiles = filesLoading[commit.hash];

            return (
              <div key={commit.hash}>

                {/* row */}
                <div
                  className="flex items-center cursor-pointer"
                  style={{ height: ROW_H, background: isCurrent ? "rgba(79,140,255,0.04)" : "transparent" }}
                  onClick={() => handleToggleCommit(commit.hash)}
                  onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = isCurrent ? "rgba(79,140,255,0.04)" : "transparent"; }}
                >
                  {/* graph spacer */}
                  <div style={{ width: canvasW, flexShrink: 0 }} />

                  {/* commit meta */}
                  <div className="flex items-center gap-1 flex-1 min-w-0 pr-2">
                    <span
                      className="font-mono truncate flex-1 min-w-0"
                      style={{ fontSize: 11, color }}
                    >
                      {commit.message.split("\n")[0]}
                    </span>

                    <span className="font-mono shrink-0 hidden sm:inline" style={{ fontSize: 9, color: "rgba(232,234,240,0.18)" }}>
                      {commit.author}
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

                    <span className="font-mono shrink-0" style={{ fontSize: 9, color: "rgba(232,234,240,0.2)" }}>
                      {commit.hash.slice(0, 7)}
                    </span>
                    <span className="font-mono shrink-0" style={{ fontSize: 9, color: "rgba(232,234,240,0.22)" }}>
                      {relativeDate(commit.date)}
                    </span>
                  </div>
                </div>

                {/* expanded file list */}
                {isExpanded && (
                  <div>
                    {isLoadingFiles ? (
                      <div className="flex items-center gap-1.5 py-1" style={{ paddingLeft: canvasW + 6 }}>
                        <RefreshCw size={9} className="animate-spin" style={{ color: "rgba(232,234,240,0.25)" }} />
                        <span style={{ fontSize: 10, color: "rgba(232,234,240,0.25)" }}>Loading…</span>
                      </div>
                    ) : files && files.length > 0 ? (
                      files.map(file => (
                        <div
                          key={file.file_path}
                          className="flex items-center gap-1.5 cursor-pointer"
                          style={{ paddingLeft: canvasW + 6, paddingRight: 8, paddingTop: 2, paddingBottom: 2 }}
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
                      <div style={{ paddingLeft: canvasW + 6, paddingTop: 3, paddingBottom: 3, fontSize: 10, color: "rgba(232,234,240,0.18)" }}>
                        No files changed
                      </div>
                    )}
                  </div>
                )}

              </div>
            );
          })}

      </div>
    </div>
  );
}