import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Folder, FileText, ChevronDown, ChevronRight, Search, RefreshCw,
  Copy, FolderOpen, Terminal, ExternalLink, ClipboardCopy, Pencil, Trash2, AlertTriangle,
  ClipboardList, Scissors,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { DragDropEvent } from "@tauri-apps/api/webview";
import {
  RightClickMenuItem,
  RightClickMenuPanel,
  RightClickMenuSeparator,
} from "./RightClickMenu";

// ─── Normalize path for comparison (case-insensitive on Windows, normalize separators) ──
function pathsEqual(a: string, b: string): boolean {
  if (a === b) return true;
  const normalize = (p: string) =>
    p.toLowerCase().replace(/[/\\]+/g, "\\").replace(/[\\/]$/, "");
  return normalize(a) === normalize(b);
}

interface SidePanelProps {
  collapsed: boolean;
  cwd?: string; // absolute cwd — passed from App so we react to cd changes
  activeFilePath?: string;
}

interface FileNode {
  name: string;
  path: string;
  is_dir: boolean;
  is_hidden: boolean;
  is_gitignored: boolean;
}

// ─── File Context Menu types ────────────────────────────────────────────────
interface FileMenuState {
  x: number;
  y: number;
  node: FileNode;
}

// ─── Rename state ────────────────────────────────────────────────────────────
interface RenameState {
  path: string;     // path of item being renamed
  currentName: string;
  value: string;    // current input value
}

// ─── Clipboard state for copy/cut operations ────────────────────────────────
interface ClipboardState {
  path: string;
  operation: "copy" | "cut";
}

// ─── Drag-over highlight target (internal tree drag) ─────────────────────────
interface DragTargetState {
  path: string;
}

// ─── Delete confirm state ────────────────────────────────────────────────────
interface DeleteConfirmState {
  node: FileNode;
}

// ─── Filter logic for unwanted system/temp files ─────────────────────────────
const isExcluded = (name: string): boolean => {
  return (
    name === ".git" ||
    name === ".DS_Store" ||
    name.endsWith(".swp") ||
    name.endsWith(".swo") ||
    name.startsWith("~")
  );
};

// ─── Sort: folders first, then files; dot-prefixed at top of each group ────
function sortNodes(nodes: FileNode[]): FileNode[] {
  return [...nodes].sort((a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
    const aDot = a.name.startsWith(".");
    const bDot = b.name.startsWith(".");
    if (aDot !== bDot) return aDot ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

// ─────────────────────── TreeNode ────────────────────────
function pathStartsWith(path: string, prefix: string): boolean {
  if (path === prefix) return true;
  const next = path.slice(prefix.length);
  return next.startsWith("/") || next.startsWith("\\");
}

function TreeNode({
  node,
  depth,
  selectedFile,
  activePath,
  onSelect,
  onActivate,
  onContextMenu,
  renamingPath,
  renameValue,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
  dragOverPath,
  draggedNodePath,
  onPointerDown,
  expandPath,
  collapsePath,
}: {
  node: FileNode;
  depth: number;
  selectedFile: string;
  activePath: string;
  onSelect: (path: string) => void;
  onActivate: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, node: FileNode) => void;
  renamingPath: string;
  renameValue: string;
  onRenameChange: (val: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
  dragOverPath: string | null;
  draggedNodePath: string | null;
  onPointerDown: (e: React.PointerEvent, node: FileNode) => void;
  expandPath: string | null;
  collapsePath: string | null;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [children, setChildren] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(false);
  const loadedRef = useRef(false);

  // Auto-expand parent directories when a file is activated.
  // Skip the exact node — toggling a folder is handled by handleToggle.
  useEffect(() => {
    if (!node.is_dir || !activePath || activePath === node.path) return;
    if (pathStartsWith(activePath, node.path)) {
      if (!loadedRef.current) {
        loadedRef.current = true;
        setLoading(true);
        invoke<FileNode[]>("read_dir", { path: node.path })
          .then(setChildren)
          .catch(console.error)
          .finally(() => setLoading(false));
      }
      setIsOpen(true);
    }
  }, [activePath, node.path, node.is_dir]);

  // Auto-expand folder when drag-hover timer fires (expandPath matches)
  useEffect(() => {
    if (!node.is_dir || !expandPath || expandPath !== node.path) return;
    if (!loadedRef.current) {
      loadedRef.current = true;
      setLoading(true);
      invoke<FileNode[]>("read_dir", { path: node.path })
        .then(setChildren)
        .catch(console.error)
        .finally(() => setLoading(false));
    }
    setIsOpen(true);
  }, [expandPath, node.path, node.is_dir]);

  // Collapse folder when drag moves away from an auto-expanded folder
  useEffect(() => {
    if (!node.is_dir || !collapsePath || collapsePath !== node.path) return;
    setIsOpen(false);
  }, [collapsePath, node.path, node.is_dir]);

  const handleToggle = async () => {
    if (node.is_dir) {
      onActivate(node.path);
      if (!isOpen && !loadedRef.current) {
        loadedRef.current = true;
        setLoading(true);
        try {
          const res = await invoke<FileNode[]>("read_dir", { path: node.path });
          setChildren(res);
        } catch (err) {
          console.error(err);
        } finally {
          setLoading(false);
        }
      }
      setIsOpen((prev) => !prev);
    }
  };

  const handleClick = () => {
    if (node.is_dir) {
      handleToggle();
    } else {
      onSelect(node.path);
      onActivate(node.path);
      window.dispatchEvent(
        new CustomEvent("sidebar-open-file", { detail: { path: node.path } })
      );
    }
  };

  const isSelected = selectedFile === node.path;
  const isActive = activePath === node.path;
  const indent = depth * 14 + 10; // px
  const isActiveFolder = node.is_dir && isOpen && isActive;

  // ── Visual state helpers ──────────────────────────────────────────────────
  const isGitignored = node.is_gitignored;
  // const isHidden = node.is_hidden;

  const textColorClass = isActive
    ? "text-primary"
    : isActiveFolder
      ? "text-primary"
      : isGitignored
        ? "text-on-surface-variant/70"
        : "text-on-surface-variant/80";

  const rowClass = `group flex items-center gap-1.5 cursor-pointer transition-colors ${isActive
    ? "bg-primary/8 border-l-2 border-primary shadow-[inset_0_0_0_1px_rgba(0,240,255,0.08)]"
    : isActiveFolder
      ? "bg-primary/8 border-l-2 border-primary shadow-[inset_0_0_0_1px_rgba(0,240,255,0.08)]"
      : "hover:bg-surface-variant/20 hover:border-outline-variant/30 border-l-2 border-transparent"
    }`;

  const folderIconClass = `shrink-0 ${isGitignored
    ? isOpen ? "text-primary/30" : "text-primary-container/30"
    : isOpen ? "text-primary/80" : "text-primary-container/80"
    }`;

  const fileIconClass = `shrink-0 ml-[15px] ${isSelected ? "text-primary" : isGitignored ? "text-outline/25" : "text-outline/50"
    }`;

  const isRenaming = renamingPath === node.path;
  const isDragOver = dragOverPath === node.path && node.is_dir;
  const isBeingDragged = draggedNodePath === node.path;

  return (
    <div className="select-none">
      <div
        onClick={isRenaming ? undefined : handleClick}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!isRenaming) onContextMenu(e, node);
        }}
        title={isRenaming ? undefined : node.name}
        data-path={node.path}
        data-is-dir={node.is_dir ? "true" : "false"}
        onPointerDown={(e) => { if (!node.is_dir) onPointerDown(e, node); }}
        className={`${rowClass} ${textColorClass} ${isDragOver ? "ring-2 ring-primary/60 bg-primary/10" : ""} ${isBeingDragged ? "opacity-40" : ""}`}
        style={{
          paddingLeft: isSelected && !node.is_dir ? `${indent - 2}px` : `${indent}px`,
          paddingRight: "8px",
          paddingTop: "5px",
          paddingBottom: "5px",
          minHeight: "26px",
          lineHeight: "1.4",
        }}
      >
        {node.is_dir ? (
          <>
            {isOpen ? (
              <ChevronDown size={11} className="text-outline/60 shrink-0 transition-colors group-hover:text-primary/80" />
            ) : (
              <ChevronRight size={11} className="text-outline/60 shrink-0 transition-colors group-hover:text-primary/80" />
            )}
            <Folder size={12} className={`${folderIconClass} transition-colors group-hover:text-primary ${isActiveFolder ? "text-primary" : ""}`} />
          </>
        ) : (
          <FileText size={12} className={`${fileIconClass} transition-colors group-hover:text-primary ${isActive ? "text-primary" : ""}`} />
        )}

        {isRenaming ? (
          /* ── Inline rename input ── */
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => onRenameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); onRenameCommit(); }
              if (e.key === "Escape") { e.preventDefault(); onRenameCancel(); }
            }}
            onBlur={onRenameCancel}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 min-w-0 text-sm bg-surface-container-high border border-primary/40 rounded px-1 outline-none text-on-surface focus:border-primary/70 transition-colors"
            style={{ lineHeight: "1.4", marginLeft: "2px" }}
          />
        ) : (
          <span
            className={`text-sm overflow-hidden text-ellipsis whitespace-nowrap min-w-0 flex-1 transition-colors group-hover:text-on-surface ${isGitignored ? "italic opacity-60" : ""}`}
            style={{ lineHeight: "1.4" }}
          >
            {node.name}
          </span>
        )}
      </div>

      {node.is_dir && isOpen && (
        <div>
          {loading ? (
            <div
              className="text-outline/40 text-[10px] italic py-1"
              style={{ paddingLeft: `${indent + 24}px` }}
            >
              Loading…
            </div>
          ) : children.length === 0 ? (
            <div
              className="text-outline/30 text-[10px] italic py-1"
              style={{ paddingLeft: `${indent + 24}px` }}
            >
              Empty
            </div>
          ) : (
            sortNodes(children.filter((child) => !isExcluded(child.name)))
              .map((child) => (
                <TreeNode
                  key={child.path}
                  node={child}
                  depth={depth + 1}
                  selectedFile={selectedFile}
                  activePath={activePath}
                  onSelect={onSelect}
                  onActivate={onActivate}
                  onContextMenu={onContextMenu}
                  renamingPath={renamingPath}
                  renameValue={renameValue}
                  onRenameChange={onRenameChange}
                  onRenameCommit={onRenameCommit}
                  onRenameCancel={onRenameCancel}
                  dragOverPath={dragOverPath}
                  draggedNodePath={draggedNodePath}
                  onPointerDown={onPointerDown}
                  expandPath={expandPath}
                  collapsePath={collapsePath}
                />
              ))
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────── SidePanel ────────────────────────
const MIN_WIDTH = 160;
const MAX_WIDTH = 520;
const DEFAULT_WIDTH = 220;

export function SidePanel({ collapsed, cwd, activeFilePath }: SidePanelProps) {
  const [selectedFile, setSelectedFile] = useState<string>("");
  const [activePath, setActivePath] = useState<string>("");

  useEffect(() => {
    if (activeFilePath) {
      setSelectedFile(activeFilePath);
      setActivePath(activeFilePath);
    } else {
      setSelectedFile("");
      setActivePath("");
    }
  }, [activeFilePath]);
  const [rootNodes, setRootNodes] = useState<FileNode[]>([]);
  const [workspaceName, setWorkspaceName] = useState("Workspace");
  const [resolvedCwd, setResolvedCwd] = useState<string>("");
  const [filterQuery, setFilterQuery] = useState("");
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── File context menu state ───────────────────────────────
  const [fileMenu, setFileMenu] = useState<FileMenuState | null>(null);

  // ── Rename state ──────────────────────────────────────────
  const [renameState, setRenameState] = useState<RenameState | null>(null);

  // ── Delete confirm state ──────────────────────────────────
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmState | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(DEFAULT_WIDTH);
  const panelRef = useRef<HTMLElement>(null);
  const loadSeqRef = useRef(0);
  const hasDataRef = useRef(false);

  // In-app clipboard for copy/cut/paste
  const clipboardRef = useRef<ClipboardState | null>(null);
  const [clipboardHasContent, setClipboardHasContent] = useState(false);

  // Drag & drop state
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const [isExternalDragging, setIsExternalDragging] = useState(false);
  const dragSourcePathRef = useRef<string | null>(null);

  // ── Close file menu on outside click ─────────────────────
  useEffect(() => {
    if (!fileMenu) return;
    const handler = () => setFileMenu(null);
    window.addEventListener("click", handler);
    window.addEventListener("contextmenu", handler);
    return () => {
      window.removeEventListener("click", handler);
      window.removeEventListener("contextmenu", handler);
    };
  }, [fileMenu]);

  useEffect(() => {
    const handler = () => setFileMenu(null);
    window.addEventListener("aurora-right-click-menu-close", handler);
    return () => window.removeEventListener("aurora-right-click-menu-close", handler);
  }, []);

  // ── Load file tree for a given absolute path ──────────────
  const loadTree = useCallback(async (absolutePath: string) => {
    const seq = ++loadSeqRef.current;
    if (!hasDataRef.current) {
      setIsLoading(true);
    }
    setError(null);
    setActivePath("");
    setSelectedFile("");
    try {
      const parts = absolutePath.split(/[/\\]/);
      setWorkspaceName(parts[parts.length - 1] || absolutePath);
      const res = await invoke<FileNode[]>("read_dir", { path: absolutePath });
      if (seq !== loadSeqRef.current) return;
      serializedRootRef.current = JSON.stringify(res);
      hasDataRef.current = true;
      setRootNodes(res);
    } catch (err) {
      if (seq !== loadSeqRef.current) return;
      console.error("Failed to load workspace tree:", err);
      setError(String(err) || "Failed to load workspace files.");
    } finally {
      if (seq === loadSeqRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  // ── Initial load ──────────────────────────────────────────
  useEffect(() => {
    async function init() {
      try {
        const dir = await invoke<string>("get_cwd");
        setResolvedCwd(dir);
        await loadTree(dir);
      } catch (err) {
        console.error("Failed to init explorer:", err);
      }
    }
    init();
  }, [loadTree]);

  // ── React to cwd prop changes (cd command / tab switch) ──
  useEffect(() => {
    if (!cwd || pathsEqual(cwd, resolvedCwd)) return;
    setResolvedCwd(cwd);
    loadTree(cwd);
  }, [cwd, resolvedCwd, loadTree]);

  // ── Listen for cwd-change from terminal CWD sentinel ─────
  const lastLoadedPathRef = useRef("");
  useEffect(() => {
    const handler = (e: Event) => {
      const { path } = (e as CustomEvent<{ path: string }>).detail;
      if (!path || pathsEqual(path, resolvedCwd) || pathsEqual(path, lastLoadedPathRef.current)) return;
      lastLoadedPathRef.current = path;
      setResolvedCwd(path);
      loadTree(path);
    };
    window.addEventListener("cwd-change", handler);
    return () => window.removeEventListener("cwd-change", handler);
  }, [resolvedCwd, loadTree]);

  // ── Start file watcher when CWD changes ──────────────────
  const serializedRootRef = useRef("");
  useEffect(() => {
    if (!resolvedCwd) return;
    invoke("watch_directory", { path: resolvedCwd }).catch(() => { });
  }, [resolvedCwd]);

  // ── Listen for fs-tree-changed events from file watcher ──
  useEffect(() => {
    if (collapsed || !resolvedCwd) return;
    let unlisten: (() => void) | null = null;
    listen<void>("fs-tree-changed", async () => {
      try {
        const res = await invoke<FileNode[]>("read_dir", { path: resolvedCwd });
        const serialized = JSON.stringify(res);
        if (serialized !== serializedRootRef.current) {
          serializedRootRef.current = serialized;
          setRootNodes(res);
        }
      } catch {
        // silently ignore
      }
    }).then((fn) => { unlisten = fn; });
    return () => { if (unlisten) unlisten(); };
  }, [collapsed, resolvedCwd]);

  // ── Drag-to-resize ────────────────────────────────────────
  const onDragHandleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    dragStartX.current = e.clientX;
    dragStartWidth.current = width;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = e.clientX - dragStartX.current;
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, dragStartWidth.current + delta));
      setWidth(newWidth);
    };
    const onMouseUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  // ── File context menu actions ─────────────────────────────
  const handleFileContextMenu = useCallback((e: React.MouseEvent, node: FileNode) => {
    window.dispatchEvent(new CustomEvent("aurora-right-click-menu-close"));
    setFileMenu({ x: e.clientX, y: e.clientY, node });
  }, []);

  const handleActivateNode = useCallback((path: string) => {
    setActivePath(path);
  }, []);

  const copyToClipboard = (text: string) =>
    navigator.clipboard.writeText(text).catch(console.error);

  const revealInExplorer = (path: string) =>
    invoke("reveal_in_explorer", { path }).catch(console.error);

  const getTargetPath = (node: FileNode) => (
    node.is_dir ? node.path : node.path.replace(/[/\\][^/\\]+$/, "")
  );

  const openInTerminal = (node: FileNode) => {
    const targetPath = getTargetPath(node);
    window.dispatchEvent(
      new CustomEvent("sidebar-open-in-terminal", { detail: { path: targetPath } })
    );
  };

  const handleOpenFolderInAurora = () => {
    if (!fileMenu?.node.is_dir) return;
    openInTerminal(fileMenu.node);
    setFileMenu(null);
  };

  const handleOpenFolderInNewTab = () => {
    if (!fileMenu) return;
    const targetPath = getTargetPath(fileMenu.node);
    window.dispatchEvent(
      new CustomEvent("sidebar-open-in-new-tab", { detail: { path: targetPath } })
    );
    setFileMenu(null);
  };

  // ── Rename actions ────────────────────────────────────────
  const startRename = (node: FileNode) => {
    setFileMenu(null);
    setRenameState({ path: node.path, currentName: node.name, value: node.name });
  };

  const commitRename = async () => {
    if (!renameState) return;
    const newName = renameState.value.trim();
    if (!newName || newName === renameState.currentName) {
      setRenameState(null);
      return;
    }
    try {
      await invoke("rename_path", { oldPath: renameState.path, newName: newName });
      setRenameState(null);
      // Refresh the tree
      if (resolvedCwd) loadTree(resolvedCwd);
    } catch (err) {
      console.error("Rename failed:", err);
      setRenameState(null);
    }
  };

  const cancelRename = () => setRenameState(null);

  // ── Delete actions ────────────────────────────────────────
  const startDelete = (node: FileNode) => {
    setFileMenu(null);
    setDeleteError(null);
    setDeleteConfirm({ node });
  };

  const confirmDelete = async () => {
    if (!deleteConfirm) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await invoke("delete_path", { path: deleteConfirm.node.path });
      setDeleteConfirm(null);
      setIsDeleting(false);
      if (resolvedCwd) loadTree(resolvedCwd);
    } catch (err) {
      setDeleteError(String(err));
      setIsDeleting(false);
    }
  };

  // ── Copy / Cut / Paste actions ────────────────────────────
  const handleCopy = useCallback((node: FileNode) => {
    clipboardRef.current = { path: node.path, operation: "copy" };
    setClipboardHasContent(true);
    setFileMenu(null);
  }, []);

  const handleCut = useCallback((node: FileNode) => {
    clipboardRef.current = { path: node.path, operation: "cut" };
    setClipboardHasContent(true);
    setFileMenu(null);
  }, []);

  const handlePaste = useCallback(async () => {
    if (!clipboardRef.current || !resolvedCwd) return;
    setFileMenu(null);
    const { path: srcPath, operation } = clipboardRef.current;
    try {
      if (operation === "cut") {
        // Move to resolvedCwd root
        const name = srcPath.split(/[/\\]/).pop() || "";
        const dest = `${resolvedCwd}\\${name}`;
        await invoke("rename_path", { oldPath: srcPath, newName: name });
      } else {
        // Copy to resolvedCwd root
        await invoke("copy_path", { source: srcPath, targetDir: resolvedCwd });
      }
      clipboardRef.current = null;
      setClipboardHasContent(false);
      if (resolvedCwd) loadTree(resolvedCwd);
    } catch (err) {
      console.error("Paste failed:", err);
      clipboardRef.current = null;
      setClipboardHasContent(false);
    }
  }, [resolvedCwd, loadTree]);

  // ── Pointer-based internal DnD (works on all platforms, unlike HTML5 draggable) ──
  const [draggedNodePath, setDraggedNodePath] = useState<string | null>(null);
  const isPointerDragging = useRef(false);
  const dragPointerStart = useRef<{ x: number; y: number } | null>(null);
  const dragActiveRef = useRef(false);

  // Hover-to-expand during drag
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastHoverPathRef = useRef<string | null>(null);
  const hoverExpandedPathRef = useRef<string | null>(null);
  const [expandPath, setExpandPath] = useState<string | null>(null);
  const [collapsePath, setCollapsePath] = useState<string | null>(null);

  const handlePointerDown = useCallback((e: React.PointerEvent, node: FileNode) => {
    if (node.is_dir) return;
    e.preventDefault();
    e.stopPropagation();
    dragSourcePathRef.current = node.path;
    isPointerDragging.current = true;
    dragPointerStart.current = { x: e.clientX, y: e.clientY };
    dragActiveRef.current = false;
    setDraggedNodePath(node.path);
  }, []);

  // Global pointer tracking for internal drag
  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      if (!isPointerDragging.current || !dragPointerStart.current) return;
      if (!dragActiveRef.current) {
        const dx = e.clientX - dragPointerStart.current.x;
        const dy = e.clientY - dragPointerStart.current.y;
        if (dx * dx + dy * dy < 25) return; // threshold ~5px
        dragActiveRef.current = true;
      }
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const treeRow = el?.closest<HTMLElement>("[data-path]") ?? null;
      if (treeRow && treeRow.dataset.isDir === "true") {
        const newPath = treeRow.dataset.path ?? null;
        setDragOverPath(newPath);
        if (newPath !== lastHoverPathRef.current) {
          // Collapse previous auto-expanded folder when hovering a different folder
          if (hoverExpandedPathRef.current && hoverExpandedPathRef.current !== newPath) {
            setCollapsePath(hoverExpandedPathRef.current);
            hoverExpandedPathRef.current = null;
          }
          lastHoverPathRef.current = newPath;
          if (hoverTimerRef.current) {
            clearTimeout(hoverTimerRef.current);
            hoverTimerRef.current = null;
          }
          if (newPath) {
            hoverTimerRef.current = setTimeout(() => {
              setExpandPath(newPath);
              hoverExpandedPathRef.current = newPath;
              hoverTimerRef.current = null;
            }, 500);
          }
        }
      } else {
        // Not hovering a folder — don't collapse auto-expanded folders here,
        // only collapse on drag end to avoid flicker when moving over child files
        lastHoverPathRef.current = null;
        if (hoverTimerRef.current) {
          clearTimeout(hoverTimerRef.current);
          hoverTimerRef.current = null;
        }
        setDragOverPath(null);
      }
    };

    const handlePointerUp = async (e: PointerEvent) => {
      if (!isPointerDragging.current) return;
      const srcPath = dragSourcePathRef.current;
      if (dragActiveRef.current && srcPath) {
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const treeRow = el?.closest<HTMLElement>("[data-path]") ?? null;
        const targetPath = treeRow?.dataset.path;
        const isDir = treeRow?.dataset.isDir === "true";
        if (targetPath && isDir) {
          try {
            await invoke("move_path", { source: srcPath, targetDir: targetPath });
            if (resolvedCwd) loadTree(resolvedCwd);
          } catch (err) {
            console.error("Move failed:", err);
          }
        }
      }
      // Collapse the auto-expanded folder on drag end
      if (hoverExpandedPathRef.current) {
        setCollapsePath(hoverExpandedPathRef.current);
        hoverExpandedPathRef.current = null;
      }
      isPointerDragging.current = false;
      dragPointerStart.current = null;
      dragActiveRef.current = false;
      dragSourcePathRef.current = null;
      lastHoverPathRef.current = null;
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }
      setDragOverPath(null);
      setDraggedNodePath(null);
      setExpandPath(null);
    };

    const handlePointerCancel = () => {
      if (hoverExpandedPathRef.current) {
        setCollapsePath(hoverExpandedPathRef.current);
        hoverExpandedPathRef.current = null;
      }
      isPointerDragging.current = false;
      dragPointerStart.current = null;
      dragActiveRef.current = false;
      dragSourcePathRef.current = null;
      lastHoverPathRef.current = null;
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }
      setDragOverPath(null);
      setDraggedNodePath(null);
      setExpandPath(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
    };
  }, [resolvedCwd, loadTree]);

  // ── External DnD: handle files dragged from OS file manager ──
  useEffect(() => {
    const appWindow = getCurrentWebviewWindow();
    let unlisten: (() => void) | null = null;

    appWindow.onDragDropEvent((event) => {
      const payload = event.payload;
      if (payload.type === "over") {
        setIsExternalDragging(true);
      } else if (payload.type === "leave") {
        setIsExternalDragging(false);
        setDragOverPath(null);
      } else if (payload.type === "drop") {
        setIsExternalDragging(false);
        setDragOverPath(null);
        const paths = payload.paths;
        // Copy each dropped file into the resolvedCwd
        if (resolvedCwd) {
          for (const p of paths) {
            invoke("copy_path", { source: p, targetDir: resolvedCwd }).catch((err) => {
              console.error("Failed to copy dropped file:", err);
            });
          }
          loadTree(resolvedCwd);
        }
      }
    }).then((fn) => { unlisten = fn; });

    return () => { if (unlisten) unlisten(); };
  }, [resolvedCwd, loadTree]);

  // ── Filter + sort helper ─────────────────────────────────
  const filteredNodes = sortNodes(
    rootNodes
      .filter((n) => !isExcluded(n.name))
      .filter((n) =>
        !filterQuery.trim() || n.name.toLowerCase().includes(filterQuery.toLowerCase())
      )
  );

  if (collapsed) return null;

  return (
    <aside
      ref={panelRef}
      id="main-sidebar"
      className="relative bg-background border-r border-outline-variant/10 flex flex-col shadow-lg z-20 overflow-hidden"
      style={{ width, minWidth: MIN_WIDTH, maxWidth: MAX_WIDTH, flexShrink: 0 }}
      onContextMenu={(e) => e.preventDefault()} // suppress browser default in sidebar
    >
      {/* Header with search and dynamic loading indicator */}
      <div className={`flex items-center p-2.5 border-b border-outline-variant/5 transition-all duration-300 ${isLoading ? "gap-2" : "gap-0"}`}>
        <div className="relative flex-1 min-w-0 group">
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-outline/40 group-focus-within:text-primary transition-colors shrink-0" />
          <input
            type="text"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder="Filter files…"
            className="w-full bg-surface-container-high/30 border border-outline-variant/10 rounded-md pl-7 pr-2 py-1 text-sm placeholder:text-outline/25 focus:ring-0 focus:border-outline-variant/20 outline-none transition-all"
          />
        </div>
        <div
          className={`flex items-center justify-center shrink-0 transition-all duration-300 ease-in-out ${isLoading ? "w-4 opacity-100 pl-1" : "w-0 opacity-0 overflow-hidden"
            }`}
        >
          <RefreshCw size={11} className="text-primary animate-spin" />
        </div>
      </div>

      {/* Workspace label */}
      <div
        className="text-sm text-outline/50 px-3 pt-2 pb-1 tracking-widest font-bold overflow-hidden text-ellipsis whitespace-nowrap"
        title={workspaceName}
      >
        {workspaceName}
      </div>

      {/* File tree — scrollable */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden pb-4 sidepanel-scroll">
        {isLoading ? (
          <div className="text-outline/35 text-xs italic px-4 py-3 flex items-center gap-2 select-none">
            Loading workspace...
          </div>
        ) : error ? (
          <div className="text-red-400 text-xs px-4 py-3 whitespace-pre-wrap break-words leading-relaxed select-text">
            {error}
          </div>
        ) : filteredNodes.length === 0 ? (
          <div className="text-outline/30 text-sm italic px-4 py-3">No files</div>
        ) : (
          filteredNodes.map((node) => (
            <TreeNode
              key={node.path}
              node={node}
              depth={0}
              selectedFile={selectedFile}
              activePath={activePath}
              onSelect={setSelectedFile}
              onActivate={handleActivateNode}
              onContextMenu={handleFileContextMenu}
              renamingPath={renameState?.path ?? ""}
              renameValue={renameState?.value ?? ""}
              onRenameChange={(val) => setRenameState(prev => prev ? { ...prev, value: val } : null)}
              onRenameCommit={commitRename}
              onRenameCancel={cancelRename}
              dragOverPath={dragOverPath}
              draggedNodePath={draggedNodePath}
              onPointerDown={handlePointerDown}
              expandPath={expandPath}
              collapsePath={collapsePath}
            />
          ))
        )}
      </div>

      {/* ── Drag handle ── */}
      <div
        onMouseDown={onDragHandleMouseDown}
        className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize z-30 group"
        title="Drag to resize"
      >
        <div className="w-px h-full ml-auto group-hover:bg-primary/40 transition-colors" />
      </div>

      {/* ── File Context Menu — rendered as fixed so it escapes overflow:hidden ── */}
      {fileMenu && (
        <RightClickMenuPanel anchorX={fileMenu.x} anchorY={fileMenu.y} open={true}>
          {/* File header — shows what item was right-clicked */}
          <div className="px-3 pt-1 pb-2 flex items-center gap-2 border-b border-outline-variant/10 mb-1">
            {fileMenu.node.is_dir && <Folder size={12} className="text-primary/70 shrink-0" />}
            <span className="text-sm text-on-surface-variant/60 overflow-hidden text-ellipsis whitespace-nowrap">{fileMenu.node.name}</span>
          </div>

          {/* Copy Name */}
          <RightClickMenuItem icon={<ClipboardCopy size={13} />} onClick={() => { copyToClipboard(fileMenu.node.name); setFileMenu(null); }}>
            Copy Name
          </RightClickMenuItem>

          {/* Copy Path */}
          <RightClickMenuItem icon={<Copy size={13} />} onClick={() => { copyToClipboard(fileMenu.node.path); setFileMenu(null); }}>
            Copy Path
          </RightClickMenuItem>

          {/* Copy (to clipboard buffer) */}
          <RightClickMenuItem icon={<ClipboardList size={13} />} onClick={() => handleCopy(fileMenu.node)}>
            Copy
          </RightClickMenuItem>

          {/* Cut (to clipboard buffer) */}
          <RightClickMenuItem icon={<Scissors size={13} />} onClick={() => handleCut(fileMenu.node)}>
            Cut
          </RightClickMenuItem>

          {/* Paste (only when clipboard has content) */}
          {clipboardHasContent && (
            <RightClickMenuItem icon={<ClipboardList size={13} />} onClick={handlePaste}>
              Paste
            </RightClickMenuItem>
          )}

          <RightClickMenuSeparator />

          {/* Reveal in Explorer */}
          <RightClickMenuItem icon={<FolderOpen size={13} />} onClick={() => { revealInExplorer(fileMenu.node.path); setFileMenu(null); }}>
            Reveal in Explorer
          </RightClickMenuItem>

          <RightClickMenuSeparator />

          {/* For directories: Terminal options */}
          {fileMenu.node.is_dir && (
            <>
              {/* Open current tab */}
              <RightClickMenuItem icon={<Terminal size={13} />} onClick={handleOpenFolderInAurora}>
                Open Here
              </RightClickMenuItem>

              {/* Open target in a new tab */}
              <RightClickMenuItem icon={<Terminal size={13} />} onClick={handleOpenFolderInNewTab}>
                Open in New Tab
              </RightClickMenuItem>
            </>
          )}

          {/* For files: Open in editor */}
          {!fileMenu.node.is_dir && (
            <>
              <RightClickMenuItem icon={<FileText size={13} />} onClick={() => {
                window.dispatchEvent(
                  new CustomEvent("sidebar-open-file", { detail: { path: fileMenu.node.path } })
                );
                setFileMenu(null);
              }}>
                Open
              </RightClickMenuItem>
            </>
          )}
          <RightClickMenuItem icon={<ExternalLink size={13} />} onClick={() => {
            const rel = fileMenu.node.path
              .replace(resolvedCwd, "")
              .replace(/^[/\\]/, "");
            copyToClipboard(rel);
            setFileMenu(null);
          }}>
            Copy Relative Path
          </RightClickMenuItem>

          <RightClickMenuSeparator />

          {/* Rename */}
          <RightClickMenuItem icon={<Pencil size={13} />} onClick={() => startRename(fileMenu.node)}>
            Rename
          </RightClickMenuItem>

          {/* Delete */}
          <RightClickMenuItem
            icon={<Trash2 size={13} />}
            onClick={() => startDelete(fileMenu.node)}
            danger
          >
            Delete
          </RightClickMenuItem>
        </RightClickMenuPanel>
      )}

      {/* ── Delete confirmation modal ── */}
      {deleteConfirm && (
        <div
          className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => { if (!isDeleting) setDeleteConfirm(null); }}
        >
          <div
            className="bg-surface-container-high border border-outline-variant/20 rounded-xl shadow-2xl w-[380px] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 pt-5 pb-3">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle size={16} className="text-red-400 shrink-0" />
                <h3 className="text-sm font-semibold text-on-surface">
                  Delete {deleteConfirm.node.is_dir ? "folder" : "file"}?
                </h3>
              </div>
              <p className="text-xs text-on-surface-variant/80 leading-relaxed">
                Are you sure you want to permanently delete{" "}
                <span className="text-primary font-medium">{deleteConfirm.node.name}</span>?
                {deleteConfirm.node.is_dir && (
                  <span className="text-red-400/80"> This will delete all contents inside.</span>
                )}
              </p>
              {deleteError && (
                <p className="text-[11px] text-red-400 mt-2">{deleteError}</p>
              )}
            </div>
            <div className="flex justify-end gap-2 px-5 pb-4 pt-1">
              <button
                className="px-3 py-1.5 text-[11px] rounded-lg border border-outline-variant/20 text-on-surface-variant hover:bg-surface-variant/20 transition-colors cursor-pointer"
                onClick={() => setDeleteConfirm(null)}
                disabled={isDeleting}
              >
                Cancel
              </button>
              <button
                className="px-3 py-1.5 text-[11px] rounded-lg bg-red-500/80 text-white hover:bg-red-500 transition-colors cursor-pointer font-semibold disabled:opacity-50"
                onClick={confirmDelete}
                disabled={isDeleting}
              >
                {isDeleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
