import React, { useState, useEffect, useRef, useCallback } from "react";
import { Folder, FileText, ChevronDown, ChevronRight, Search, RefreshCw } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

interface SidePanelProps {
  collapsed: boolean;
  cwd?: string; // absolute cwd — passed from App so we react to cd changes
}

interface FileNode {
  name: string;
  path: string;
  is_dir: boolean;
}

// ─────────────────────── TreeNode ────────────────────────
function TreeNode({
  node,
  depth,
  selectedFile,
  onSelect,
}: {
  node: FileNode;
  depth: number;
  selectedFile: string;
  onSelect: (path: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [children, setChildren] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(false);

  const handleToggle = async () => {
    if (node.is_dir) {
      if (!isOpen && children.length === 0) {
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
    } else {
      onSelect(node.path);
    }
  };

  const isSelected = selectedFile === node.path;
  const indent = depth * 14 + 10; // px

  return (
    <div className="select-none">
      <div
        onClick={handleToggle}
        title={node.name}
        className={`flex items-center gap-1.5 cursor-pointer transition-colors ${isSelected && !node.is_dir
          ? "bg-primary/8 text-primary border-l-2 border-primary"
          : "hover:bg-surface-variant/20 text-on-surface-variant/80 border-l-2 border-transparent"
          }`}
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
              <ChevronDown size={11} className="text-outline/60 shrink-0" />
            ) : (
              <ChevronRight size={11} className="text-outline/60 shrink-0" />
            )}
            <Folder
              size={12}
              className={`shrink-0 ${isOpen ? "text-primary/80" : "text-primary-container/80"}`}
            />
          </>
        ) : (
          <FileText
            size={12}
            className={`shrink-0 ml-[15px] ${isSelected ? "text-primary" : "text-outline/50"}`}
          />
        )}
        {/* Truncate name based on available space */}
        <span
          className="text-[11.5px] font-code-sm overflow-hidden text-ellipsis whitespace-nowrap min-w-0 flex-1"
          style={{ lineHeight: "1.4" }}
        >
          {node.name}
        </span>
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
                onSelect={onSelect}
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
  const [rootNodes, setRootNodes] = useState<FileNode[]>([]);
  const [workspaceName, setWorkspaceName] = useState("Workspace");
  const [resolvedCwd, setResolvedCwd] = useState<string>("");
  const [filterQuery, setFilterQuery] = useState("");
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(DEFAULT_WIDTH);
  const panelRef = useRef<HTMLElement>(null);

  // ── Load file tree for a given absolute path ──────────────
  const loadTree = useCallback(async (absolutePath: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const parts = absolutePath.split(/[/\\]/);
      setWorkspaceName(parts[parts.length - 1] || absolutePath);
      const res = await invoke<FileNode[]>("read_dir", { path: absolutePath });
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

  // ── React to cwd prop changes (cd command) ────────────────
  useEffect(() => {
    if (!cwd || cwd === resolvedCwd) return;
    setResolvedCwd(cwd);
    loadTree(cwd);
  }, [cwd, resolvedCwd, loadTree]);

  // ── Also listen for the global cwd-change custom event ───
  useEffect(() => {
    const handler = (e: Event) => {
      const { path } = (e as CustomEvent<{ path: string }>).detail;
      if (!path || path === resolvedCwd) return;
      setResolvedCwd(path);
      loadTree(path);
    };
    window.addEventListener("cwd-change", handler);
    return () => window.removeEventListener("cwd-change", handler);
  }, [resolvedCwd, loadTree]);

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
              onSelect={setSelectedFile}
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
        {/* Visible indicator on hover */}
        <div className="w-px h-full ml-auto group-hover:bg-primary/40 transition-colors" />
      </div>
    </aside>
  );
}
