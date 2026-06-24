import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Folder, FileText, FileCode, FileImage, FileJson, FileSpreadsheet, FileAudio, FileVideo, FileArchive,
  ChevronDown, ChevronRight, RefreshCw, MoreHorizontal,
  Copy, FolderOpen, Terminal, ExternalLink, ClipboardCopy, Pencil, Trash2, AlertTriangle,
  ClipboardList, Scissors,
  CopyMinus,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { DragDropEvent } from "@tauri-apps/api/webview";
import { useSessionStore } from "../../stores/useSessionStore";
import { useAppShellStore } from "../../stores/useAppShellStore";
import { MenuView, MenuViewItem, MenuViewSeparator } from "./MenuView";
import { closeAllPopups, onClosePopups } from "../../lib/popups";
import type { SideSection } from "../../stores/useAppShellStore";
import { FileOutline } from "./FileOutline";
import { FileTimeline } from "./FileTimeline";
import { GitTree } from "./GitTree";

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
  creatingParent,
  creatingType,
  creatingName,
  onCreatingNameChange,
  onCreatingCommit,
  onCreatingCancel,
  collapseKey,
  refreshKey,
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
  creatingParent: string | null;
  creatingType: "file" | "folder" | null;
  creatingName: string;
  onCreatingNameChange: (val: string) => void;
  onCreatingCommit: () => void;
  onCreatingCancel: () => void;
  collapseKey?: number;
  refreshKey?: number;
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

  // Auto-expand folder when creating inside it
  useEffect(() => {
    if (!node.is_dir || !creatingParent || creatingParent !== node.path) return;
    if (!loadedRef.current) {
      loadedRef.current = true;
      setLoading(true);
      invoke<FileNode[]>("read_dir", { path: node.path })
        .then(setChildren)
        .catch(console.error)
        .finally(() => setLoading(false));
    }
    setIsOpen(true);
  }, [creatingParent, node.path, node.is_dir]);

  // Collapse self when collapseAll triggered
  useEffect(() => {
    if (node.is_dir) {
      setIsOpen(false);
      loadedRef.current = false;
      setChildren([]);
    }
  }, [collapseKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clear loaded children and force reload when refreshKey changes
  useEffect(() => {
    if (node.is_dir) {
      loadedRef.current = false;
      setChildren([]);
    }
  }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleToggle = async () => {
    if (node.is_dir) {
      onActivate(node.path);
      const nextOpen = !isOpen;
      setIsOpen(nextOpen);
      if (nextOpen && !loadedRef.current) {
        loadedRef.current = true;
        setLoading(true);
        try {
          const res = await invoke<FileNode[]>("read_dir", { path: node.path });
          setChildren(res);
        } catch (err) {
          console.error(err);
          loadedRef.current = false;
        } finally {
          setLoading(false);
        }
      }
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
  const isRenaming = renamingPath === node.path;
  const isDragOver = dragOverPath === node.path && node.is_dir;
  const isBeingDragged = draggedNodePath === node.path;

  const isCreating = creatingParent === node.path && node.is_dir;

  const rowBg = isActive
    ? "rgba(79,140,255,0.10)"
    : isDragOver
      ? "rgba(79,140,255,0.08)"
      : undefined;

  const rowBorderLeft = isActive ? "2px solid rgba(79,140,255,0.55)" : "2px solid transparent";

  const folderColor = "#61AFEF";
  const chevronColor = "rgba(232,234,240,0.35)";

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
        className={`flex items-center gap-1.5 cursor-pointer transition-colors ${isBeingDragged ? "opacity-40" : ""}`}
        style={{
          paddingLeft: `${indent}px`,
          paddingRight: "8px",
          paddingTop: "4px",
          paddingBottom: "4px",
          minHeight: "24px",
          background: rowBg,
          borderLeft: rowBorderLeft,
        }}
      >
        {node.is_dir ? (
          <>
            {isOpen ? (
              <ChevronDown size={11} className="shrink-0" style={{ color: chevronColor }} />
            ) : (
              <ChevronRight size={11} className="shrink-0" style={{ color: chevronColor }} />
            )}
            {isOpen
              ? <FolderOpen size={12} className="shrink-0" style={{ color: folderColor }} />
              : <Folder size={12} className="shrink-0" style={{ color: folderColor }} />
            }
          </>
        ) : (
          <FileIcon fileName={node.name} isActive={isActive} isGitignored={isGitignored} />
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
              className="text-on-surface-variant/40 text-[10px] italic py-1"
              style={{ paddingLeft: `${indent + 24}px` }}
            >
              Loading…
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
                  creatingParent={creatingParent}
                  creatingType={creatingType}
                  creatingName={creatingName}
                  onCreatingNameChange={onCreatingNameChange}
                  onCreatingCommit={onCreatingCommit}
                  onCreatingCancel={onCreatingCancel}
                  collapseKey={collapseKey}
                  refreshKey={refreshKey}
                />
              ))
          )}
          {/* ── Inline create input at end of children ── */}
          {isCreating && (
            <div
              className="flex items-center gap-1.5"
              style={{ paddingLeft: `${indent + 24}px`, paddingTop: "4px", paddingBottom: "4px", minHeight: "24px" }}
            >
              <input
                autoFocus
                value={creatingName}
                onChange={(e) => onCreatingNameChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); onCreatingCommit(); }
                  if (e.key === "Escape") { e.preventDefault(); onCreatingCancel(); }
                }}
                onBlur={onCreatingCancel}
                onClick={(e) => e.stopPropagation()}
                placeholder={creatingType === "folder" ? "folder name" : "file name"}
                className="flex-1 min-w-0 text-sm bg-surface-container-high border border-primary/40 rounded px-1 outline-none text-on-surface placeholder:text-outline/30 focus:border-primary/70 transition-colors"
                style={{ lineHeight: "1.4", marginLeft: "2px" }}
              />
            </div>
          )}
          {!loading && children.length === 0 && !isCreating && (
            <div
              className="text-on-surface-variant/60 text-sm italic py-1"
              style={{ paddingLeft: `${indent + 24}px` }}
            >
              Empty
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── SectionToggle ────────────────────────────────────────────────── */
const SECTION_LABELS: Record<SideSection, string> = {
  folders: "Folders",
  outline: "Outline",
  timeline: "Timeline",
  git: "Git",
};

function SectionToggle() {
  const [open, setOpen] = useState(false);
  const sectionVisibility = useAppShellStore((s) => s.sectionVisibility);
  const toggleSection = useAppShellStore((s) => s.toggleSection);
  const activeTab = useSessionStore((s) => s.tabs.find((t) => t.id === s.activeTabId));
  const isTerminalView = activeTab?.type === "terminal";

  const sections: SideSection[] = ["folders", "outline", "timeline", "git"];
  const disabledInTerminal: SideSection[] = ["outline", "timeline"];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((p) => !p)}
        className="w-5 h-5 flex items-center justify-center rounded transition-colors cursor-pointer"
        style={{ color: "rgba(232,234,240,0.35)" }}
        onMouseEnter={(e) => { e.currentTarget.style.color = "#E8EAF0"; e.currentTarget.style.background = "rgba(255,255,255,0.07)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(232,234,240,0.35)"; e.currentTarget.style.background = "transparent"; }}
      >
        <MoreHorizontal size={13} />
      </button>
      <MenuView
        variant="secondary"
        open={open}
        onClose={() => setOpen(false)}
        className="absolute right-0 top-full mt-1 w-40 z-[100]"
      >
        {sections.map((section) => {
          const disabled = isTerminalView && disabledInTerminal.includes(section);
          const checked = sectionVisibility[section];
          return (
            <MenuViewItem
              key={section}
              variant="secondary"
              checked={checked}
              disabled={disabled}
              onClick={() => {
                if (disabled) return;
                toggleSection(section);
                setOpen(false);
              }}
            >
              {SECTION_LABELS[section]}
            </MenuViewItem>
          );
        })}
      </MenuView>
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
  const activeFileTab = useSessionStore((s) => s.tabs.find((t) => (t.type === "file" || t.type === "diff") && t.filePath === activeFilePath));
  const activeFileContent = activeFileTab?.type === "file" ? activeFileTab.fileContent : undefined;
  const activeTab = useSessionStore((s) => s.tabs.find((t) => t.id === s.activeTabId));
  const isTerminalView = activeTab?.type === "terminal";
  const sectionVisibility = useAppShellStore((s) => s.sectionVisibility);
  const [rootNodes, setRootNodes] = useState<FileNode[]>([]);
  const [workspaceName, setWorkspaceName] = useState("Workspace");
  const [resolvedCwd, setResolvedCwd] = useState<string>("");
  const [filterQuery, setFilterQuery] = useState("");
  const [creatingIn, setCreatingIn] = useState<{ parentPath: string; type: 'file' | 'folder' } | null>(null);
  const [creatingName, setCreatingName] = useState("");
  const [collapseAllKey, setCollapseAllKey] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [outlineRefreshKey, setOutlineRefreshKey] = useState(0);
  const [timelineRefreshKey, setTimelineRefreshKey] = useState(0);
  const [gitRefreshKey, setGitRefreshKey] = useState(0);
  const creatingInputRef = useRef<HTMLInputElement>(null);
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
    const handler = () => {
      setFileMenu(null);
      setDeleteConfirm(null);
      setDeleteError(null);
    };
    window.addEventListener("aurora-right-click-menu-close", handler);
    const unsub = onClosePopups(() => {
      handler();
    });
    return () => {
      window.removeEventListener("aurora-right-click-menu-close", handler);
      unsub();
    };
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
    closeAllPopups();
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

  // ── Create file / folder actions ─────────────────────────
  const handleCreateFile = useCallback(() => {
    if (!resolvedCwd) return;
    setCreatingIn({ parentPath: resolvedCwd, type: "file" });
    setCreatingName("");
  }, [resolvedCwd]);

  const handleCreateFolder = useCallback(() => {
    if (!resolvedCwd) return;
    setCreatingIn({ parentPath: resolvedCwd, type: "folder" });
    setCreatingName("");
  }, [resolvedCwd]);

  const commitCreate = useCallback(async () => {
    if (!creatingIn) return;
    const name = creatingName.trim();
    if (!name) { setCreatingIn(null); return; }
    try {
      // Handle nested paths like "temp/temp.md" � create intermediate dirs first
      const segments = name.replace(/\\/g, "/").split("/");
      let currentParent = creatingIn.parentPath;
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        if (!seg) continue;
        const isLast = i === segments.length - 1;
        if (isLast) {
          // Final segment � create the file or folder
          await invoke("create_path", {
            parentDir: currentParent,
            name: seg,
            isDir: creatingIn.type === "folder",
          });
        } else {
          // Intermediate directory � ensure it exists
          await invoke("create_path", {
            parentDir: currentParent,
            name: seg,
            isDir: true,
          }).catch(() => { });
          currentParent = currentParent + "/" + seg;
        }
      }
      setCreatingIn(null);
      setCreatingName("");
      // Collapse all and reload so tree picks up new structure
      setCollapseAllKey((k) => k + 1);
      if (resolvedCwd) loadTree(resolvedCwd);
    } catch (err) {
      console.error("Failed to create:", err);
      setCreatingIn(null);
    }
  }, [creatingIn, creatingName, resolvedCwd, loadTree]);

  const cancelCreate = useCallback(() => {
    setCreatingIn(null);
    setCreatingName("");
  }, []);

  useEffect(() => {
    if (creatingIn) creatingInputRef.current?.focus();
  }, [creatingIn]);

  const handleCollapseAll = useCallback(() => {
    setCollapseAllKey((k) => k + 1);
  }, []);

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
    closeAllPopups();
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
      className="relative flex flex-col z-20 overflow-hidden"
      style={{
        width,
        minWidth: MIN_WIDTH,
        maxWidth: MAX_WIDTH,
        flexShrink: 0,
        background: "#0F131A",
        borderRight: "1px solid rgba(255,255,255,0.06)",
        boxShadow: "4px 0 24px rgba(0,0,0,0.25)",
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* ── Explorer section (group enables hover for dir toolbar) ── */}
      <div className="flex flex-col flex-1 min-h-0 group">
        {/* ── EXPLORER header bar ── */}
        <div
          className="flex items-center justify-between px-3 select-none relative"
          style={{
            height: "34px",
            borderBottom: "1px solid rgba(255,255,255,0.05)",
          }}
        >
          <span
            className="text-[11px] font-bold tracking-[0.08em] uppercase"
            style={{ color: "rgba(255,255,255,0.35)" }}
          >
            Explorer
          </span>
          <SectionToggle />
        </div>

        {/* ── Workspace section ── */}
        {sectionVisibility.folders && (
          <CollapsibleSection
            label={workspaceName}
            initialOpen={true}
            loading={isLoading}
            controls={
              <>
                <SidebarIconBtn title="New File" onClick={handleCreateFile}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14,2 14,8 20,8" />
                    <line x1="12" y1="13" x2="12" y2="17" />
                    <line x1="10" y1="15" x2="14" y2="15" />
                  </svg>
                </SidebarIconBtn>
                <SidebarIconBtn title="New Folder" onClick={handleCreateFolder}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    <line x1="12" y1="11" x2="12" y2="17" />
                    <line x1="9" y1="14" x2="15" y2="14" />
                  </svg>
                </SidebarIconBtn>
                <SidebarIconBtn title="Refresh" onClick={() => { setRefreshKey((k) => k + 1); loadTree(resolvedCwd); }}>
                  <RefreshCw size={12} />
                </SidebarIconBtn>
                <SidebarIconBtn title="Collapse All" onClick={handleCollapseAll}>
                  <CopyMinus size={12} />
                </SidebarIconBtn>
              </>
            }
          >
            {/* ── File tree — scrollable ── */}
            <div className="flex-1 overflow-x-hidden sidepanel-scroll section-scroll" style={{ overflowY: "auto" }}>
              {error ? (
                <div className="text-[11px] px-3 py-3 whitespace-pre-wrap break-words leading-relaxed select-text" style={{ color: "#FF6B6B" }}>
                  {error}
                </div>
              ) : (
                <>
                  {filteredNodes.length === 0 && !isLoading && <div className="text-[11px] italic px-3 py-3" style={{ color: "rgba(232,234,240,0.2)" }}>No files</div>}
                  {filteredNodes.map((node) => (
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
                      creatingParent={creatingIn?.parentPath ?? null}
                      creatingType={creatingIn?.type ?? null}
                      creatingName={creatingName}
                      onCreatingNameChange={setCreatingName}
                      onCreatingCommit={commitCreate}
                      onCreatingCancel={cancelCreate}
                      collapseKey={collapseAllKey}
                      refreshKey={refreshKey}
                    />
                  ))}
                  {/* ── Root-level inline create input ── */}
                  {creatingIn && creatingIn.parentPath === resolvedCwd && (
                    <div
                      className="flex items-center gap-1.5"
                      style={{ paddingLeft: "10px", paddingTop: "4px", paddingBottom: "4px", minHeight: "24px" }}
                    >
                      <input
                        ref={creatingInputRef}
                        autoFocus
                        value={creatingName}
                        onChange={(e) => setCreatingName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") { e.preventDefault(); commitCreate(); }
                          if (e.key === "Escape") { e.preventDefault(); cancelCreate(); }
                        }}
                        onBlur={cancelCreate}
                        onClick={(e) => e.stopPropagation()}
                        placeholder={creatingIn.type === "folder" ? "folder name" : "file name"}
                        className="flex-1 min-w-0 text-sm bg-surface-container-high border border-primary/40 rounded px-1 outline-none text-on-surface placeholder:text-outline/30 focus:border-primary/70 transition-colors"
                        style={{ lineHeight: "1.4", marginLeft: "2px" }}
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          </CollapsibleSection>)}

        {/* ── OUTLINE section (hidden in terminal view) ── */}
        {!isTerminalView && sectionVisibility.outline && (
          <CollapsibleSection
            label="Outline"
            initialOpen={false}
            controls={
              <SidebarIconBtn title="Refresh" onClick={() => setOutlineRefreshKey((k) => k + 1)}>
                <RefreshCw size={12} />
              </SidebarIconBtn>
            }
          >
            <FileOutline key={outlineRefreshKey} filePath={activeFilePath} fileContent={activeFileContent} />
          </CollapsibleSection>
        )}

        {/* ── TIMELINE section (hidden in terminal view) ── */}
        {!isTerminalView && sectionVisibility.timeline && (
          <CollapsibleSection
            label="Timeline"
            initialOpen={false}
            controls={
              <SidebarIconBtn title="Refresh" onClick={() => setTimelineRefreshKey((k) => k + 1)}>
                <RefreshCw size={12} />
              </SidebarIconBtn>
            }
          >
            <FileTimeline key={timelineRefreshKey} filePath={activeFilePath} />
          </CollapsibleSection>
        )}

        {/* ── GIT section ── */}
        {sectionVisibility.git && (
          <CollapsibleSection
            label="Git Graph"
            initialOpen={false}
            controls={
              <SidebarIconBtn title="Refresh" onClick={() => setGitRefreshKey((k) => k + 1)}>
                <RefreshCw size={12} />
              </SidebarIconBtn>
            }
          >
            <GitTree key={gitRefreshKey} />
          </CollapsibleSection>
        )}
      </div>{/* end explorer section group */}

      <div
        onMouseDown={onDragHandleMouseDown}
        className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize z-30 group"
        title="Drag to resize"
      >
        <div className="w-px h-full ml-auto transition-colors" style={{ background: "transparent" }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(79,140,255,0.35)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        />
      </div>

      {/* ── File Context Menu — rendered as fixed so it escapes overflow:hidden ── */}
      <MenuView
        variant="rightclick"
        open={!!fileMenu}
        onClose={() => setFileMenu(null)}
        anchorX={fileMenu?.x ?? 0}
        anchorY={fileMenu?.y ?? 0}
      >
        {/* File header — shows what item was right-clicked */}
        <div className="px-3 pt-1 pb-2 flex items-center gap-2 border-b border-outline-variant/10 mb-1">
          {fileMenu?.node.is_dir && <Folder size={12} className="text-primary/70 shrink-0" />}
          <span className="text-sm text-on-surface-variant/60 overflow-hidden text-ellipsis whitespace-nowrap">{fileMenu?.node.name}</span>
        </div>

        {/* Copy Name */}
        <MenuViewItem variant="rightclick" icon={<ClipboardCopy size={13} />} onClick={() => { if (!fileMenu) return; copyToClipboard(fileMenu.node.name); setFileMenu(null); }}>
          Copy Name
        </MenuViewItem>

        {/* Copy Path */}
        <MenuViewItem variant="rightclick" icon={<Copy size={13} />} onClick={() => { if (!fileMenu) return; copyToClipboard(fileMenu.node.path); setFileMenu(null); }}>
          Copy Path
        </MenuViewItem>

        {/* Copy (to clipboard buffer) */}
        <MenuViewItem variant="rightclick" icon={<ClipboardList size={13} />} onClick={() => { if (fileMenu) handleCopy(fileMenu.node); }}>
          Copy
        </MenuViewItem>

        {/* Cut (to clipboard buffer) */}
        <MenuViewItem variant="rightclick" icon={<Scissors size={13} />} onClick={() => { if (fileMenu) handleCut(fileMenu.node); }}>
          Cut
        </MenuViewItem>

        {/* Paste (only when clipboard has content) */}
        {clipboardHasContent && (
          <MenuViewItem variant="rightclick" icon={<ClipboardList size={13} />} onClick={handlePaste}>
            Paste
          </MenuViewItem>
        )}

        <MenuViewSeparator />

        {/* Reveal in Explorer */}
        <MenuViewItem variant="rightclick" icon={<FolderOpen size={13} />} onClick={() => { if (!fileMenu) return; revealInExplorer(fileMenu.node.path); setFileMenu(null); }}>
          Reveal in Explorer
        </MenuViewItem>

        <MenuViewSeparator />

        {/* For directories: Terminal options */}
        {fileMenu?.node.is_dir && (
          <>
            <MenuViewItem variant="rightclick" icon={<Terminal size={13} />} onClick={handleOpenFolderInAurora}>
              Open Here
            </MenuViewItem>
            <MenuViewItem variant="rightclick" icon={<Terminal size={13} />} onClick={handleOpenFolderInNewTab}>
              Open in New Tab
            </MenuViewItem>
          </>
        )}

        {/* For files: Open in editor */}
        {fileMenu && !fileMenu.node.is_dir && (
          <MenuViewItem variant="rightclick" icon={<FileText size={13} />} onClick={() => {
            window.dispatchEvent(
              new CustomEvent("sidebar-open-file", { detail: { path: fileMenu.node.path } })
            );
            setFileMenu(null);
          }}>
            Open
          </MenuViewItem>
        )}
        <MenuViewItem variant="rightclick" icon={<ExternalLink size={13} />} onClick={() => {
          if (!fileMenu) return;
          const rel = fileMenu.node.path
            .replace(resolvedCwd, "")
            .replace(/^[/\\]/, "");
          copyToClipboard(rel);
          setFileMenu(null);
        }}>
          Copy Relative Path
        </MenuViewItem>

        <MenuViewSeparator />

        {/* Rename */}
        <MenuViewItem variant="rightclick" icon={<Pencil size={13} />} onClick={() => { if (fileMenu) startRename(fileMenu.node); }}>
          Rename
        </MenuViewItem>

        {/* Delete */}
        <MenuViewItem variant="rightclick" icon={<Trash2 size={13} />} onClick={() => { if (fileMenu) startDelete(fileMenu.node); }} danger>
          Delete
        </MenuViewItem>
      </MenuView>

      {/* ── Delete confirmation modal ── */}
      {deleteConfirm && (
        <div
          className="fixed inset-0 z-[300] flex items-center justify-center backdrop-blur-sm"
          style={{ background: "rgba(0,0,0,0.55)" }}
          onClick={() => { if (!isDeleting) setDeleteConfirm(null); }}
        >
          <div
            className="w-[380px] overflow-hidden"
            style={{
              background: "#131A24",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: "18px",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03), 0 24px 64px rgba(0,0,0,0.6)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 pt-5 pb-3">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle size={15} style={{ color: "#FF6B6B" }} className="shrink-0" />
                <h3 className="text-[13px] font-semibold" style={{ color: "#E8EAF0" }}>
                  Delete {deleteConfirm.node.is_dir ? "folder" : "file"}?
                </h3>
              </div>
              <p className="text-[12px] leading-relaxed" style={{ color: "rgba(232,234,240,0.55)" }}>
                Are you sure you want to permanently delete{" "}
                <span style={{ color: "#4F8CFF", fontWeight: 500 }}>{deleteConfirm.node.name}</span>?
                {deleteConfirm.node.is_dir && (
                  <span style={{ color: "rgba(255,107,107,0.75)" }}> This will delete all contents inside.</span>
                )}
              </p>
              {deleteError && (
                <p className="text-[11px] mt-2" style={{ color: "#FF6B6B" }}>{deleteError}</p>
              )}
            </div>
            <div className="flex justify-end gap-2 px-5 pb-4 pt-1">
              <button
                className="px-3 py-1.5 text-[11px] rounded-[10px] transition-colors cursor-pointer"
                style={{
                  border: "1px solid rgba(255,255,255,0.08)",
                  color: "rgba(232,234,240,0.55)",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                onClick={() => setDeleteConfirm(null)}
                disabled={isDeleting}
              >
                Cancel
              </button>
              <button
                className="px-3 py-1.5 text-[11px] rounded-[10px] font-semibold transition-colors cursor-pointer disabled:opacity-50"
                style={{
                  background: "rgba(255,107,107,0.15)",
                  border: "1px solid rgba(255,107,107,0.25)",
                  color: "#FF6B6B",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,107,107,0.22)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,107,107,0.15)"; }}
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

/* ── FileIcon ───────────────────────────────────────────────────────── */
const FILE_ICON_MAP: Record<string, { icon: typeof FileText; color: string }> = {
  ts: { icon: FileCode, color: "#3178C6" },
  tsx: { icon: FileCode, color: "#3178C6" },
  js: { icon: FileCode, color: "#F7DF1E" },
  jsx: { icon: FileCode, color: "#F7DF1E" },
  rs: { icon: FileCode, color: "#DEA584" },
  py: { icon: FileCode, color: "#3572A5" },
  go: { icon: FileCode, color: "#00ADD8" },
  json: { icon: FileJson, color: "#8BC34A" },
  css: { icon: FileCode, color: "#42A5F5" },
  scss: { icon: FileCode, color: "#C6538C" },
  html: { icon: FileCode, color: "#E44D26" },
  svg: { icon: FileImage, color: "#FFB300" },
  png: { icon: FileImage, color: "#29B6F6" },
  jpg: { icon: FileImage, color: "#29B6F6" },
  jpeg: { icon: FileImage, color: "#29B6F6" },
  gif: { icon: FileImage, color: "#29B6F6" },
  ico: { icon: FileImage, color: "#29B6F6" },
  md: { icon: FileText, color: "#42A5F5" },
  toml: { icon: FileCode, color: "#9C27B0" },
  yaml: { icon: FileCode, color: "#6B2FA0" },
  yml: { icon: FileCode, color: "#6B2FA0" },
  lock: { icon: FileArchive, color: "#78909C" },
  csv: { icon: FileSpreadsheet, color: "#43A047" },
  mp3: { icon: FileAudio, color: "#FF7043" },
  wav: { icon: FileAudio, color: "#FF7043" },
  mp4: { icon: FileVideo, color: "#FF7043" },
  zip: { icon: FileArchive, color: "#78909C" },
  gz: { icon: FileArchive, color: "#78909C" },
  sql: { icon: FileCode, color: "#E91E63" },
  sh: { icon: FileCode, color: "#4CAF50" },
  ps1: { icon: FileCode, color: "#012456" },
};

function FileIcon({ fileName, isActive, isGitignored }: { fileName: string; isActive: boolean; isGitignored: boolean }) {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  const match = FILE_ICON_MAP[ext];
  const IconComponent = match?.icon ?? FileText;
  const color = isActive ? "#4F8CFF" : match?.color ?? "rgba(232,234,240,0.4)";
  const opacity = isGitignored ? 0.4 : 1;

  return (
    <IconComponent size={12} className="shrink-0" style={{ color, opacity }} />
  );
}

/* ── SidebarIconBtn ─────────────────────────────────────────────────── */
function SidebarIconBtn({
  children,
  title,
  onClick,
}: {
  children: React.ReactNode;
  title?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="w-6 h-6 flex items-center justify-center rounded-[6px] cursor-pointer transition-colors"
      style={{ color: "rgba(232,234,240,0.4)" }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.07)"; e.currentTarget.style.color = "#E8EAF0"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "rgba(232,234,240,0.4)"; }}
    >
      {children}
    </button>
  );
}

/* ── CollapsibleSection ────────────────────────────────────────────── */
function CollapsibleSection({ label, initialOpen, children, controls, loading }: {
  label: string;
  initialOpen?: boolean;
  children?: React.ReactNode;
  controls?: React.ReactNode;
  loading?: boolean;
}) {
  const [isOpen, setIsOpen] = React.useState(initialOpen ?? false);
  const [sectionHeight, setSectionHeight] = React.useState<number | null>(null);
  const dragRef = React.useRef<{ startY: number; startH: number; maxH: number } | null>(null);

  useEffect(() => {
    if (initialOpen !== undefined) {
      setIsOpen(initialOpen);
    }
  }, [initialOpen]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = e.clientY - dragRef.current.startY;
      const newH = Math.max(60, Math.min(dragRef.current.maxH, dragRef.current.startH + delta));
      setSectionHeight(newH);
    };
    const onMouseUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
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

  const onResizeHandleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const parent = (e.currentTarget.closest(".flex-col") || e.currentTarget.parentElement) as HTMLElement | null;
    const contentEl = e.currentTarget.parentElement?.querySelector(".section-scroll") as HTMLElement | null;
    dragRef.current = {
      startY: e.clientY,
      startH: contentEl?.offsetHeight ?? 200,
      maxH: parent ? parent.offsetHeight - 30 : 9999,
    };
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  };

  return (
    <div className="flex flex-col min-h-0" style={{
      borderTop: "1px solid rgba(255,255,255,0.05)",
      flex: isOpen ? (sectionHeight !== null ? "0 0 auto" : "1 1 0%") : "0 0 auto",
      height: isOpen && sectionHeight !== null ? sectionHeight : undefined,
      minHeight: isOpen ? "60px" : undefined,
    }}>
      <div
        className="w-full flex items-center gap-1.5 px-3 cursor-pointer select-none transition-colors group"
        style={{ height: "30px", color: "rgba(232,234,240,0.35)" }}
        onClick={() => setIsOpen((v) => !v)}
        onMouseEnter={(e) => (e.currentTarget.style.color = "rgba(232,234,240,0.65)")}
        onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(232,234,240,0.35)")}
      >
        <div className="flex items-center gap-1.5 flex-1 min-w-0 pointer-events-none">
          {isOpen
            ? <ChevronDown size={11} className="shrink-0" />
            : <ChevronRight size={11} className="shrink-0" />
          }
          <span className="text-[11px] font-bold uppercase tracking-[0.08em] truncate">{label}</span>
        </div>
        {isOpen && controls && (
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
            {controls}
          </div>
        )}
        {loading && <RefreshCw size={10} className="animate-spin shrink-0" style={{ color: "#4F8CFF" }} />}
      </div>
      {isOpen && (
        <div className="px-0 py-0 text-sm overflow-x-hidden section-scroll" style={{
          flex: "1 1 0%",
          minHeight: 0,
          overflowY: "auto",
        }}>
          {children || (
            <div className="px-3 py-2 text-sm" style={{ color: "rgba(232,234,240,0.25)" }}>No items</div>
          )}
        </div>
      )}
      {isOpen && (
        <div
          className="shrink-0 cursor-row-resize hover:bg-primary/20 transition-colors"
          style={{ height: "3px" }}
          onMouseDown={onResizeHandleMouseDown}
        />
      )}
    </div>
  );
}
