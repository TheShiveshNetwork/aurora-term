import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GitBranch, GitCommitHorizontal, GitPullRequest, ArrowUp, ArrowDown,
  RefreshCw, Plus, X, ChevronDown, ChevronRight, FileText, FolderOpen,
  CheckSquare, Square, Download, Upload, Copy, Trash2, Eye,
  AlertCircle, Loader, Search, MoreVertical, GitMerge, GitFork,
  Pencil, ExternalLink,
} from "lucide-react";
import { system } from "../../lib/ipc";
import type { GitStatusEntry, GitBranchInfo } from "../../lib/ipc";
import { useDragResize } from "../../hooks/useDragResize";
import { useSessionStore } from "../../stores/useSessionStore";
import { CommitDiffView } from "../editor/CommitDiffView";
import { GitTree } from "../ui/GitTree";
import { MenuView, MenuViewItem, MenuViewSeparator } from "../ui/MenuView";

// ─── Helpers ──────────────────────────────────────────────────────────────

function relativeDate(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo`;
  return `${Math.floor(mo / 12)}y`;
}

const STATUS_LABEL: Record<string, string> = {
  M: "Modified", A: "Added", D: "Deleted", R: "Renamed", C: "Copied",
  "??": "Untracked", "!!": "Ignored",
};

const STATUS_COLOR: Record<string, string> = {
  M: "rgba(255,179,0,0.75)",
  A: "rgba(80,227,194,0.75)",
  D: "rgba(255,107,107,0.75)",
  R: "rgba(79,140,255,0.75)",
  C: "rgba(80,227,194,0.75)",
  "?": "rgba(232,234,240,0.35)",
};

function statusIcon(x: string, y: string): string {
  if (x !== " " && x !== "?") return x;
  return y;
}

function statusColor(x: string, y: string): string {
  const k = x !== " " && x !== "?" ? x : y;
  return STATUS_COLOR[k] || "rgba(232,234,240,0.35)";
}

// ─── Props ────────────────────────────────────────────────────────────────

interface GitViewProps {
  cwd: string;
  tabId: string;
}

// ─── GitView ──────────────────────────────────────────────────────────────

export function GitView({ cwd, tabId }: GitViewProps) {
  const [status, setStatus] = useState<GitStatusEntry[]>([]);
  const [branches, setBranches] = useState<GitBranchInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [branchesMenuOpen, setBranchesMenuOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; branch?: string; entry?: GitStatusEntry } | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [selectedDiff, setSelectedDiff] = useState<string | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [branchFilter, setBranchFilter] = useState("");
  const [showBranchDropdown, setShowBranchDropdown] = useState(false);
  const { size: leftWidth, onMouseDown: startResize } = useDragResize({
    axis: "x", min: 180, max: 500, initial: 300,
  });

  const stagedFiles = useMemo(() =>
    status.filter(e => e.x !== " " && e.x !== "?" && e.x !== "!"),
    [status]
  );
  const unstagedFiles = useMemo(() =>
    status.filter(e => e.x === " " && e.y !== " "),
    [status]
  );
  const untrackedFiles = useMemo(() =>
    status.filter(e => e.x === "?"),
    [status]
  );
  const currentBranch = useMemo(() =>
    branches.find(b => b.current)?.name || "main",
    [branches]
  );
  const aheadBehind = useMemo(() => {
    const cur = branches.find(b => b.current);
    if (!cur) return { ahead: 0, behind: 0 };
    return { ahead: cur.ahead, behind: cur.behind };
  }, [branches]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statusData, branchData] = await Promise.all([
        system.gitStatus(cwd),
        system.gitBranchList(cwd),
      ]);
      setStatus(statusData);
      setBranches(branchData);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleStage = useCallback(async (paths: string[]) => {
    try {
      await system.gitAdd(cwd, paths);
      await loadData();
    } catch (e) { console.error(e); }
  }, [cwd, loadData]);

  const handleUnstage = useCallback(async (paths: string[]) => {
    try {
      await system.gitReset(cwd, paths);
      await loadData();
    } catch (e) { console.error(e); }
  }, [cwd, loadData]);

  const handleRestore = useCallback(async (paths: string[]) => {
    try {
      await system.gitRestore(cwd, paths);
      await loadData();
    } catch (e) { console.error(e); }
  }, [cwd, loadData]);

  const handleCommit = useCallback(async () => {
    if (!commitMessage.trim()) return;
    try {
      const hash = await system.gitCommit(cwd, commitMessage.trim());
      setCommitMessage("");
      await loadData();
    } catch (e) { console.error(e); }
  }, [cwd, commitMessage, loadData]);

  const handleCheckout = useCallback(async (branch: string) => {
    try {
      await system.gitCheckout(cwd, branch);
      await loadData();
    } catch (e) { console.error(e); }
  }, [cwd, loadData]);

  const handlePush = useCallback(async () => {
    try {
      await system.gitPush(cwd, "origin", currentBranch);
      await loadData();
    } catch (e) { console.error(e); }
  }, [cwd, currentBranch, loadData]);

  const handlePull = useCallback(async () => {
    try {
      await system.gitPull(cwd, "origin", currentBranch);
      await loadData();
    } catch (e) { console.error(e); }
  }, [cwd, currentBranch, loadData]);

  const handleFetch = useCallback(async () => {
    try {
      await system.gitFetch(cwd, "origin");
      await loadData();
    } catch (e) { console.error(e); }
  }, [cwd, loadData]);

  // ── Branch actions ─────────────────────────────────────────────
  const handleMergeBranch = useCallback(async (branch: string) => {
    const target = prompt(`Merge branch into ${currentBranch}:`, branch);
    if (!target) return;
    try {
      await system.gitExec(cwd, ["merge", target]);
      await loadData();
    } catch (e) { alert(String(e)); }
  }, [cwd, currentBranch, loadData]);

  const handleRebaseBranch = useCallback(async (branch: string) => {
    const target = prompt(`Rebase ${currentBranch} onto:`, branch);
    if (!target) return;
    try {
      await system.gitExec(cwd, ["rebase", target]);
      await loadData();
    } catch (e) { alert(String(e)); }
  }, [cwd, currentBranch, loadData]);

  const handleCreateBranch = useCallback(async () => {
    const name = prompt("Branch name:");
    if (!name) return;
    try {
      await system.gitBranchCreate(cwd, name);
      await loadData();
    } catch (e) { alert(String(e)); }
  }, [cwd, loadData]);

  const handleCreateBranchFrom = useCallback(async () => {
    const name = prompt("Branch name:");
    if (!name) return;
    const startPoint = prompt("Start point (branch/commit):");
    if (!startPoint) return;
    try {
      await system.gitBranchCreate(cwd, name, startPoint);
      await loadData();
    } catch (e) { alert(String(e)); }
  }, [cwd, loadData]);

  const handleRenameBranch = useCallback(async (branch: string) => {
    const name = prompt(`Rename "${branch}" to:`, branch);
    if (!name) return;
    try {
      if (branch === currentBranch) {
        await system.gitExec(cwd, ["branch", "-m", name]);
      } else {
        await system.gitExec(cwd, ["branch", "-m", branch, name]);
      }
      await loadData();
    } catch (e) { alert(String(e)); }
  }, [cwd, currentBranch, loadData]);

  const handleDeleteBranch = useCallback(async (branch: string) => {
    if (!confirm(`Delete branch "${branch}"?`)) return;
    try {
      await system.gitBranchDelete(cwd, branch, true);
      await loadData();
    } catch (e) { alert(String(e)); }
  }, [cwd, loadData]);

  const handlePublishBranch = useCallback(async (branch: string) => {
    try {
      await system.gitPush(cwd, "origin", branch);
      await loadData();
    } catch (e) { alert(String(e)); }
  }, [cwd, loadData]);

  const handleRenameRemoteBranch = useCallback(async (branch: string) => {
    const remote = prompt("Remote (default: origin):", "origin");
    if (!remote) return;
    const name = prompt(`New name for remote branch "${branch}":`);
    if (!name) return;
    try {
      await system.gitExec(cwd, ["push", remote, `:${branch}`]);
      await system.gitExec(cwd, ["push", remote, name]);
      await loadData();
    } catch (e) { alert(String(e)); }
  }, [cwd, loadData]);

  const handleSelectFile = useCallback(async (entry: GitStatusEntry) => {
    const path = entry.path;
    setSelectedFile(path);
    try {
      if (entry.x !== " " && entry.x !== "?" && entry.x !== "!") {
        const diff = await system.gitDiffStaged(cwd, path);
        setSelectedDiff(diff);
      } else {
        const diff = await system.gitDiffUnstaged(cwd, path);
        setSelectedDiff(diff);
      }
    } catch {
      setSelectedDiff("(error loading diff)");
    }
  }, [cwd]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-surface-container-low">
        <Loader size={24} className="animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-surface-container-low gap-3">
        <AlertCircle size={28} className="text-error" />
        <span className="text-sm text-on-surface-variant">{error}</span>
        <button onClick={loadData} className="px-3 py-1.5 text-xs rounded-lg bg-primary/15 text-primary hover:bg-primary/25 transition-colors cursor-pointer">
          Retry
        </button>
      </div>
    );
  }

  const stagedForCommit = stagedFiles.length > 0;

  return (
    <div className="flex flex-col h-full w-full bg-surface-container-low select-none" style={{ minHeight: 0 }}>
      {/* ── Toolbar ─────────────────────────────────────────────────── */}
      <div
        className="flex items-center px-3 shrink-0 border-b"
        style={{ height: 40, borderColor: "rgba(255,255,255,0.05)" }}
      >
        <div className="relative">
          <button
            onClick={() => setShowBranchDropdown(v => !v)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer"
            style={{ background: "rgba(79,140,255,0.1)", color: "#4F8CFF", border: "1px solid rgba(79,140,255,0.2)" }}
          >
            <GitBranch size={12} />
            <span>{currentBranch}</span>
            <ChevronDown size={11} style={{ opacity: 0.6 }} />
          </button>
          {showBranchDropdown && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowBranchDropdown(false)} />
              <div
                className="absolute top-full left-0 mt-1 z-50 w-52 rounded-lg overflow-hidden"
                style={{ background: "#141822", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}
              >
                <div className="px-2 py-1.5">
                  <div
                    className="flex items-center gap-1.5 px-2 py-1 rounded text-xs"
                    style={{ background: "rgba(255,255,255,0.03)", color: "rgba(232,234,240,0.35)" }}
                  >
                    <Search size={11} />
                    <input
                      value={branchFilter}
                      onChange={e => setBranchFilter(e.target.value)}
                      placeholder="Filter branches…"
                      className="flex-1 bg-transparent outline-none text-[12px] text-on-surface placeholder:text-white/25"
                      autoFocus
                    />
                  </div>
                </div>
                <div style={{ maxHeight: 240, overflowY: "auto" }}>
                  {branches
                    .filter(b => !branchFilter || b.name.toLowerCase().includes(branchFilter.toLowerCase()))
                    .map(b => (
                      <button
                        key={b.name}
                        onClick={() => { handleCheckout(b.name); setShowBranchDropdown(false); }}
                        className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-xs transition-colors cursor-pointer"
                        style={{
                          color: b.current ? "#4F8CFF" : "rgba(232,234,240,0.7)",
                          background: b.current ? "rgba(79,140,255,0.08)" : "transparent",
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
                        onMouseLeave={e => { if (!b.current) e.currentTarget.style.background = "transparent"; }}
                      >
                        <GitBranch size={11} style={{ color: b.current ? "#4F8CFF" : "rgba(232,234,240,0.25)" }} />
                        <span className="truncate flex-1">{b.name}</span>
                        {b.remote && <span className="text-[10px] opacity-40">{b.remote}</span>}
                      </button>
                    ))}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-1 text-[11px] px-2 py-1 rounded" style={{ color: "rgba(232,234,240,0.4)", background: "rgba(255,255,255,0.03)" }}>
          <ArrowUp size={11} style={{ color: aheadBehind.ahead > 0 ? "#50E3C2" : undefined }} />
          <span>{aheadBehind.ahead}</span>
          <ArrowDown size={11} style={{ color: aheadBehind.behind > 0 ? "#FF6B6B" : undefined }} />
          <span>{aheadBehind.behind}</span>
        </div>

        <div className="w-px h-4 bg-white/6" />

        <ToolbarBtn onClick={handlePull} title="Pull" icon={<Download size={13} />} />
        <ToolbarBtn onClick={handlePush} title="Push" icon={<Upload size={13} />} />
        <ToolbarBtn onClick={handleFetch} title="Fetch" icon={<RefreshCw size={13} />} />

        <div className="flex-1" />

        <ToolbarBtn onClick={loadData} title="Refresh" icon={<RefreshCw size={13} />} />
      </div>

      {/* ── Main content: resizable left/right panels ──────────────── */}
      <div className="flex flex-1 min-h-0">
        {/* ── Left panel ──────────────────────────────────────────── */}
        <div style={{ width: leftWidth, minWidth: 0, borderColor: "rgba(255,255,255,0.05)" }} className="flex flex-col border-r shrink-0 overflow-hidden">
          {/* Branches section */}
          <div className="flex flex-col">
            <div className="flex items-center gap-2 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider select-none"
              style={{ color: "rgba(232,234,240,0.3)", background: "rgba(255,255,255,0.02)" }}>
              <span>Branches</span>
              <span className="text-[9px] px-1 rounded" style={{ background: "rgba(255,255,255,0.04)", color: "rgba(232,234,240,0.25)" }}>
                {branches.length}
              </span>
              <div className="flex-1" />
              <div className="relative">
                <button
                  onClick={e => { e.stopPropagation(); setBranchesMenuOpen(!branchesMenuOpen); }}
                  className="p-0.5 rounded cursor-pointer hover:bg-white/5 transition-colors"
                  style={{ color: "rgba(232,234,240,0.3)" }}
                >
                  <MoreVertical size={13} />
                </button>
                {branchesMenuOpen && (
                  <MenuView variant="secondary" open={branchesMenuOpen} onClose={() => setBranchesMenuOpen(false)} className="absolute right-0 top-full">
                    <MenuViewItem variant="secondary" onClick={() => { setBranchesMenuOpen(false); handleCheckout(prompt("Branch name:", "") || currentBranch); }} icon={<GitBranch size={12} />}>
                      Checkout to
                    </MenuViewItem>
                    <MenuViewSeparator />
                    <MenuViewItem variant="secondary" onClick={() => { setBranchesMenuOpen(false); handleMergeBranch(currentBranch); }} icon={<GitMerge size={12} />}>
                      Merge
                    </MenuViewItem>
                    <MenuViewItem variant="secondary" onClick={() => { setBranchesMenuOpen(false); handleRebaseBranch(currentBranch); }} icon={<GitFork size={12} />}>
                      Rebase branch
                    </MenuViewItem>
                    <MenuViewSeparator />
                    <MenuViewItem variant="secondary" onClick={() => { setBranchesMenuOpen(false); handleCreateBranch(); }} icon={<Plus size={12} />}>
                      Create branch
                    </MenuViewItem>
                    <MenuViewItem variant="secondary" onClick={() => { setBranchesMenuOpen(false); handleCreateBranchFrom(); }} icon={<GitBranch size={12} />}>
                      Create branch from
                    </MenuViewItem>
                    <MenuViewSeparator />
                    <MenuViewItem variant="secondary" onClick={() => { setBranchesMenuOpen(false); handleRenameRemoteBranch(currentBranch); }} icon={<ExternalLink size={12} />}>
                      Rename remote branch
                    </MenuViewItem>
                  </MenuView>
                )}
              </div>
            </div>
            <div style={{ maxHeight: 140, overflowY: "auto" }}>
              {branches.slice(0, 15).map(b => (
                <div
                  key={b.name}
                  className="flex items-center gap-1 w-full text-xs px-2 py-1 transition-colors"
                  style={{
                    color: b.current ? "#4F8CFF" : "rgba(232,234,240,0.6)",
                    background: b.current ? "rgba(79,140,255,0.06)" : "transparent",
                  }}
                  onMouseEnter={e => { if (!b.current) e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
                  onMouseLeave={e => {
                    if (!b.current) e.currentTarget.style.background = "transparent";
                  }}
                  onContextMenu={e => {
                    e.preventDefault();
                    setContextMenu({ x: e.clientX, y: e.clientY, branch: b.name });
                  }}
                >
                  <button
                    onClick={() => handleCheckout(b.name)}
                    className="flex items-center gap-1.5 flex-1 min-w-0 text-left cursor-pointer"
                  >
                    <GitBranch size={11} style={{ color: b.current ? "#4F8CFF" : "rgba(232,234,240,0.2)" }} />
                    <span className="truncate">{b.name}</span>
                    {b.ahead > 0 && <span className="text-[10px]" style={{ color: "#50E3C2" }}>↑{b.ahead}</span>}
                    {b.behind > 0 && <span className="text-[10px]" style={{ color: "#FF6B6B" }}>↓{b.behind}</span>}
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Staged files */}
          <div className="flex flex-col border-t" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
            <SectionHeader label="Staged" count={stagedFiles.length}
              action={stagedFiles.length > 0 ? { label: "Unstage all", onClick: () => handleUnstage(stagedFiles.map(e => e.path)) } : undefined} />
            <div className="flex-1 min-h-0 overflow-y-auto" style={{ maxHeight: 180 }}>
              {stagedFiles.map(e => (
                <FileRow key={`staged-${e.path}`} entry={e}
                  checked={true}
                  onToggle={() => handleUnstage([e.path])}
                  onClick={() => handleSelectFile(e)}
                  onContextMenu={ev => { ev.preventDefault(); setContextMenu({ x: ev.clientX, y: ev.clientY, entry: e }); }}
                />
              ))}
              {stagedFiles.length === 0 && (
                <div className="px-3 py-2 text-[11px]" style={{ color: "rgba(232,234,240,0.25)" }}>No staged changes</div>
              )}
            </div>
          </div>

          {/* Unstaged changes */}
          <div className="flex flex-col border-t" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
            <SectionHeader label="Changes" count={unstagedFiles.length}
              action={unstagedFiles.length > 0 ? { label: "Stage all", onClick: () => handleStage(unstagedFiles.map(e => e.path)) } : undefined} />
            <div className="flex-1 min-h-0 overflow-y-auto" style={{ maxHeight: 180 }}>
              {unstagedFiles.map(e => (
                <FileRow key={`unstaged-${e.path}`} entry={e}
                  checked={false}
                  onToggle={() => handleStage([e.path])}
                  onClick={() => handleSelectFile(e)}
                  onRestore={() => handleRestore([e.path])}
                  onContextMenu={ev => { ev.preventDefault(); setContextMenu({ x: ev.clientX, y: ev.clientY, entry: e }); }}
                />
              ))}
              {unstagedFiles.length === 0 && (
                <div className="px-3 py-2 text-[11px]" style={{ color: "rgba(232,234,240,0.25)" }}>No changes</div>
              )}
            </div>
          </div>

          {/* Untracked files */}
          {untrackedFiles.length > 0 && (
            <div className="flex flex-col border-t" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
              <SectionHeader label="Untracked" count={untrackedFiles.length}
                action={{ label: "Stage all", onClick: () => handleStage(untrackedFiles.map(e => e.path)) }} />
              <div className="flex-1 min-h-0 overflow-y-auto" style={{ maxHeight: 120 }}>
                {untrackedFiles.map(e => (
                  <FileRow key={`untracked-${e.path}`} entry={e}
                    checked={false}
                    onToggle={() => handleStage([e.path])}
                    onClick={() => handleSelectFile(e)}
                    onContextMenu={ev => { ev.preventDefault(); setContextMenu({ x: ev.clientX, y: ev.clientY, entry: e }); }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Resize handle ───────────────────────────────────────── */}
        <div
          onMouseDown={startResize}
          className="w-1 shrink-0 cursor-col-resize relative transition-colors hover:bg-primary/30"
          style={{ background: "transparent" }}
        />

        {/* ── Right panel: commit form + diff + graph ─────────────── */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Commit form */}
          <div
            className="flex items-center gap-2 px-3 py-2 border-b shrink-0"
            style={{ borderColor: "rgba(255,255,255,0.05)" }}
          >
            <input
              value={commitMessage}
              onChange={e => setCommitMessage(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && e.ctrlKey && stagedForCommit) handleCommit(); }}
              placeholder={stagedForCommit ? "Commit message…" : "Stage changes to commit…"}
              className="flex-1 bg-transparent outline-none text-[13px] text-on-surface placeholder:text-white/25"
            />
            <button
              onClick={handleCommit}
              disabled={!commitMessage.trim() || !stagedForCommit}
              className="px-3 py-1.5 text-[11px] font-medium rounded-lg transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-default"
              style={{
                background: "rgba(79,140,255,0.12)",
                color: "#4F8CFF",
                border: "1px solid rgba(79,140,255,0.2)",
              }}
              onMouseEnter={e => { if (!e.currentTarget.disabled) e.currentTarget.style.background = "rgba(79,140,255,0.22)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "rgba(79,140,255,0.12)"; }}
            >
              Commit to {currentBranch}
            </button>
          </div>

          {/* Diff view (only when a file is selected) */}
          {selectedFile && (
            <div className="flex-1 min-h-0 overflow-hidden" style={{ background: "var(--surface-container-low, #12131a)" }}>
              {selectedDiff !== null ? (
                <CommitDiffView
                  diff={selectedDiff}
                  commitHash=""
                  filePath={selectedFile}
                />
              ) : (
                <div className="flex items-center justify-center h-full">
                  <div className="flex flex-col items-center gap-2" style={{ color: "rgba(232,234,240,0.25)" }}>
                    <Eye size={24} />
                    <span className="text-xs">Select a file to view diff</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Git graph */}
          <div
            className={`${selectedFile ? "shrink-0" : "flex-1 min-h-0"} border-t flex flex-col`}
            style={{ borderColor: "rgba(255,255,255,0.05)", height: selectedFile ? 240 : undefined }}
          >
            <SectionHeader label="Commit History" />
            <GitTree />
          </div>
        </div>
      </div>

      {/* ── Right-click context menus ────────────────────────────── */}
      {contextMenu?.branch && (
        <MenuView variant="rightclick" open={!!contextMenu} onClose={() => setContextMenu(null)} anchorX={contextMenu.x} anchorY={contextMenu.y}>
          <MenuViewItem variant="rightclick" onClick={() => { setContextMenu(null); handleMergeBranch(contextMenu.branch!); }}>
            <GitMerge size={12} /> Merge into current
          </MenuViewItem>
          <MenuViewItem variant="rightclick" onClick={() => { setContextMenu(null); handleRebaseBranch(contextMenu.branch!); }}>
            <GitFork size={12} /> Rebase onto current
          </MenuViewItem>
          <MenuViewSeparator />
          <MenuViewItem variant="rightclick" onClick={() => { setContextMenu(null); handleRenameBranch(contextMenu.branch!); }}>
            <Pencil size={12} /> Rename
          </MenuViewItem>
          <MenuViewItem variant="rightclick" onClick={() => { setContextMenu(null); handleDeleteBranch(contextMenu.branch!); }}>
            <Trash2 size={12} /> Delete
          </MenuViewItem>
          <MenuViewSeparator />
          <MenuViewItem variant="rightclick" onClick={() => { setContextMenu(null); handlePublishBranch(contextMenu.branch!); }}>
            <Upload size={12} /> Publish
          </MenuViewItem>
          <MenuViewItem variant="rightclick" onClick={() => { setContextMenu(null); handleRenameRemoteBranch(contextMenu.branch!); }}>
            <ExternalLink size={12} /> Rename remote
          </MenuViewItem>
        </MenuView>
      )}

      {contextMenu?.entry && (
        <MenuView variant="rightclick" open={!!contextMenu} onClose={() => setContextMenu(null)} anchorX={contextMenu.x} anchorY={contextMenu.y}>
          {contextMenu.entry.x !== " " && contextMenu.entry.x !== "?" && (
            <MenuViewItem variant="rightclick" onClick={() => { setContextMenu(null); handleUnstage([contextMenu.entry!.path]); }}>
              <Square size={12} /> Unstage
            </MenuViewItem>
          )}
          {(contextMenu.entry.x === " " || contextMenu.entry.x === "?") && (
            <MenuViewItem variant="rightclick" onClick={() => { setContextMenu(null); handleStage([contextMenu.entry!.path]); }}>
              <CheckSquare size={12} /> Stage
            </MenuViewItem>
          )}
          {contextMenu.entry.x === " " && contextMenu.entry.y !== " " && (
            <MenuViewItem variant="rightclick" danger onClick={() => { setContextMenu(null); handleRestore([contextMenu.entry!.path]); }}>
              <Trash2 size={12} /> Discard changes
            </MenuViewItem>
          )}
          <MenuViewSeparator />
          <MenuViewItem variant="rightclick" onClick={() => { setContextMenu(null); handleSelectFile(contextMenu.entry!); }}>
            <Eye size={12} /> View diff
          </MenuViewItem>
        </MenuView>
      )}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────

function SectionHeader({ label, count, action }: {
  label: string;
  count?: number;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider select-none"
      style={{ color: "rgba(232,234,240,0.3)", background: "rgba(255,255,255,0.02)" }}
    >
      <span>{label}</span>
      {count !== undefined && (
        <span className="text-[9px] px-1 rounded" style={{ background: "rgba(255,255,255,0.04)", color: "rgba(232,234,240,0.25)" }}>
          {count}
        </span>
      )}
      <div className="flex-1" />
      {action && (
        <button
          onClick={action.onClick}
          className="text-[9px] cursor-pointer hover:text-primary transition-colors"
          style={{ color: "rgba(232,234,240,0.3)" }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

function FileRow({ entry, checked, onToggle, onClick, onRestore, onContextMenu }: {
  entry: GitStatusEntry;
  checked: boolean;
  onToggle: () => void;
  onClick: () => void;
  onRestore?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  const [showActions, setShowActions] = useState(false);
  const icon = statusIcon(entry.x, entry.y);
  const color = statusColor(entry.x, entry.y);
  const pathParts = entry.path.replace(/\\/g, "/").split("/");
  const fileName = pathParts.pop() || entry.path;
  const dirName = pathParts.join("/");

  return (
    <div
      className="flex items-center gap-1.5 px-3 py-1 text-xs transition-colors"
      style={{ color: "rgba(232,234,240,0.7)" }}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
      onContextMenu={onContextMenu}
    >
      <button
        onClick={onToggle}
        className="shrink-0 cursor-pointer transition-colors"
        style={{ color: checked ? "#4F8CFF" : "rgba(232,234,240,0.2)" }}
        title={checked ? "Unstage" : "Stage"}
      >
        {checked ? <CheckSquare size={13} /> : <Square size={13} />}
      </button>
      <button
        onClick={onClick}
        className="flex items-center gap-1.5 flex-1 min-w-0 text-left cursor-pointer hover:text-on-surface transition-colors"
      >
        <FileText size={11} style={{ color }} />
        <span className="truncate">{fileName}</span>
        {dirName && (
          <span className="text-[10px] truncate" style={{ color: "rgba(232,234,240,0.25)" }}>
            {dirName}
          </span>
        )}
        <span className="text-[9px] font-mono shrink-0 px-1 rounded" style={{ color, background: `${color}15` }}>
          {icon}
        </span>
      </button>
      {showActions && onRestore && (
        <button
          onClick={onRestore}
          className="shrink-0 cursor-pointer transition-colors p-0.5 rounded"
          style={{ color: "rgba(232,234,240,0.2)" }}
          onMouseEnter={e => { e.currentTarget.style.color = "#FF6B6B"; e.currentTarget.style.background = "rgba(255,107,107,0.1)"; }}
          onMouseLeave={e => { e.currentTarget.style.color = "rgba(232,234,240,0.2)"; e.currentTarget.style.background = "transparent"; }}
          title="Discard changes"
        >
          <Trash2 size={11} />
        </button>
      )}
    </div>
  );
}

function ToolbarBtn({ onClick, title, icon }: {
  onClick: () => void;
  title: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="p-1.5 rounded-lg transition-colors cursor-pointer"
      style={{ color: "rgba(232,234,240,0.45)" }}
      onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; e.currentTarget.style.color = "#E8EAF0"; }}
      onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "rgba(232,234,240,0.45)"; }}
    >
      {icon}
    </button>
  );
}
