import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconButton } from "../ui/IconButton";
import { v4 as uuidv4 } from "uuid";
import {
  GitBranch, ArrowUp, ArrowDown, RefreshCw, Plus, X, ChevronDown,
  CheckSquare, Square, Download, Upload, Trash2, Eye,
  AlertCircle, Search, MoreVertical, GitMerge, GitFork,
  Pencil, ExternalLink, Undo2, FileDiff, FileSymlink,
} from "lucide-react";
import { system } from "../../lib/ipc";
import type { GitStatusEntry, GitBranchInfo } from "../../lib/ipc";
import { useDragResize } from "../../hooks/useDragResize";
import { useSessionStore } from "../../stores/useSessionStore";
import { CommitDiffView } from "../editor/CommitDiffView";
import { GitTree } from "../ui/GitTree";
import { LoadingSpinner } from "../ui/LoadingSpinner";
import { MenuView, MenuViewItem, MenuViewSeparator } from "../ui/MenuView";

const STATUS_COLOR: Record<string, string> = {
  M: "rgba(255,179,0,0.75)",
  A: "rgba(80,227,194,0.75)",
  D: "rgba(255,107,107,0.75)",
  R: "rgba(79,140,255,0.75)",
  C: "rgba(80,227,194,0.75)",
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

// ─── Props ────────────────────────────────────────────────────────────────

interface GitViewProps {
  cwd: string;
  tabId: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

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
  const [diffLoading, setDiffLoading] = useState(false);
  const loadingFileRef = useRef<string | null>(null);
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
    status.filter(e => e.y !== " " && e.y !== "?" && e.y !== "!" && e.x !== "?"),
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

  const SECTION_MIN = 28;
  const leftPanelRef = useRef<HTMLDivElement>(null);
  const [leftPanelH, setLeftPanelH] = useState(400);
  const [sectionHeights, setSectionHeights] = useState({ branches: 120, staged: 120 });
  const sectionDragRef = useRef<{ section: "branches" | "staged"; startY: number; startH: number; startNext: number } | null>(null);

  const unstagedH = leftPanelH - sectionHeights.branches - sectionHeights.staged - 8;

  const startSectionResize = useCallback((section: "branches" | "staged", e: React.MouseEvent) => {
    e.preventDefault();
    const next = section === "branches" ? sectionHeights.staged : unstagedH;
    sectionDragRef.current = { section, startY: e.clientY, startH: sectionHeights[section], startNext: next };
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  }, [sectionHeights, unstagedH]);

  useEffect(() => {
    const el = leftPanelRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => { setLeftPanelH(entries[0].contentRect.height); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = sectionDragRef.current;
      if (!d) return;
      const dy = e.clientY - d.startY;
      let newH = d.startH + dy;
      let newNext = d.startNext - dy;
      if (newH < SECTION_MIN) { newNext += newH - SECTION_MIN; newH = SECTION_MIN; }
      if (newNext < SECTION_MIN) { newH += newNext - SECTION_MIN; newNext = SECTION_MIN; }
      setSectionHeights(prev => ({ ...prev, [d.section]: Math.round(newH) }));
    };
    const onUp = () => {
      if (!sectionDragRef.current) return;
      sectionDragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

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

  const addTab = useSessionStore(s => s.addTab);
  const setActiveTabId = useSessionStore(s => s.setActiveTabId);
  const tabs = useSessionStore(s => s.tabs);

  const handleOpenFile = useCallback(async (filePath: string) => {
    const resolvedPath = cwd ? `${cwd}/${filePath}`.replace(/\/\//g, "/") : filePath;
    const existing = tabs.find(t => t.type === "file" && t.filePath === resolvedPath && t.cwd === cwd);
    if (existing) { setActiveTabId(existing.id); return; }
    const name = filePath.split(/[\\/]/).pop() || filePath;
    const id = uuidv4();
    addTab({ id, name, type: "file", filePath: resolvedPath, cwd, created_at: Date.now() });
    setActiveTabId(id);
  }, [cwd, tabs, addTab, setActiveTabId]);

  const handleOpenDiff = useCallback(async (diffFn: (cwd: string, path?: string) => Promise<string>, title: string) => {
    const existing = tabs.find(t => t.type === "diff" && t.name === title);
    if (existing) { setActiveTabId(existing.id); return; }
    try {
      const diff = await diffFn(cwd);
      const id = uuidv4();
      addTab({ id, name: title, type: "diff", diffContent: diff, created_at: Date.now() });
      setActiveTabId(id);
    } catch (e) { console.error(e); }
  }, [cwd, tabs, addTab, setActiveTabId]);

  const handleSelectFile = useCallback(async (entry: GitStatusEntry, staged?: boolean) => {
    const path = entry.path;
    loadingFileRef.current = path;
    setSelectedFile(path);
    setSelectedDiff(null);
    setDiffLoading(true);
    try {
      const showStaged = staged ?? (entry.x !== " " && entry.x !== "?" && entry.x !== "!");
      const diff = showStaged
        ? await system.gitDiffStaged(cwd, path)
        : await system.gitDiffUnstaged(cwd, path);
      if (loadingFileRef.current === path) setSelectedDiff(diff);
    } catch {
      if (loadingFileRef.current === path) setSelectedDiff("(error loading diff)");
    } finally {
      if (loadingFileRef.current === path) setDiffLoading(false);
    }
  }, [cwd]);

  const handleOpenSelectedFileDiff = useCallback(async () => {
    const path = selectedFile;
    if (!path) return;
    const resolvedPath = cwd ? `${cwd}/${path}`.replace(/\/\//g, "/") : path;
    const existing = tabs.find(t => t.type === "diff" && t.filePath === resolvedPath && !t.diffCommitHash);
    if (existing) { setActiveTabId(existing.id); return; }
    try {
      const isStaged = stagedFiles.some(e => e.path === path);
      const diff = await (isStaged ? system.gitDiffStaged(cwd, path) : system.gitDiffUnstaged(cwd, path));
      const id = uuidv4();
      const name = path.split(/[\\/]/).pop() || path;
      addTab({ id, name, type: "diff", filePath: resolvedPath, diffContent: diff, created_at: Date.now() });
      setActiveTabId(id);
    } catch (e) { console.error(e); }
  }, [selectedFile, cwd, stagedFiles, tabs, addTab, setActiveTabId]);

  const handleOpenOrFocusFile = useCallback((filePath: string) => {
    handleOpenFile(filePath);
  }, [cwd, handleOpenFile]);

  const handleCloseDiff = useCallback(() => {
    setSelectedFile(null);
    setSelectedDiff(null);
  }, []);

  const COMMIT_HISTORY_MIN = 0;
  const rightPanelRef = useRef<HTMLDivElement>(null);
  const [commitHistoryH, setCommitHistoryH] = useState(200);
  const commitHistoryDragRef = useRef<{ startY: number; startH: number } | null>(null);

  const startCommitHistoryResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    commitHistoryDragRef.current = { startY: e.clientY, startH: commitHistoryH };
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  }, [commitHistoryH]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = commitHistoryDragRef.current;
      if (!d) return;
      const dy = e.clientY - d.startY;
      const newH = Math.max(0, d.startH - dy);
      setCommitHistoryH(newH);
    };
    const onUp = () => {
      if (!commitHistoryDragRef.current) return;
      commitHistoryDragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

  if (loading) {
    return <LoadingSpinner text="Loading git data..." />;
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
        className="flex items-center gap-2 px-3 shrink-0 border-b"
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

        <IconButton icon={<Download size={13} />} tooltip="Pull" onClick={handlePull} size="sm" className="w-7 h-7 [&_svg]:w-[13px] [&_svg]:h-[13px]" variant="ghost" />
        <IconButton icon={<Upload size={13} />} tooltip="Push" onClick={handlePush} size="sm" className="w-7 h-7 [&_svg]:w-[13px] [&_svg]:h-[13px]" variant="ghost" />
        <IconButton icon={<RefreshCw size={13} />} tooltip="Fetch" onClick={handleFetch} size="sm" className="w-7 h-7 [&_svg]:w-[13px] [&_svg]:h-[13px]" variant="ghost" />

        <div className="flex-1" />

        <IconButton icon={<RefreshCw size={13} />} tooltip="Refresh" onClick={loadData} size="sm" className="w-7 h-7 [&_svg]:w-[13px] [&_svg]:h-[13px]" variant="ghost" />
      </div>

      {/* ── Main content: resizable left/right panels ──────────────── */}
      <div className="flex flex-1 min-h-0">
        {/* ── Left panel ──────────────────────────────────────────── */}
        <div ref={leftPanelRef} style={{ width: leftWidth, minWidth: 0, borderColor: "rgba(255,255,255,0.05)" }} className="flex flex-col shrink-0 border-r relative overflow-hidden">

          {/* Branches */}
          <div className="shrink-0 flex flex-col overflow-hidden" style={{ height: sectionHeights.branches }}>
            <SectionHeader label="Branches" count={branches.length}
              action={
                <div className="relative">
                  <button onClick={e => { e.stopPropagation(); setBranchesMenuOpen(!branchesMenuOpen); }}
                    className="p-0.5 rounded cursor-pointer hover:bg-white/5 transition-colors" style={{ color: "rgba(232,234,240,0.3)" }}>
                    <MoreVertical size={13} />
                  </button>
                  {branchesMenuOpen && (
                    <MenuView variant="secondary" open={branchesMenuOpen} onClose={() => setBranchesMenuOpen(false)} className="absolute right-0 top-full">
                      <MenuViewItem variant="secondary" onClick={() => { setBranchesMenuOpen(false); handleCheckout(prompt("Branch name:", "") || currentBranch); }} icon={<GitBranch size={12} />}>Checkout to</MenuViewItem>
                      <MenuViewSeparator />
                      <MenuViewItem variant="secondary" onClick={() => { setBranchesMenuOpen(false); handleMergeBranch(currentBranch); }} icon={<GitMerge size={12} />}>Merge</MenuViewItem>
                      <MenuViewItem variant="secondary" onClick={() => { setBranchesMenuOpen(false); handleRebaseBranch(currentBranch); }} icon={<GitFork size={12} />}>Rebase branch</MenuViewItem>
                      <MenuViewSeparator />
                      <MenuViewItem variant="secondary" onClick={() => { setBranchesMenuOpen(false); handleCreateBranch(); }} icon={<Plus size={12} />}>Create branch</MenuViewItem>
                      <MenuViewItem variant="secondary" onClick={() => { setBranchesMenuOpen(false); handleCreateBranchFrom(); }} icon={<GitBranch size={12} />}>Create branch from</MenuViewItem>
                      <MenuViewSeparator />
                      <MenuViewItem variant="secondary" onClick={() => { setBranchesMenuOpen(false); handleRenameRemoteBranch(currentBranch); }} icon={<ExternalLink size={12} />}>Rename remote branch</MenuViewItem>
                    </MenuView>
                  )}
                </div>
              } />
            <div className="flex-1 min-h-0 overflow-y-auto">
              {branches.map(b => (
                <div key={b.name}
                  className="flex items-center gap-1 w-full text-xs px-3 py-1 transition-colors"
                  style={{ color: b.current ? "#4F8CFF" : "rgba(232,234,240,0.6)", background: b.current ? "rgba(79,140,255,0.06)" : "transparent" }}
                  onMouseEnter={e => { if (!b.current) e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
                  onMouseLeave={e => { if (!b.current) e.currentTarget.style.background = "transparent"; }}
                  onContextMenu={e => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, branch: b.name }); }}
                >
                  <button onClick={() => handleCheckout(b.name)} className="flex items-center gap-1.5 flex-1 min-w-0 text-left cursor-pointer">
                    <GitBranch size={11} style={{ color: b.current ? "#4F8CFF" : "rgba(232,234,240,0.2)" }} />
                    <span className="truncate">{b.name}</span>
                    {b.ahead > 0 && <span className="text-[10px]" style={{ color: "#50E3C2" }}>↑{b.ahead}</span>}
                    {b.behind > 0 && <span className="text-[10px]" style={{ color: "#FF6B6B" }}>↓{b.behind}</span>}
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Resize handle */}
          <div onMouseDown={e => startSectionResize("branches", e)} className="shrink-0 h-[4px] cursor-row-resize transition-colors hover:bg-primary/20 relative z-10" style={{ background: "transparent" }} />

          {/* Staged */}
          <div className="shrink-0 flex flex-col overflow-hidden" style={{ height: sectionHeights.staged }}>
            <SectionHeader label="Staged" count={stagedFiles.length}>
              {stagedFiles.length > 0 && <>
                <IconButton icon={<FileDiff />} tooltip="Open Staged Changes" onClick={() => handleOpenDiff(system.gitDiffStaged, "Staged changes")} size="sm" className="w-5 h-5 [&_svg]:w-3 [&_svg]:h-3" />
                <IconButton icon={<X />} tooltip="Unstage All" onClick={() => handleUnstage(stagedFiles.map(e => e.path))} size="sm" className="w-5 h-5 [&_svg]:w-3 [&_svg]:h-3" />
              </>}
            </SectionHeader>
            <div className="flex-1 min-h-0 overflow-y-auto">
              {stagedFiles.map(e => (
                <StagedFileRow key={`staged-${e.path}`} entry={e}
                  onUnstage={() => handleUnstage([e.path])}
                  onOpenFile={() => handleOpenFile(e.path)}
                  onSelect={() => handleSelectFile(e, true)}
                  onContextMenu={ev => { ev.preventDefault(); setContextMenu({ x: ev.clientX, y: ev.clientY, entry: e }); }} />
              ))}
              {stagedFiles.length === 0 && <div className="px-3 py-2 text-[11px]" style={{ color: "rgba(232,234,240,0.25)" }}>No staged changes</div>}
            </div>
          </div>

          {/* Resize handle */}
          <div onMouseDown={e => startSectionResize("staged", e)} className="shrink-0 h-[4px] cursor-row-resize transition-colors hover:bg-primary/20 relative z-10" style={{ background: "transparent" }} />

          {/* Unstaged changes (fills remaining) */}
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <SectionHeader label="Changes" count={unstagedFiles.length + untrackedFiles.length}>
              {(unstagedFiles.length + untrackedFiles.length) > 0 && <>
                <IconButton icon={<FileDiff />} tooltip="Open Changes" onClick={() => handleOpenDiff(system.gitDiffUnstaged, "Unstaged changes")} size="sm" className="w-5 h-5 [&_svg]:w-3 [&_svg]:h-3" />
                <IconButton icon={<Undo2 />} tooltip="Discard All Changes" onClick={() => {
                  const all = [...unstagedFiles, ...untrackedFiles];
                  if (all.length > 0) handleRestore(all.map(e => e.path));
                }} size="sm" className="w-5 h-5 [&_svg]:w-3 [&_svg]:h-3" />
                <IconButton icon={<Plus />} tooltip="Stage All Changes" onClick={() => {
                  const all = [...unstagedFiles, ...untrackedFiles];
                  if (all.length > 0) handleStage(all.map(e => e.path));
                }} size="sm" className="w-5 h-5 [&_svg]:w-3 [&_svg]:h-3" />
              </>}
            </SectionHeader>
            <div className="flex-1 min-h-0 overflow-y-auto">
              {[...unstagedFiles, ...untrackedFiles].map(e => (
                <ChangesFileRow key={`change-${e.path}`} entry={e}
                  onStage={() => handleStage([e.path])}
                  onRestore={() => { if (e.x === " " && e.y !== " ") handleRestore([e.path]); }}
                  onOpenFile={() => handleOpenFile(e.path)}
                  onSelect={() => handleSelectFile(e, false)}
                  onContextMenu={ev => { ev.preventDefault(); setContextMenu({ x: ev.clientX, y: ev.clientY, entry: e }); }} />
              ))}
              {unstagedFiles.length === 0 && untrackedFiles.length === 0 && (
                <div className="px-3 py-2 text-[11px]" style={{ color: "rgba(232,234,240,0.25)" }}>No changes</div>
              )}
            </div>
          </div>
        </div>

        {/* ── Resize handle ───────────────────────────────────────── */}
        <div
          onMouseDown={startResize}
          className="w-[2px] shrink-0 cursor-col-resize transition-colors hover:bg-primary/30 relative z-10"
          style={{ background: "transparent" }}
        />

        {/* ── Right panel: commit form + diff + graph ─────────────── */}
        <div ref={rightPanelRef} className="flex-1 flex flex-col min-w-0">
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
            <div className="flex-1 min-h-0 overflow-hidden flex flex-col select-text" style={{ background: "var(--surface-container-low, #12131a)" }}>
              <div className="flex items-center justify-between px-3 py-1 shrink-0 border-b gap-1" style={{ borderColor: "rgba(255,255,255,0.05)", minHeight: 28 }}>
                <span
                  className="text-[11px] truncate cursor-pointer hover:underline transition-colors"
                  style={{ color: "rgba(232,234,240,0.5)" }}
                  onClick={() => handleOpenOrFocusFile(selectedFile)}
                  title="Open file"
                >
                  {selectedFile}
                </span>
                <div className="flex items-center gap-0.5">
                  {selectedDiff && (
                    <IconButton icon={<ExternalLink />} tooltip="Open diff in new tab" onClick={handleOpenSelectedFileDiff} size="sm" className="w-5 h-5 [&_svg]:w-3 [&_svg]:h-3" />
                  )}
                  <IconButton icon={<X />} tooltip="Close diff view" onClick={handleCloseDiff} size="sm" className="w-5 h-5 [&_svg]:w-3 [&_svg]:h-3" />
                </div>
              </div>
              {selectedDiff !== null ? (
                <CommitDiffView
                  key={selectedFile}
                  diff={selectedDiff}
                  commitHash=""
                  filePath={selectedFile}
                  showBreadcrumb={false}
                  collapsible={true}
                />
              ) : (
                <div className="flex items-center justify-center h-full">
                  <div className="flex flex-col items-center gap-2" style={{ color: "rgba(232,234,240,0.25)" }}>
                    <LoadingSpinner size={16} inline />
                    <span className="text-xs">Loading diff...</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Drag handle for commit history — only when diff is open */}
          {selectedFile && (
            <div
              onMouseDown={startCommitHistoryResize}
              className="shrink-0 h-[4px] cursor-row-resize transition-colors hover:bg-primary/30 relative z-10"
              style={{ background: "transparent" }}
            />
          )}

          {/* Git graph */}
          <div
            className={`${selectedFile ? "shrink-0" : "flex-1 min-h-0"} border-t flex flex-col overflow-hidden`}
            style={{ borderColor: "rgba(255,255,255,0.05)", height: selectedFile ? commitHistoryH : undefined, minHeight: selectedFile ? COMMIT_HISTORY_MIN : undefined }}
          >
            <SectionHeader label="Commit History" />
            <GitTree variant="expanded" />
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
            <MenuViewItem variant="rightclick" onClick={() => { setContextMenu(null); handleUnstage([contextMenu.entry!.path]); }} icon={<Square size={12} />}>
              Unstage
            </MenuViewItem>
          )}
          {(contextMenu.entry.x === " " || contextMenu.entry.x === "?") && (
            <MenuViewItem variant="rightclick" onClick={() => { setContextMenu(null); handleStage([contextMenu.entry!.path]); }} icon={<CheckSquare size={12} />}>
              Stage
            </MenuViewItem>
          )}
          {contextMenu.entry.x === " " && contextMenu.entry.y !== " " && (
            <MenuViewItem variant="rightclick" danger onClick={() => { setContextMenu(null); handleRestore([contextMenu.entry!.path]); }} icon={<Trash2 size={12} />}>
              Discard changes
            </MenuViewItem>
          )}
          <MenuViewSeparator />
          <MenuViewItem variant="rightclick" onClick={() => { setContextMenu(null); handleSelectFile(contextMenu.entry!); }} icon={<Eye size={12} />}>
            View diff
          </MenuViewItem>
        </MenuView>
      )}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────

function SectionHeader({ label, count, action, children }: {
  label: string;
  count?: number;
  action?: { label: string; onClick: () => void } | React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider select-none shrink-0"
      style={{ color: "rgba(232,234,240,0.3)", background: "rgba(255,255,255,0.02)" }}
    >
      <span>{label}</span>
      {count !== undefined && (
        <span className="text-[9px] px-1 rounded" style={{ background: "rgba(255,255,255,0.04)", color: "rgba(232,234,240,0.25)" }}>
          {count}
        </span>
      )}
      <div className="flex-1" />
      {action && (typeof action === "object" && "label" in action ? (
        <IconButton
          onClick={action.onClick}
          tooltip={action.label}
          icon={<X />}
          size="sm"
        />
      ) : action)}
      {children}
    </div>
  );
}

function StagedFileRow({ entry, onUnstage, onOpenFile, onSelect, onContextMenu }: {
  entry: GitStatusEntry;
  onUnstage: () => void;
  onOpenFile: () => void;
  onSelect: () => void;
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
      className="group flex items-center gap-1.5 px-3 py-[7px] text-[12px] transition-colors relative cursor-pointer hover:bg-white/[0.04] hover:text-[#E8EAF0] rounded-none"
      style={{ color: "rgba(232,234,240,0.7)" }}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
      onClick={onSelect}
      onContextMenu={onContextMenu}
    >
      <span className="text-[9px] font-mono shrink-0 px-1 rounded" style={{ color, background: `${color}15` }}>
        {icon}
      </span>
      <span className="truncate flex-1 pr-12">{fileName}</span>
      {dirName && <span className="text-[10px] truncate max-w-[80px]" style={{ color: "rgba(232,234,240,0.25)" }}>{dirName}</span>}
      {showActions && (
        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 group-hover:bg-primary rounded" style={{ pointerEvents: "auto" }}>
          <IconButton icon={<FileSymlink />} tooltip="Open File" onClick={onOpenFile} size="sm" className="w-5 h-5 [&_svg]:w-[11px] [&_svg]:h-[11px] text-white" />
          <IconButton icon={<X />} tooltip="Unstage" onClick={onUnstage} size="sm" className="w-5 h-5 [&_svg]:w-[11px] [&_svg]:h-[11px] text-white" />
        </div>
      )}
    </div>
  );
}

function ChangesFileRow({ entry, onStage, onRestore, onOpenFile, onSelect, onContextMenu }: {
  entry: GitStatusEntry;
  onStage: () => void;
  onRestore?: () => void;
  onOpenFile: () => void;
  onSelect: () => void;
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
      className="group flex items-center gap-1.5 px-3 py-[7px] text-[12px] transition-colors relative cursor-pointer hover:bg-white/[0.04] hover:text-[#E8EAF0] rounded-none"
      style={{ color: "rgba(232,234,240,0.7)" }}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
      onClick={onSelect}
      onContextMenu={onContextMenu}
    >
      <span className="text-[9px] font-mono shrink-0 px-1 rounded" style={{ color, background: `${color}15` }}>
        {icon}
      </span>
      <span className="truncate flex-1 pr-12">{fileName}</span>
      {dirName && <span className="text-[10px] truncate max-w-[80px]" style={{ color: "rgba(232,234,240,0.25)" }}>{dirName}</span>}
      {showActions && (
        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 group-hover:bg-primary rounded" style={{ pointerEvents: "auto" }}>
          <IconButton icon={<FileSymlink />} tooltip="Open File" onClick={onOpenFile} size="sm" className="w-5 h-5 [&_svg]:w-[11px] [&_svg]:h-[11px] text-white" />
          {onRestore && <IconButton icon={<Undo2 />} tooltip="Discard Changes" onClick={onRestore} size="sm" className="w-5 h-5 [&_svg]:w-[11px] [&_svg]:h-[11px] text-white" />}
          <IconButton icon={<Plus />} tooltip="Stage" onClick={onStage} size="sm" className="w-5 h-5 [&_svg]:w-[11px] [&_svg]:h-[11px] text-white" />
        </div>
      )}
    </div>
  );
}


