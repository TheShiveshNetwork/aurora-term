import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Folder, FileText, ChevronDown, ChevronRight, Search, RefreshCw,
  Copy, FolderOpen, Terminal, ExternalLink, ClipboardCopy,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import {
  RightClickMenuItem,
  RightClickMenuPanel,
  RightClickMenuSeparator,
} from "./RightClickMenu";

interface SidePanelProps {
  collapsed: boolean;
  cwd?: string; // absolute cwd — passed from App so we react to cd changes
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
}: {
  node: FileNode;
  depth: number;
  selectedFile: string;
  activePath: string;
  onSelect: (path: string) => void;
  onActivate: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, node: FileNode) => void;
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
        ? "text-on-surface-variant/35"
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

  return (
    <div className="select-none">
      <div
        onClick={handleClick}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onContextMenu(e, node);
        }}
        title={node.name}
        className={`${rowClass} ${textColorClass}`}
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
        <span
          className={`text-[11.5px] font-code-sm overflow-hidden text-ellipsis whitespace-nowrap min-w-0 flex-1 transition-colors group-hover:text-on-surface ${isGitignored ? "italic opacity-60" : ""}`}
          style={{ lineHeight: "1.4" }}
        >
          {node.name}
        </span>
        {isGitignored && (
          <span className="shrink-0 w-1 h-1 rounded-full bg-outline/20 mr-0.5 transition-colors group-hover:bg-primary/30" aria-hidden="true" />
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
            children.map((child) => (
              <TreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                selectedFile={selectedFile}
                activePath={activePath}
                onSelect={onSelect}
                onActivate={onActivate}
                onContextMenu={onContextMenu}
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

export function SidePanel({ collapsed, cwd }: SidePanelProps) {
  const [selectedFile, setSelectedFile] = useState<string>("");
  const [activePath, setActivePath] = useState<string>("");
  const [rootNodes, setRootNodes] = useState<FileNode[]>([]);
  const [workspaceName, setWorkspaceName] = useState("Workspace");
  const [resolvedCwd, setResolvedCwd] = useState<string>("");
  const [filterQuery, setFilterQuery] = useState("");
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── File context menu state ───────────────────────────────
  const [fileMenu, setFileMenu] = useState<FileMenuState | null>(null);

  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(DEFAULT_WIDTH);
  const panelRef = useRef<HTMLElement>(null);

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
    setIsLoading(true);
    setError(null);
    setActivePath("");
    setSelectedFile("");
    try {
      const parts = absolutePath.split(/[/\\]/);
      setWorkspaceName(parts[parts.length - 1] || absolutePath);
      const res = await invoke<FileNode[]>("read_dir", { path: absolutePath });
      serializedRootRef.current = JSON.stringify(res);
      setRootNodes(res);
    } catch (err) {
      console.error("Failed to load workspace tree:", err);
      setError(String(err) || "Failed to load workspace files.");
    } finally {
      setIsLoading(false);
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
    if (!cwd || cwd === resolvedCwd) return;
    setResolvedCwd(cwd);
    loadTree(cwd);
  }, [cwd, resolvedCwd, loadTree]);

  // ── Listen for cwd-change from terminal CWD sentinel ─────
  // Only reload when the path actually differs.
  const lastLoadedPathRef = useRef("");
  useEffect(() => {
    const handler = (e: Event) => {
      const { path } = (e as CustomEvent<{ path: string }>).detail;
      if (!path || path === resolvedCwd || path === lastLoadedPathRef.current) return;
      lastLoadedPathRef.current = path;
      setResolvedCwd(path);
      loadTree(path);
    };
    window.addEventListener("cwd-change", handler);
    return () => window.removeEventListener("cwd-change", handler);
  }, [resolvedCwd, loadTree]);

  // ── Poll root directory every 4s for live updates ────────
  const serializedRootRef = useRef("");
  useEffect(() => {
    if (collapsed || !resolvedCwd) return;
    const interval = setInterval(async () => {
      try {
        const res = await invoke<FileNode[]>("read_dir", { path: resolvedCwd });
        const serialized = JSON.stringify(res);
        if (serialized !== serializedRootRef.current) {
          serializedRootRef.current = serialized;
          setRootNodes(res);
        }
      } catch {
        // silently ignore errors during polling
      }
    }, 4000);
    return () => clearInterval(interval);
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

  // ── Filter helper ─────────────────────────────────────────
  const filteredNodes = filterQuery.trim()
    ? rootNodes.filter((n) =>
      n.name.toLowerCase().includes(filterQuery.toLowerCase())
    )
    : rootNodes;

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
          <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-outline/40 group-focus-within:text-primary transition-colors shrink-0" />
          <input
            type="text"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder="Filter files…"
            className="w-full bg-surface-container-high/30 border border-outline-variant/10 rounded-md pl-6 pr-2 py-1 text-[11px] font-code-sm placeholder:text-outline/25 focus:ring-0 focus:border-outline-variant/20 outline-none transition-all"
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
      <div className="flex-1 overflow-y-auto overflow-x-hidden pb-4 no-scrollbar">
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
            {fileMenu.node.is_dir && <Folder size={11} className="text-primary/70 shrink-0" />}
            <span className="text-[11px] font-code-sm text-on-surface-variant/60 overflow-hidden text-ellipsis whitespace-nowrap">{fileMenu.node.name}</span>
          </div>

          {/* Copy File Name */}
          <RightClickMenuItem icon={<ClipboardCopy size={13} />} onClick={() => { copyToClipboard(fileMenu.node.name); setFileMenu(null); }}>
            Copy Name
          </RightClickMenuItem>

          {/* Copy File Path */}
          <RightClickMenuItem icon={<Copy size={13} />} onClick={() => { copyToClipboard(fileMenu.node.path); setFileMenu(null); }}>
            Copy Path
          </RightClickMenuItem>

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
        </RightClickMenuPanel>
      )}
    </aside>
  );
}
