import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconButton } from "../ui/IconButton";
import { Button } from "../ui/Button";
import { v4 as uuidv4 } from "uuid";
import {
  GitBranch, Search, ArrowUp, ArrowDown, RefreshCw, Plus, X, ChevronDown,
  CheckSquare, Square, Circle, Download, Upload, Trash2, Eye,
  AlertCircle, MoreVertical, GitMerge, GitFork,
  Pencil, ExternalLink, Undo2, FileDiff, FileSymlink, Loader,
} from "lucide-react";
import { system, state as stateIpc } from "../../lib/ipc";
import type { GitStatusEntry, GitBranchInfo } from "../../lib/ipc";
import { useNotificationStore } from "../../stores/useToastStore";
import { useDragResize } from "../../hooks/useDragResize";
import { useSessionStore } from "../../stores/useSessionStore";
import { useGitStore } from "../../stores/useGitStore";
import { useGitWatcher } from "../../hooks/useGitWatcher";
import { isGitViewWindow, openDiffTabInMainWindow } from "../../lib/gitDiffBridge";
import { CommitDiffView } from "../editor/CommitDiffView";
import { GitTree } from "../ui/GitTree";
import { LoadingSpinner } from "../ui/LoadingSpinner";
import { MenuView, MenuViewItem, MenuViewSeparator } from "../ui/MenuView";
import { Input } from "../ui/Input";
import { Modal } from "../ui/Modal";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { BranchCheckoutDialog } from "../ui/BranchCheckoutDialog";
import { ChangesDiffView } from "./ChangesDiffView";
import { SearchableSelect } from "../ui/SearchableSelect";

const STATUS_COLOR: Record<string, string> = {
  M: "rgba(255,179,0,0.75)",
  A: "rgba(80,227,194,0.75)",
  D: "rgba(255,107,107,0.75)",
  R: "rgba(79,140,255,0.75)",
  C: "rgba(80,227,194,0.75)",
  U: "rgba(239,83,80,0.8)",
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

// A file is in a merge conflict when git reports it as unmerged. The porcelain
// `x`/`y` codes for unmerged paths are exactly these seven combinations.
function isConflicted(x: string, y: string): boolean {
  return ["DD", "AU", "UD", "UA", "DU", "AA", "UU"].includes(`${x}${y}`);
}

// Debounce a fast-changing value (used for the per-section file search inputs so
// typing doesn't re-filter the list on every keystroke).
function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

interface GitViewProps {
  cwd: string;
  tabId: string;
}

export function GitView({ cwd, tabId }: GitViewProps) {
  useGitWatcher(cwd);

  const [status, setStatus] = useState<GitStatusEntry[]>([]);
  const [branches, setBranches] = useState<GitBranchInfo[]>([]);
  const [statusLoading, setStatusLoading] = useState(true);
  const [branchesLoading, setBranchesLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [branchesMenuOpen, setBranchesMenuOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; branch?: string; entry?: GitStatusEntry } | null>(null);
  const [showChangesView, setShowChangesView] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [selectedDiff, setSelectedDiff] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const loadingFileRef = useRef<string | null>(null);
  const diffCacheRef = useRef<Map<string, string>>(new Map());
  const [commitMessage, setCommitMessage] = useState("");
  const [checkedBranches, setCheckedBranches] = useState<string[]>([]);
  const hasSavedState = useRef(false);

  // Per-section file search (debounced filtering of the Staged / Changes lists).
  const [stagedSearch, setStagedSearch] = useState("");
  const [changesSearch, setChangesSearch] = useState("");
  const [stagedSearchOpen, setStagedSearchOpen] = useState(false);
  const [changesSearchOpen, setChangesSearchOpen] = useState(false);
  const stagedQuery = useDebouncedValue(stagedSearch, 200);
  const changesQuery = useDebouncedValue(changesSearch, 200);

  // Load checked branches from persisted state on mount.
  // If no saved state exists for this cwd, default to all selected.
  // IMPORTANT: an empty saved array (`[]`) is NOT treated as "has saved state".
  // The persist effect writes `[]` on first mount before branches load, and in the
  // production build `stateIpc.get()` can resolve and observe that `[]` — treating
  // it as authoritative would permanently lock out the default selection and leave
  // the git graph blank ("Select branches to view commit history").
  useEffect(() => {
    stateIpc.get().then(s => {
      const saved = s.checked_branches[cwd];
      if (saved !== undefined && saved.length > 0) {
        hasSavedState.current = true;
        setCheckedBranches(saved);
      }
    }).catch(() => {});
  }, [cwd]);

  // When branches load and nothing is selected, default to current + main/origin/main.
  // `hasSavedState` is only ever set for a *non-empty* saved selection (see load
  // effect), so an empty `[]` can't suppress the default and leave the graph blank.
  useEffect(() => {
    if (!hasSavedState.current && branches.length > 0 && checkedBranches.length === 0) {
      const current = branches.find(b => b.current)?.name;
      const mainLike = branches.find(b => /^main$|^master$/.test(b.name))?.name
        ?? branches.find(b => b.name === "origin/main" || b.name === "origin/master")?.name;
      const defaults = new Set<string>();
      if (current) defaults.add(current);
      if (mainLike && mainLike !== current) defaults.add(mainLike);
      if (defaults.size === 0) {
        setCheckedBranches(branches.map(b => b.name));
      } else {
        setCheckedBranches([...defaults]);
      }
    }
  }, [branches, checkedBranches.length]);

  // Always ensure the current branch is selected when branches change
  useEffect(() => {
    if (branches.length === 0) return;
    const current = branches.find(b => b.current)?.name;
    if (current && !checkedBranches.includes(current)) {
      setCheckedBranches(prev => [...prev, current]);
    }
  }, [branches]);

  // Prune stale checked branches once the real list loads. Deleted/renamed
  // branches stay persisted forever otherwise and make the git graph show
  // "No commits yet" (the Rust layer now also ignores unresolvable refs).
  useEffect(() => {
    if (branches.length === 0) return;
    const validNames = new Set(branches.map(b => b.name));
    setCheckedBranches(prev => {
      const pruned = prev.filter(n => validNames.has(n) || n.startsWith("origin/"));
      return pruned.length === prev.length ? prev : pruned;
    });
  }, [branches]);

  // Persist checked branches whenever they change
  const persistCheckedBranches = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (persistCheckedBranches.current) clearTimeout(persistCheckedBranches.current);
    persistCheckedBranches.current = setTimeout(() => {
      stateIpc.updateCheckedBranches(cwd, checkedBranches).catch(() => {});
    }, 500);
    return () => { if (persistCheckedBranches.current) clearTimeout(persistCheckedBranches.current); };
  }, [cwd, checkedBranches]);

  // Dialog states (replacing alert/prompt/confirm)
  // Git action modals — uniform, theme-matched (select fields + Input component)
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeValue, setMergeValue] = useState("");
  const [rebaseOpen, setRebaseOpen] = useState(false);
  const [rebaseValue, setRebaseValue] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createFrom, setCreateFrom] = useState("");
  const [createName, setCreateName] = useState("");
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const [renameRemoteOpen, setRenameRemoteOpen] = useState(false);
  const [renameRemoteTarget, setRenameRemoteTarget] = useState("");
  const [renameRemoteValue, setRenameRemoteValue] = useState("");
  const [renameRemoteBase, setRenameRemoteBase] = useState("origin");
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; description?: string; confirmLabel?: string; variant?: "danger" | "primary"; onConfirm: () => void } | null>(null);
  const [checkoutDialogOpen, setCheckoutDialogOpen] = useState(false);
  const [allBranches, setAllBranches] = useState<GitBranchInfo[]>([]);

  // Cooldown-guarded remote prune. Deleted upstream branches linger locally as
  // `remotes/origin/<name>` until a `git fetch --prune` runs, which made them
  // show up in the checkout dialog. We prune at most once per cooldown window so
  // we don't hammer the network on every open/refresh.
  const PRUNE_COOLDOWN_MS = 60_000;
  const lastPruneRef = useRef(0);
  const pruneStaleRemotes = useCallback(async () => {
    const now = Date.now();
    if (now - lastPruneRef.current < PRUNE_COOLDOWN_MS) return;
    lastPruneRef.current = now;
    try {
      await system.gitFetchPrune(cwd);
    } catch {
      /* best-effort — offline / auth failures are non-fatal */
    }
  }, [cwd]);

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
  const allChangeFiles = useMemo(
    () => [...unstagedFiles, ...untrackedFiles],
    [unstagedFiles, untrackedFiles]
  );
  const stagedVisible = useMemo(() => {
    const q = stagedQuery.trim().toLowerCase();
    return q ? stagedFiles.filter(e => e.path.toLowerCase().includes(q)) : stagedFiles;
  }, [stagedFiles, stagedQuery]);
  const changesVisible = useMemo(() => {
    const q = changesQuery.trim().toLowerCase();
    return q ? allChangeFiles.filter(e => e.path.toLowerCase().includes(q)) : allChangeFiles;
  }, [allChangeFiles, changesQuery]);
  const currentBranch = useMemo(() =>
    branches.find(b => b.current)?.name || "main",
    [branches]
  );
  const aheadBehind = useMemo(() => {
    const cur = branches.find(b => b.current);
    if (!cur) return { ahead: 0, behind: 0 };
    return { ahead: cur.ahead, behind: cur.behind };
  }, [branches]);

  // Local-only branches (for merge / rebase selectors)
  const localBranchOptions = useMemo(
    () => branches.map(b => ({ id: b.name, label: b.name })),
    [branches]
  );
  // Local + origin/* branches (for "create branch from" selector)
  const allBranchOptions = useMemo(
    () => allBranches.map(b => ({ id: b.name, label: b.name })),
    [allBranches]
  );
  // Repository default branch (main/master), resolved once from the loaded list.
  const defaultBranch = useMemo(() => {
    const names = branches.map(b => b.name);
    return (
      names.find(n => n === "main") ||
      names.find(n => n === "master") ||
      names.find(n => n === "origin/main") ||
      names.find(n => n === "origin/master") ||
      currentBranch
    );
  }, [branches, currentBranch]);

  // Remote-tracking branches (remotes/*), shown in a separate group.
  const remoteBranches = useMemo(
    () => allBranches.filter(b => b.name.startsWith("remotes/")),
    [allBranches]
  );

  // Try cache first, fall back to fetch
  const refreshStatus = useCallback(async () => {
    const cached = useGitStore.getState().getStatus(cwd);
    if (cached) {
      setStatus(cached);
      setStatusLoading(false);
      return;
    }
    setStatusLoading(true);
    try {
      const data = await system.gitStatus(cwd);
      useGitStore.getState().setStatus(cwd, data);
      setStatus(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setStatusLoading(false);
    }
  }, [cwd]);

  const refreshBranches = useCallback(async () => {
    const cached = useGitStore.getState().getBranches(cwd);
    if (cached) {
      setBranches(cached);
      setBranchesLoading(false);
      return;
    }
    setBranchesLoading(true);
    try {
      const data = await system.gitBranchList(cwd);
      useGitStore.getState().setBranches(cwd, data);
      setBranches(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setBranchesLoading(false);
    }
  }, [cwd]);

  const refreshAllBranches = useCallback(async () => {
    try {
      const data = await system.gitBranchListAll(cwd);
      setAllBranches(data);
    } catch {
      /* non-fatal — local list is still available */
    }
  }, [cwd]);

  const loadData = useCallback(async () => {
    setError(null);
    // Fetched once on window start; reused by checkout / create-from selectors.
    await Promise.all([refreshStatus(), refreshBranches(), refreshAllBranches()]);
  }, [refreshStatus, refreshBranches, refreshAllBranches]);

  useEffect(() => { loadData(); }, [loadData]);

  // Live, cooldown-gated prune so the remote branch list stays fresh without
  // spamming the network (pruneStaleRemotes itself enforces the cooldown).
  useEffect(() => {
    const id = setInterval(() => { void pruneStaleRemotes(); }, 30_000);
    return () => clearInterval(id);
  }, [pruneStaleRemotes]);

  // Reset branch selection when repo changes
  useEffect(() => { setCheckedBranches([]); lastPruneRef.current = 0; }, [cwd]);

  const clearDiffCache = useCallback(() => { diffCacheRef.current.clear(); }, []);

  const handleStage = useCallback(async (paths: string[]) => {
    try {
      await system.gitAdd(cwd, paths);
      clearDiffCache();
      useGitStore.getState().invalidateStatus(cwd);
      await refreshStatus();
    } catch (e) { console.error(e); }
  }, [cwd, refreshStatus, clearDiffCache]);

  const handleUnstage = useCallback(async (paths: string[]) => {
    try {
      await system.gitReset(cwd, paths);
      clearDiffCache();
      useGitStore.getState().invalidateStatus(cwd);
      await refreshStatus();
    } catch (e) { console.error(e); }
  }, [cwd, refreshStatus, clearDiffCache]);

  const handleRestore = useCallback(async (paths: string[]) => {
    try {
      await system.gitReset(cwd, paths).catch(() => {});
      await system.gitRestore(cwd, paths);
      clearDiffCache();
      useGitStore.getState().invalidateStatus(cwd);
      await refreshStatus();
    } catch (e) { console.error(e); }
  }, [cwd, refreshStatus, clearDiffCache]);

  const handleClean = useCallback(async (paths: string[]) => {
    try {
      await system.gitClean(cwd, paths);
      clearDiffCache();
      useGitStore.getState().invalidateStatus(cwd);
      await refreshStatus();
    } catch (e) { console.error(e); }
  }, [cwd, refreshStatus, clearDiffCache]);

  const handleCommit = useCallback(async () => {
    if (!commitMessage.trim()) return;
    try {
      const hash = await system.gitCommit(cwd, commitMessage.trim());
      setCommitMessage("");
      clearDiffCache();
      useGitStore.getState().invalidateStatus(cwd);
      useGitStore.getState().invalidateBranches(cwd);
      await Promise.all([refreshStatus(), refreshBranches()]);
    } catch (e) { console.error(e); }
  }, [cwd, commitMessage, refreshStatus, refreshBranches, clearDiffCache]);

  const handleCheckout = useCallback(async (branch: string) => {
    try {
      await system.gitCheckout(cwd, branch);
      clearDiffCache();
      useGitStore.getState().invalidateAll(cwd);
      await Promise.all([refreshStatus(), refreshBranches()]);
    } catch (e) { addNotification(e); }
  }, [cwd, refreshStatus, refreshBranches, clearDiffCache]);

  const handleOpenCheckoutDialog = useCallback(async () => {
    try {
      // Prune stale remote-tracking refs first so deleted upstream branches are
      // not offered in the checkout list.
      await pruneStaleRemotes();
      const branches = await system.gitBranchListAll(cwd);
      setAllBranches(branches);
      setCheckoutDialogOpen(true);
    } catch (e) { addNotification(e); }
  }, [cwd, pruneStaleRemotes]);

  const [gitLoading, setGitLoading] = useState<Record<string, boolean>>({});
  const addNotification = useNotificationStore((s) => s.addNotification);

  const withLoading = useCallback(async (key: string, fn: () => Promise<void>) => {
    setGitLoading((prev) => ({ ...prev, [key]: true }));
    try {
      await fn();
    } catch (e) {
      addNotification(e);
    } finally {
      setGitLoading((prev) => ({ ...prev, [key]: false }));
      useGitStore.getState().invalidateBranches(cwd);
      await refreshBranches();
    }
  }, [cwd, refreshBranches, addNotification]);

  const handlePush = useCallback(() => {
    withLoading("push", async () => {
      await system.gitPush(cwd, "origin", currentBranch);
      clearDiffCache();
      useGitStore.getState().invalidateBranches(cwd);
    });
  }, [cwd, currentBranch, withLoading, clearDiffCache]);

  const handlePull = useCallback(() => {
    withLoading("pull", async () => {
      await system.gitPull(cwd, "origin", currentBranch);
      clearDiffCache();
      useGitStore.getState().invalidateAll(cwd);
      await refreshStatus();
    });
  }, [cwd, currentBranch, withLoading, clearDiffCache, refreshStatus]);

  const handleFetch = useCallback(() => {
    withLoading("fetch", async () => {
      await system.gitFetch(cwd, "origin");
      // Also prune so server-deleted branches disappear from the local refs.
      await pruneStaleRemotes();
      clearDiffCache();
      useGitStore.getState().invalidateAll(cwd);
      await refreshStatus();
    });
  }, [cwd, withLoading, clearDiffCache, refreshStatus, pruneStaleRemotes]);

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

  // ── Branch actions ─────────────────────────────────────────────
  // ── Branch actions (open uniform, theme-matched modals) ─────────
  const openMerge = useCallback((branch: string) => {
    setMergeValue(branch);
    setMergeOpen(true);
  }, []);
  const confirmMerge = useCallback(async () => {
    if (!mergeValue) return;
    setMergeOpen(false);
    try {
      await system.gitExec(cwd, ["merge", mergeValue]);
      clearDiffCache();
      useGitStore.getState().invalidateAll(cwd);
      await Promise.all([refreshStatus(), refreshBranches()]);
    } catch (e) { addNotification(e); }
  }, [cwd, mergeValue, refreshStatus, refreshBranches, clearDiffCache]);

  const openRebase = useCallback(() => {
    setRebaseValue(defaultBranch);
    setRebaseOpen(true);
  }, [defaultBranch]);
  const confirmRebase = useCallback(async () => {
    if (!rebaseValue) return;
    setRebaseOpen(false);
    try {
      await system.gitExec(cwd, ["rebase", rebaseValue]);
      clearDiffCache();
      useGitStore.getState().invalidateAll(cwd);
      await Promise.all([refreshStatus(), refreshBranches()]);
    } catch (e) { addNotification(e); }
  }, [cwd, rebaseValue, refreshStatus, refreshBranches, clearDiffCache]);

  const handleRebaseBranch = useCallback(async (branch: string) => {
    if (!branch || branch === currentBranch) return;
    try {
      // Rebase the selected branch onto the current branch, then return to the
      // originally checked-out branch so the user's context is unchanged.
      await system.gitExec(cwd, ["rebase", currentBranch, branch]);
      await system.gitExec(cwd, ["checkout", currentBranch]);
      clearDiffCache();
      useGitStore.getState().invalidateAll(cwd);
      await Promise.all([refreshStatus(), refreshBranches()]);
    } catch (e) { addNotification(e); }
  }, [cwd, currentBranch, refreshStatus, refreshBranches, clearDiffCache]);

  const openCreate = useCallback(() => {
    setCreateFrom(currentBranch);
    setCreateName("");
    setCreateOpen(true);
  }, [currentBranch]);
  const confirmCreate = useCallback(async () => {
    const name = createName.trim();
    if (!name) return;
    setCreateOpen(false);
    try {
      await system.gitBranchCreate(cwd, name, createFrom || undefined);
      useGitStore.getState().invalidateBranches(cwd);
      await refreshBranches();
    } catch (e) { addNotification(e); }
  }, [cwd, createName, createFrom, refreshBranches]);

  const openRename = useCallback((branch: string) => {
    setRenameTarget(branch);
    setRenameValue(branch);
    setRenameOpen(true);
  }, []);
  const confirmRename = useCallback(async () => {
    const name = renameValue.trim();
    if (!name) return;
    setRenameOpen(false);
    try {
      if (renameTarget === currentBranch) {
        await system.gitExec(cwd, ["branch", "-m", name]);
      } else {
        await system.gitExec(cwd, ["branch", "-m", renameTarget, name]);
      }
      useGitStore.getState().invalidateBranches(cwd);
      await refreshBranches();
    } catch (e) { addNotification(e); }
  }, [cwd, renameTarget, renameValue, currentBranch, refreshBranches]);

  const openRenameRemote = useCallback((branch: string) => {
    const info = allBranches.find(b => b.name === branch) || branches.find(b => b.name === branch);
    setRenameRemoteTarget(branch);
    setRenameRemoteBase(info?.remote || "origin");
    setRenameRemoteValue("");
    setRenameRemoteOpen(true);
  }, [allBranches, branches]);
  const confirmRenameRemote = useCallback(async () => {
    const name = renameRemoteValue.trim();
    if (!name) return;
    setRenameRemoteOpen(false);
    try {
      await system.gitExec(cwd, ["push", renameRemoteBase, `:${renameRemoteTarget}`]);
      await system.gitExec(cwd, ["push", renameRemoteBase, name]);
      useGitStore.getState().invalidateBranches(cwd);
      await refreshBranches();
    } catch (e) { addNotification(e); }
  }, [cwd, renameRemoteBase, renameRemoteTarget, renameRemoteValue, refreshBranches]);

  const handleDeleteBranch = useCallback(async (branch: string) => {
    setConfirmDialog({
      title: "Delete Branch",
      description: `Delete branch "${branch}"?`,
      confirmLabel: "Delete",
      variant: "danger",
      onConfirm: async () => {
        try {
          await system.gitBranchDelete(cwd, branch, true);
          useGitStore.getState().invalidateBranches(cwd);
          await refreshBranches();
        } catch (e) { addNotification(e); }
      },
    });
  }, [cwd, refreshBranches]);

  const handlePublishBranch = useCallback(async (branch: string) => {
    try {
      await system.gitPush(cwd, "origin", branch);
      useGitStore.getState().invalidateBranches(cwd);
      await refreshBranches();
    } catch (e) { addNotification(e); }
  }, [cwd, refreshBranches]);

  const addTab = useSessionStore(s => s.addTab);
  const setActiveTabId = useSessionStore(s => s.setActiveTabId);
  const tabs = useSessionStore(s => s.tabs);

  const handleOpenFile = useCallback(async (filePath: string) => {
    const isAbs = /^[A-Z]:[/\\]|^[/\\]|^~/i.test(filePath);
    const resolvedPath = !isAbs && cwd ? `${cwd}/${filePath}`.replace(/\/\//g, "/") : filePath;

    // Check for actual merge conflict markers in file content
    let type: "file" | "merge" = "file";
    try {
      const content = await system.readFileContent(resolvedPath);
      if (content.includes("<<<<<<<") && content.includes("=======") && content.includes(">>>>>>>")) {
        type = "merge";
      }
    } catch {}

    const existing = tabs.find(t => t.type === type && t.filePath === resolvedPath && t.cwd === cwd);
    if (existing) { setActiveTabId(existing.id); return; }
    const fileName = filePath.split(/[\\/]/).pop() || filePath;
    const name = type === "merge" ? `Merge: ${fileName}` : fileName;
    const id = uuidv4();
    addTab({ id, name, type, filePath: resolvedPath, cwd, created_at: Date.now() });
    setActiveTabId(id);
  }, [cwd, tabs, addTab, setActiveTabId]);

  const handleOpenDiff = useCallback(async (diffFn: (cwd: string, path?: string) => Promise<string>, title: string) => {
    const existing = useSessionStore.getState().tabs.find(t => t.type === "diff" && t.name === title);
    if (existing) { setActiveTabId(existing.id); return; }
    try {
      const diff = await diffFn(cwd);
      const id = uuidv4();
      if (isGitViewWindow()) {
        await openDiffTabInMainWindow({ id, name: title, type: "diff", diffContent: diff, created_at: Date.now() });
      } else {
        addTab({ id, name: title, type: "diff", diffContent: diff, created_at: Date.now() });
        setActiveTabId(id);
      }
    } catch (e) { console.error(e); }
  }, [cwd, addTab, setActiveTabId]);

  const handleSelectFile = useCallback(async (entry: GitStatusEntry, staged?: boolean) => {
    const path = entry.path;
    const showStaged = staged ?? (entry.x !== " " && entry.x !== "?" && entry.x !== "!");
    const cacheKey = `${showStaged ? "staged" : "unstaged"}:${path}`;
    const cached = diffCacheRef.current.get(cacheKey);
    if (cached !== undefined) {
      loadingFileRef.current = path;
      setSelectedFile(path);
      setSelectedDiff(cached);
      return;
    }
    loadingFileRef.current = path;
    setSelectedFile(path);
    setSelectedDiff(null);
    setDiffLoading(true);
    try {
      const diff = showStaged
        ? await system.gitDiffStaged(cwd, path)
        : await system.gitDiffUnstaged(cwd, path);
      diffCacheRef.current.set(cacheKey, diff);
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
    const isAbs = /^[A-Z]:[/\\]|^[/\\]|^~/i.test(path);
    const resolvedPath = !isAbs && cwd ? `${cwd}/${path}`.replace(/\/\//g, "/") : path;
    const existing = useSessionStore.getState().tabs.find(t => t.type === "diff" && t.filePath === resolvedPath && !t.diffCommitHash);
    if (existing) { setActiveTabId(existing.id); return; }
    try {
      const isStaged = stagedFiles.some(e => e.path === path);
      const cacheKey = `${isStaged ? "staged" : "unstaged"}:${path}`;
      let diff = diffCacheRef.current.get(cacheKey);
      if (diff === undefined) {
        diff = await (isStaged ? system.gitDiffStaged(cwd, path) : system.gitDiffUnstaged(cwd, path));
        diffCacheRef.current.set(cacheKey, diff);
      }
      const id = uuidv4();
      const name = path.split(/[\\/]/).pop() || path;
      if (isGitViewWindow()) {
        await openDiffTabInMainWindow({ id, name, type: "diff", filePath: resolvedPath, diffContent: diff, created_at: Date.now() });
      } else {
        addTab({ id, name, type: "diff", filePath: resolvedPath, diffContent: diff, created_at: Date.now() });
        setActiveTabId(id);
      }
    } catch (e) { console.error(e); }
  }, [selectedFile, cwd, stagedFiles, addTab, setActiveTabId]);

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

  if (error && status.length === 0 && branches.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-surface-container-low gap-3">
      <AlertCircle size={28} className="text-error" />
      <span className="text-sm text-on-surface-variant">{error}</span>
      <Button variant="outline" size="sm" onClick={loadData}>Retry</Button>
      </div>
    );
  }

  const stagedForCommit = stagedFiles.length > 0;

  return (
    <div className="flex flex-col h-full w-full bg-surface-container-low select-none" style={{ minHeight: 0 }}>
      {/* ── Toolbar ─────────────────────────────────────────────────── */}
      <div
        className="flex items-center gap-2 px-3 shrink-0 border-b"
        style={{ height: 40, borderColor: "var(--color-outline-variant)" }}
      >
        <SearchableSelect
          value={currentBranch}
          options={branches.map(b => ({ id: b.name, label: b.name }))}
          onChange={handleCheckout}
          placeholder={branchesLoading ? "Loading…" : "Select branch"}
          className="w-[200px]"
        />

        {(aheadBehind.ahead > 0 || aheadBehind.behind > 0) && (
          <div className="flex items-center gap-1 text-[11px] px-2 py-1 rounded" style={{ color: "rgba(232,234,240,0.4)", background: "rgba(255,255,255,0.03)" }}>
            {aheadBehind.ahead > 0 && <><ArrowUp size={11} style={{ color: "#50E3C2" }} /><span>{aheadBehind.ahead}</span></>}
            {aheadBehind.behind > 0 && <><ArrowDown size={11} style={{ color: "var(--color-error)" }} /><span>{aheadBehind.behind}</span></>}
          </div>
        )}

        <div className="w-px h-4 bg-white/6" />

        <button onClick={handlePull} disabled={gitLoading.pull} className="flex items-center gap-1 px-1.5 py-1 rounded-lg text-[11px] font-medium transition-colors cursor-pointer hover:bg-white/6 disabled:opacity-40 disabled:cursor-not-allowed" style={{ color: "rgba(232,234,240,0.5)" }}>{gitLoading.pull ? <Loader size={13} className="animate-spin" /> : <Download size={13} />} Pull</button>
        <button onClick={handlePush} disabled={gitLoading.push || aheadBehind.ahead === 0} className="flex items-center gap-1 px-1.5 py-1 rounded-lg text-[11px] font-medium transition-colors cursor-pointer hover:bg-white/6 disabled:opacity-40 disabled:cursor-not-allowed" style={{ color: "rgba(232,234,240,0.5)" }}>{gitLoading.push ? <Loader size={13} className="animate-spin" /> : <Upload size={13} />} Push</button>
        <button onClick={handleFetch} disabled={gitLoading.fetch} className="flex items-center gap-1 px-1.5 py-1 rounded-lg text-[11px] font-medium transition-colors cursor-pointer hover:bg-white/6 disabled:opacity-40 disabled:cursor-not-allowed" style={{ color: "rgba(232,234,240,0.5)" }}>{gitLoading.fetch ? <Loader size={13} className="animate-spin" /> : <RefreshCw size={13} />} Fetch</button>

        <div className="flex-1" />

        <IconButton icon={<RefreshCw size={13} />} tooltip="Refresh" onClick={loadData} size="sm" className="w-7 h-7 [&_svg]:w-[13px] [&_svg]:h-[13px]" variant="ghost" />
      </div>

      {/* ── Main content: resizable left/right panels ──────────────── */}
      <div className="flex flex-1 min-h-0">
        {/* ── Left panel ──────────────────────────────────────────── */}
        <div ref={leftPanelRef} style={{ width: leftWidth, minWidth: 0, borderColor: "var(--color-outline-variant)" }} className="flex flex-col shrink-0 border-r relative">

          {/* Branches */}
          <div className="shrink-0 flex flex-col" style={{ height: sectionHeights.branches }}>
            <SectionHeader label="Branches" count={branches.length} loading={branchesLoading}
              action={
                <div className="relative">
                  <button onClick={e => { e.stopPropagation(); setBranchesMenuOpen(!branchesMenuOpen); }}
                    className="p-0.5 rounded cursor-pointer hover:bg-white/5 transition-colors" style={{ color: "rgba(232,234,240,0.3)" }}>
                    <MoreVertical size={13} />
                  </button>
                  {branchesMenuOpen && (
                    <MenuView variant="secondary" open={branchesMenuOpen} onClose={() => setBranchesMenuOpen(false)} className="absolute right-0 top-full">
                      <MenuViewItem variant="secondary" onClick={() => { setBranchesMenuOpen(false); handleOpenCheckoutDialog(); }} icon={<GitBranch size={12} />}>Checkout to</MenuViewItem>
                      <MenuViewSeparator />
                      <MenuViewItem variant="secondary" onClick={() => { setBranchesMenuOpen(false); openMerge(currentBranch); }} icon={<GitMerge size={12} />}>Merge</MenuViewItem>
                      <MenuViewItem variant="secondary" onClick={() => { setBranchesMenuOpen(false); openRebase(); }} icon={<GitFork size={12} />}>Rebase branch</MenuViewItem>
                      <MenuViewSeparator />
                      <MenuViewItem variant="secondary" onClick={() => { setBranchesMenuOpen(false); openCreate(); }} icon={<Plus size={12} />}>Create branch</MenuViewItem>
                      <MenuViewItem variant="secondary" onClick={() => { setBranchesMenuOpen(false); openCreate(); }} icon={<GitBranch size={12} />}>Create branch from</MenuViewItem>
                      <MenuViewSeparator />
                      <MenuViewItem variant="secondary" onClick={() => { setBranchesMenuOpen(false); openRenameRemote(currentBranch); }} icon={<ExternalLink size={12} />}>Rename remote branch</MenuViewItem>
                    </MenuView>
                  )}
                </div>
              } />
            <div className="flex-1 min-h-0 overflow-y-auto px-1.5 py-1">
              {branchesLoading ? (
                <div className="flex items-center justify-center h-full">
                  <LoadingSpinner size={14} inline />
                </div>
              ) : (
                <>
                  {branches.length === 0 ? (
                    <div className="px-1.5 py-2 text-[11px]" style={{ color: "rgba(232,234,240,0.25)" }}>No local branches</div>
                  ) : branches.map(b => (
                    <BranchRow
                      key={b.name}
                      branch={b}
                      checked={checkedBranches.includes(b.name)}
                      isRemote={false}
                      onToggle={() => { if (b.current) return; setCheckedBranches(prev => prev.includes(b.name) ? prev.filter(n => n !== b.name) : [...prev, b.name]); }}
                      onContextMenu={e => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, branch: b.name }); }}
                    />
                  ))}
                  {remoteBranches.length > 0 && (
                    <>
                      <div className="px-1.5 pt-2.5 pb-1 text-[9px] font-semibold uppercase tracking-wider" style={{ color: "rgba(232,234,240,0.25)" }}>Remotes</div>
                      {remoteBranches.map(b => (
                        <BranchRow
                          key={b.name}
                          branch={b}
                          checked={checkedBranches.includes(b.name)}
                          isRemote={true}
                          onToggle={() => setCheckedBranches(prev => prev.includes(b.name) ? prev.filter(n => n !== b.name) : [...prev, b.name])}
                        />
                      ))}
                    </>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Resize handle */}
          <div onMouseDown={e => startSectionResize("branches", e)} className="shrink-0 h-[4px] cursor-row-resize transition-colors hover:bg-primary/20 relative z-10" style={{ background: "transparent" }} />

          {/* Staged */}
          <div className="shrink-0 flex flex-col overflow-hidden" style={{ height: sectionHeights.staged }}>
            <SectionHeader label="Staged" count={stagedFiles.length} loading={statusLoading}>
              {stagedFiles.length > 0 && <>
                <IconButton icon={<Search />} tooltip="Search staged files" onClick={() => setStagedSearchOpen(o => !o)} size="sm" className="w-5 h-5 [&_svg]:w-3 [&_svg]:h-3" />
                <IconButton icon={<FileDiff />} tooltip="Open Staged Changes" onClick={() => handleOpenDiff(system.gitDiffStaged, "Staged changes")} size="sm" className="w-5 h-5 [&_svg]:w-3 [&_svg]:h-3" />
                <IconButton icon={<X />} tooltip="Unstage All" onClick={() => handleUnstage(stagedFiles.map(e => e.path))} size="sm" className="w-5 h-5 [&_svg]:w-3 [&_svg]:h-3" />
              </>}
            </SectionHeader>
            {stagedSearchOpen && (
              <div className="px-3 py-1.5 border-b border-outline-variant/60">
                <SectionSearchBar
                  value={stagedSearch}
                  onChange={setStagedSearch}
                  onClose={() => { setStagedSearch(""); setStagedSearchOpen(false); }}
                />
              </div>
            )}
            <div className="flex-1 min-h-0 overflow-y-auto">
              {statusLoading ? (
                <div className="flex items-center justify-center h-full">
                  <LoadingSpinner size={14} inline />
                </div>
              ) : stagedFiles.length === 0 ? (
                <div className="px-3 py-2 text-[11px]" style={{ color: "rgba(232,234,240,0.25)" }}>No staged changes</div>
              ) : stagedVisible.length === 0 ? (
                <div className="px-3 py-2 text-[11px]" style={{ color: "rgba(232,234,240,0.25)" }}>No matches</div>
              ) : (
                stagedVisible.map(e => (
                  <StagedFileRow key={`staged-${e.path}`} entry={e}
                    onUnstage={() => handleUnstage([e.path])}
                    onOpenFile={() => handleOpenFile(e.path)}
                    onSelect={() => handleSelectFile(e, true)}
                    onContextMenu={ev => { ev.preventDefault(); setContextMenu({ x: ev.clientX, y: ev.clientY, entry: e }); }} />
                ))
              )}
            </div>
          </div>

          {/* Resize handle */}
          <div onMouseDown={e => startSectionResize("staged", e)} className="shrink-0 h-[4px] cursor-row-resize transition-colors hover:bg-primary/20 relative z-10" style={{ background: "transparent" }} />

          {/* Changes (fills remaining) */}
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <SectionHeader label="Changes" count={unstagedFiles.length + untrackedFiles.length} loading={statusLoading}>
              {(unstagedFiles.length + untrackedFiles.length) > 0 && <>
                <IconButton icon={<Search />} tooltip="Search changes" onClick={() => setChangesSearchOpen(o => !o)} size="sm" className="w-5 h-5 [&_svg]:w-3 [&_svg]:h-3" />
                <IconButton icon={<FileDiff />} tooltip="Open Changes" onClick={() => { setShowChangesView(true); setSelectedFile(null); setSelectedDiff(null); }} size="sm" className="w-5 h-5 [&_svg]:w-3 [&_svg]:h-3" />
                <IconButton icon={<Undo2 />} tooltip="Discard All Changes" onClick={() => {
                  const tracked = unstagedFiles.map(e => e.path);
                  const untracked = untrackedFiles.map(e => e.path);
                  if (tracked.length > 0) handleRestore(tracked);
                  if (untracked.length > 0) handleClean(untracked);
                }} size="sm" className="w-5 h-5 [&_svg]:w-3 [&_svg]:h-3" />
                <IconButton icon={<Plus />} tooltip="Stage All Changes" onClick={() => {
                  const all = [...unstagedFiles, ...untrackedFiles];
                  if (all.length > 0) handleStage(all.map(e => e.path));
                }} size="sm" className="w-5 h-5 [&_svg]:w-3 [&_svg]:h-3" />
              </>}
            </SectionHeader>
            {changesSearchOpen && (
              <div className="px-3 py-1.5 border-b border-outline-variant/60">
                <SectionSearchBar
                  value={changesSearch}
                  onChange={setChangesSearch}
                  onClose={() => { setChangesSearch(""); setChangesSearchOpen(false); }}
                />
              </div>
            )}
            <div className="flex-1 min-h-0 overflow-y-auto">
              {statusLoading ? (
                <div className="flex items-center justify-center h-full">
                  <LoadingSpinner size={14} inline />
                </div>
              ) : (unstagedFiles.length === 0 && untrackedFiles.length === 0) ? (
                <div className="px-3 py-2 text-[11px]" style={{ color: "rgba(232,234,240,0.25)" }}>No changes</div>
              ) : changesVisible.length === 0 ? (
                <div className="px-3 py-2 text-[11px]" style={{ color: "rgba(232,234,240,0.25)" }}>No matches</div>
              ) : (
                changesVisible.map(e => (
                  <ChangesFileRow key={`change-${e.path}`} entry={e}
                    onStage={() => handleStage([e.path])}
                    onRestore={e.y !== " " && e.y !== "?" ? () => handleRestore([e.path]) : undefined}
                    onDelete={e.x === "?" ? () => handleClean([e.path]) : undefined}
                    onOpenFile={() => handleOpenFile(e.path)}
                    onSelect={() => handleSelectFile(e, false)}
                    onContextMenu={ev => { ev.preventDefault(); setContextMenu({ x: ev.clientX, y: ev.clientY, entry: e }); }} />
                ))
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
            style={{ borderColor: "var(--color-outline-variant)" }}
          >
            <input
              value={commitMessage}
              onChange={e => setCommitMessage(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && e.ctrlKey && stagedForCommit) handleCommit(); }}
              placeholder={stagedForCommit ? "Commit message…" : "Stage changes to commit…"}
              className="flex-1 bg-transparent outline-none text-[13px] text-on-surface placeholder:text-white/25"
            />
            <Button
              onClick={handleCommit}
              disabled={!commitMessage.trim() || !stagedForCommit}
              variant="primary"
              size="sm"
            >
              Commit to {currentBranch}
            </Button>
          </div>

          {/* Changes overview (multi-file diff) */}
          {showChangesView && (
            <div className="flex-1 min-h-0 overflow-hidden flex flex-col" style={{ background: "var(--surface-container-low, #12131a)" }}>
              <ChangesDiffView
                files={[...unstagedFiles, ...untrackedFiles]}
                cwd={cwd}
                onClose={() => setShowChangesView(false)}
                onOpenFile={(path) => handleOpenOrFocusFile(path)}
              />
            </div>
          )}

          {/* Single file diff view */}
          {!showChangesView && selectedFile && (
            <div className="flex-1 min-h-0 overflow-hidden flex flex-col select-text" style={{ background: "var(--surface-container-low, #12131a)" }}>
              <div className="flex items-center justify-between px-3 py-1 shrink-0 border-b gap-1" style={{ borderColor: "var(--color-outline-variant)", minHeight: 28 }}>
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
          {!showChangesView && selectedFile && (
            <div
              onMouseDown={startCommitHistoryResize}
              className="shrink-0 h-[4px] cursor-row-resize transition-colors hover:bg-primary/30 relative z-10"
              style={{ background: "transparent" }}
            />
          )}

          {/* Git graph */}
          <div
            className={`${selectedFile ? "shrink-0" : "flex-1 min-h-0"} border-t flex flex-col overflow-hidden`}
            style={{ borderColor: "var(--color-outline-variant)", height: selectedFile ? commitHistoryH : undefined, minHeight: selectedFile ? COMMIT_HISTORY_MIN : undefined }}
          >
            <SectionHeader label="Commit History" />
            {/* Always render the graph. When nothing is explicitly selected we
                fall back to all branches (branchNames undefined → Rust `--all`),
                so the graph is never blank even if `branches` failed to load
                (e.g. gitBranchList errored in a strict runner). The branch
                checkboxes above still narrow the view when a selection exists. */}
            <GitTree
              variant="expanded"
              cwd={cwd}
              branchNames={checkedBranches.length > 0 ? checkedBranches : undefined}
            />
          </div>
        </div>
      </div>

      {/* ── Right-click context menus ────────────────────────────── */}
      {contextMenu?.branch && (
        <MenuView variant="rightclick" open={!!contextMenu} onClose={() => setContextMenu(null)} anchorX={contextMenu.x} anchorY={contextMenu.y}>
          <MenuViewItem variant="rightclick" onClick={() => { setContextMenu(null); openMerge(contextMenu.branch!); }} icon={<GitMerge size={12} />}>
            Merge into current
          </MenuViewItem>
          <MenuViewItem variant="rightclick" onClick={() => { setContextMenu(null); handleRebaseBranch(contextMenu.branch!); }} icon={<GitFork size={12} />}>
            Rebase onto current
          </MenuViewItem>
          <MenuViewSeparator />
          <MenuViewItem variant="rightclick" onClick={() => { setContextMenu(null); openRename(contextMenu.branch!); }} icon={<Pencil size={12} />}>
            Rename
          </MenuViewItem>
          <MenuViewItem variant="rightclick" onClick={() => { setContextMenu(null); handleDeleteBranch(contextMenu.branch!); }} icon={<Trash2 size={12} />}>
            Delete
          </MenuViewItem>
          <MenuViewSeparator />
          <MenuViewItem variant="rightclick" onClick={() => { setContextMenu(null); handlePublishBranch(contextMenu.branch!); }} icon={<Upload size={12} />}>
            Publish
          </MenuViewItem>
          <MenuViewItem variant="rightclick" onClick={() => { setContextMenu(null); openRenameRemote(contextMenu.branch!); }} icon={<ExternalLink size={12} />}>
            Rename remote
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
          {contextMenu.entry.x === " " && (
            <MenuViewItem variant="rightclick" onClick={() => { setContextMenu(null); handleStage([contextMenu.entry!.path]); }} icon={<CheckSquare size={12} />}>
              Stage
            </MenuViewItem>
          )}
          {contextMenu.entry.x !== "?" && (
            <MenuViewItem variant="rightclick" danger onClick={() => { setContextMenu(null); handleRestore([contextMenu.entry!.path]); }} icon={<Undo2 size={12} />}>
              Discard changes
            </MenuViewItem>
          )}
          {contextMenu.entry.x === "?" && (
            <>
              <MenuViewItem variant="rightclick" onClick={() => { setContextMenu(null); handleStage([contextMenu.entry!.path]); }} icon={<CheckSquare size={12} />}>
                Stage
              </MenuViewItem>
              <MenuViewItem variant="rightclick" danger onClick={() => { setContextMenu(null); handleClean([contextMenu.entry!.path]); }} icon={<Trash2 size={12} />}>
                Delete file
              </MenuViewItem>
            </>
          )}
          <MenuViewSeparator />
          <MenuViewItem variant="rightclick" onClick={() => { setContextMenu(null); handleSelectFile(contextMenu.entry!); }} icon={<Eye size={12} />}>
            View diff
          </MenuViewItem>
        </MenuView>
      )}

      {/* ── Dialogs ──────────────────────────────────────────────── */}
      <Modal open={mergeOpen} onClose={() => setMergeOpen(false)} onConfirm={confirmMerge} title="Merge Branch" description={`Merge a branch into ${currentBranch}`}>
        <div className="flex flex-col gap-3">
          <SearchableSelect value={mergeValue} options={localBranchOptions} onChange={setMergeValue} placeholder="Select branch to merge" className="w-full" />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setMergeOpen(false)}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={confirmMerge} disabled={!mergeValue}>Merge</Button>
          </div>
        </div>
      </Modal>

      <Modal open={rebaseOpen} onClose={() => setRebaseOpen(false)} onConfirm={confirmRebase} title="Rebase Branch" description={`Rebase ${currentBranch} onto:`}>
        <div className="flex flex-col gap-3">
          <SearchableSelect value={rebaseValue} options={localBranchOptions} onChange={setRebaseValue} placeholder="Select base branch" className="w-full" />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setRebaseOpen(false)}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={confirmRebase} disabled={!rebaseValue}>Rebase</Button>
          </div>
        </div>
      </Modal>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} onConfirm={confirmCreate} title="Create Branch">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-[11px]" style={{ color: "var(--color-on-surface-variant)" }}>From branch</span>
            <SearchableSelect value={createFrom} options={allBranchOptions} onChange={setCreateFrom} placeholder="Select start point" className="w-full" />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[11px]" style={{ color: "var(--color-on-surface-variant)" }}>Branch name</span>
            <Input variant="text" value={createName} onChange={setCreateName} placeholder="my-new-branch" />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={confirmCreate} disabled={!createName.trim()}>Create</Button>
          </div>
        </div>
      </Modal>

      <Modal open={renameOpen} onClose={() => setRenameOpen(false)} onConfirm={confirmRename} title="Rename Branch" description={`Rename "${renameTarget}" to:`}>
        <div className="flex flex-col gap-3">
          <Input variant="text" value={renameValue} onChange={setRenameValue} placeholder="New branch name" />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setRenameOpen(false)}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={confirmRename} disabled={!renameValue.trim()}>Rename</Button>
          </div>
        </div>
      </Modal>

      <Modal open={renameRemoteOpen} onClose={() => setRenameRemoteOpen(false)} onConfirm={confirmRenameRemote} title="Rename Remote Branch" description={`Rename "${renameRemoteTarget}" on ${renameRemoteBase} to:`}>
        <div className="flex flex-col gap-3">
          <Input variant="text" value={renameRemoteValue} onChange={setRenameRemoteValue} placeholder="New remote branch name" />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setRenameRemoteOpen(false)}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={confirmRenameRemote} disabled={!renameRemoteValue.trim()}>Rename</Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!confirmDialog}
        title={confirmDialog?.title || ""}
        description={confirmDialog?.description}
        confirmLabel={confirmDialog?.confirmLabel}
        variant={confirmDialog?.variant}
        onConfirm={() => { confirmDialog?.onConfirm(); setConfirmDialog(null); }}
        onCancel={() => setConfirmDialog(null)}
      />
      <BranchCheckoutDialog
        open={checkoutDialogOpen}
        branches={allBranches}
        currentBranch={currentBranch}
        onCheckout={(b) => { setCheckoutDialogOpen(false); handleCheckout(b); }}
        onCancel={() => setCheckoutDialogOpen(false)}
      />
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────

function SectionHeader({ label, count, loading, action, children }: {
  label: string;
  count?: number;
  loading?: boolean;
  action?: { label: string; onClick: () => void } | React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider select-none shrink-0 border-b border-outline-variant"
      style={{ color: "var(--color-on-surface-variant)", background: "var(--color-surface-container-high)" }}
    >
      <span>{label}</span>
      {loading ? (
        <span className="text-[9px]" style={{ color: "var(--color-on-surface-variant)" }}>…</span>
      ) : count !== undefined ? (
        <span className="text-[9px] px-1 rounded" style={{ background: "var(--color-surface-container-highest)", color: "var(--color-on-surface-variant)" }}>
          {count}
        </span>
      ) : null}
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

// Inline, theme-matched search input shown when a section's search icon is
// toggled. Filters the file list (debounced upstream) by file path.
function SectionSearchBar({ value, onChange, onClose }: {
  value: string;
  onChange: (v: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5 w-full min-w-0 rounded-md h-5">
      <Search size={12} className="shrink-0 text-on-surface-variant" />
      <input
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
        placeholder="Filter files…"
        className="flex-1 min-w-0 bg-transparent outline-none text-sm text-on-surface placeholder:text-on-surface-variant/50 cursor-text select-text"
      />
      {value && (
        <IconButton icon={<X size={12} />} tooltip="Clear" onClick={() => onChange("")} size="sm" className="w-4 h-4 [&_svg]:w-[12px] [&_svg]:h-[12px]" variant="ghost" />
      )}
    </div>
  );
}

function BranchRow({ branch, checked, isRemote, onToggle, onContextMenu }: {
  branch: GitBranchInfo;
  checked: boolean;
  isRemote: boolean;
  onToggle: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  const isCurrent = branch.current;
  const selected = isCurrent || checked;
  return (
    <div
      className="group flex items-center gap-2 w-full text-xs px-2.5 py-1.5 rounded-md cursor-pointer transition-colors select-none hover:bg-white/[0.05] text-on-surface-variant"
      onClick={onToggle}
      onContextMenu={onContextMenu}
    >
      <button
        type="button"
        tabIndex={-1}
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        className="shrink-0 flex items-center justify-center w-3.5"
      >
        {selected ? <span className="w-2.5 h-2.5 rounded-full bg-current" /> : <Circle size={13} />}
      </button>
      <GitBranch size={12} className="shrink-0" />
      <span className="truncate flex-1 font-medium">{isRemote ? branch.name.replace(/^remotes\//, "") : branch.name}</span>
      {isCurrent && (
        <span className="text-[9px] tracking-wide px-1.5 py-0.5 rounded-full bg-primary/20 text-primary font-semibold">current</span>
      )}
      {!isCurrent && (branch.ahead > 0 || branch.behind > 0) && (
        <div className="flex items-center gap-1 shrink-0">
          {branch.ahead > 0 && (
            <span className="text-[10px] leading-none px-1 py-0.5 rounded bg-[rgba(80,227,194,0.14)] text-[#50E3C2] font-medium">↑{branch.ahead}</span>
          )}
          {branch.behind > 0 && (
            <span className="text-[10px] leading-none px-1 py-0.5 rounded bg-error-container text-error font-medium">↓{branch.behind}</span>
          )}
        </div>
      )}
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
  const conflicted = isConflicted(entry.x, entry.y);
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
      {conflicted && (
        <span className="shrink-0" title="Merge conflict"><GitMerge size={12} style={{ color: "#EF5350" }} /></span>
      )}
      <span className="truncate flex-1 pr-12">{fileName}</span>
      {dirName && <span className="text-[10px] truncate max-w-[80px]" style={{ color: "rgba(232,234,240,0.25)" }}>{dirName}</span>}
      {showActions && (
        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 group-hover:bg-surface-container-high rounded" style={{ pointerEvents: "auto" }}>
          <IconButton icon={<FileSymlink />} tooltip="Open File" onClick={onOpenFile} size="sm" className="w-5 h-5 [&_svg]:w-[11px] [&_svg]:h-[11px] text-on-surface" />
          <IconButton icon={<X />} tooltip="Unstage" onClick={onUnstage} size="sm" className="w-5 h-5 [&_svg]:w-[11px] [&_svg]:h-[11px] text-on-surface" />
        </div>
      )}
    </div>
  );
}

function ChangesFileRow({ entry, onStage, onRestore, onDelete, onOpenFile, onSelect, onContextMenu }: {
  entry: GitStatusEntry;
  onStage: () => void;
  onRestore?: () => void;
  onDelete?: () => void;
  onOpenFile: () => void;
  onSelect: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  const [showActions, setShowActions] = useState(false);
  const icon = statusIcon(entry.x, entry.y);
  const color = statusColor(entry.x, entry.y);
  const conflicted = isConflicted(entry.x, entry.y);
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
      {conflicted && (
        <span className="shrink-0" title="Merge conflict"><GitMerge size={12} style={{ color: "#EF5350" }} /></span>
      )}
      <span className="truncate flex-1 pr-12">{fileName}</span>
      {dirName && <span className="text-[10px] truncate max-w-[80px]" style={{ color: "rgba(232,234,240,0.25)" }}>{dirName}</span>}
      {showActions && (
        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 group-hover:bg-surface-container-high rounded" style={{ pointerEvents: "auto" }}>
          <IconButton icon={<FileSymlink />} tooltip="Open File" onClick={onOpenFile} size="sm" className="w-5 h-5 [&_svg]:w-[11px] [&_svg]:h-[11px] text-on-surface" />
          {onRestore && <IconButton icon={<Undo2 />} tooltip="Discard Changes" onClick={onRestore} size="sm" className="w-5 h-5 [&_svg]:w-[11px] [&_svg]:h-[11px] text-on-surface" />}
          {onDelete && <IconButton icon={<Trash2 />} tooltip="Delete File" onClick={onDelete} size="sm" className="w-5 h-5 [&_svg]:w-[11px] [&_svg]:h-[11px] text-on-surface" />}
          <IconButton icon={<Plus />} tooltip="Stage" onClick={onStage} size="sm" className="w-5 h-5 [&_svg]:w-[11px] [&_svg]:h-[11px] text-on-surface" />
        </div>
      )}
    </div>
  );
}
