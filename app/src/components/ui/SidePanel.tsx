import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Folder, FileText, FileCode, FileImage, FileJson, FileSpreadsheet, FileAudio, FileVideo, FileArchive,
  ChevronDown, ChevronRight, RefreshCw, MoreHorizontal, Search,
  Copy, FolderOpen, Terminal, ExternalLink, ClipboardCopy, Pencil, Trash2,
  ClipboardList, Scissors, CopyMinus, GitBranch, Plus,
} from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useSessionStore } from "../../stores/useSessionStore";
import { useAppShellStore } from "../../stores/useAppShellStore";
import { MenuView, MenuViewItem, MenuViewSeparator } from "./MenuView";
import { closeAllPopups, onClosePopups } from "../../lib/popups";
import type { SideSection } from "../../stores/useAppShellStore";
import { Button } from "./Button";
import { Modal } from "./Modal";
import { useCopyWithFeedback } from "../../hooks/useCopyWithFeedback";
import { system } from "../../lib/ipc";
import type { FileNode } from "../../lib/ipc";
import { FileOutline } from "./FileOutline";
import { FileTimeline } from "./FileTimeline";
import { GitTree } from "./GitTree";
import { OpenTabs } from "./OpenTabs";
import { SearchInFiles } from "./SearchInFiles";
import { useSearchStore } from "../../stores/useSearchStore";

// ── Normalize path for comparison ────────────────────────────────────────────
function pathsEqual(a: string, b: string): boolean {
  if (a === b) return true;
  const normalize = (p: string) =>
    p.toLowerCase().replace(/[/\\]+/g, "\\").replace(/[\\/]$/, "");
  return normalize(a) === normalize(b);
}

function pathStartsWith(path: string, prefix: string): boolean {
  const normPath = path.toLowerCase().replace(/[/\\]+/g, "/");
  const normPrefix = prefix.toLowerCase().replace(/[/\\]+/g, "/");
  if (normPath === normPrefix) return true;
  if (!normPath.startsWith(normPrefix)) return false;
  const next = normPath.slice(normPrefix.length);
  return next.startsWith("/");
}

interface SidePanelProps {
  collapsed: boolean;
  cwd?: string;
  activeFilePath?: string;
  onKillTab?: (id: string) => void;
  onAddTab?: (type: "terminal" | "file") => void;
  onOpenFileAtPath?: (path: string, options?: { lineNumber?: number; matchStart?: number; matchEnd?: number }) => void;
}

interface FileMenuState { x: number; y: number; node: FileNode }
interface RenameState { path: string; currentName: string; value: string }
interface ClipboardState { path: string; operation: "copy" | "cut" }
interface DeleteConfirmState { nodes: { path: string; name: string; is_dir: boolean }[] }

const isExcluded = (name: string) =>
  name === ".git" || name === ".DS_Store" || name.endsWith(".swp") || name.endsWith(".swo") || name.startsWith("~");

function sortNodes(nodes: FileNode[]): FileNode[] {
  return [...nodes].sort((a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
    const aDot = a.name.startsWith(".");
    const bDot = b.name.startsWith(".");
    if (aDot !== bDot) return aDot ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

// ── TreeNode ──────────────────────────────────────────────────────────────────
function TreeNode({
  node, depth, selectedFile, activePath, selectedPaths, onClickNode, onContextMenu,
  renamingPath, renameValue, onRenameChange, onRenameCommit, onRenameCancel,
  dragOverPath, draggedNodePath, onStartMouseDrag, onDeleteNode,
  expandPath, collapsePath,
  creatingParent, creatingType, creatingName, onCreatingNameChange, onCreatingCommit, onCreatingCancel,
  collapseKey, refreshKey,
}: {
  node: FileNode; depth: number; selectedFile: string; activePath: string; selectedPaths: Set<string>;
  onClickNode: (node: FileNode, e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent, node: FileNode) => void;
  renamingPath: string; renameValue: string;
  onRenameChange: (val: string) => void; onRenameCommit: () => void; onRenameCancel: () => void;
  dragOverPath: string | null; draggedNodePath: string | null;
  onStartMouseDrag: (e: React.MouseEvent, node: FileNode) => void;
  onDeleteNode: (nodes: FileNode[]) => void;
  expandPath: string | null; collapsePath: string | null;
  creatingParent: string | null; creatingType: "file" | "folder" | null;
  creatingName: string; onCreatingNameChange: (val: string) => void;
  onCreatingCommit: () => void; onCreatingCancel: () => void;
  collapseKey?: number; refreshKey?: number;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [children, setChildren] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(false);
  const loadedRef = useRef(false);
  const refreshSkipRef = useRef(true);

  const loadChildren = useCallback(async () => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    setLoading(true);
    try {
      setChildren(await system.readDir(node.path));
    } catch (err) {
      console.error(err);
      loadedRef.current = false;
    } finally {
      setLoading(false);
    }
  }, [node.path]);

  // Auto-expand when active file is inside this dir
  useEffect(() => {
    if (!node.is_dir || !activePath || activePath === node.path) return;
    if (!pathStartsWith(activePath, node.path)) return;
    loadChildren();
    setIsOpen(true);
  }, [activePath, node.path, node.is_dir, loadChildren]);

  // Drag hover expand/collapse
  useEffect(() => {
    if (!node.is_dir || expandPath !== node.path) return;
    loadChildren();
    setIsOpen(true);
  }, [expandPath, node.path, node.is_dir, loadChildren]);

  useEffect(() => {
    if (!node.is_dir || collapsePath !== node.path) return;
    setIsOpen(false);
  }, [collapsePath, node.path, node.is_dir]);

  // Creating inside this dir
  useEffect(() => {
    if (!node.is_dir || creatingParent !== node.path) return;
    loadChildren();
    setIsOpen(true);
  }, [creatingParent, node.path, node.is_dir, loadChildren]);

  // Collapse all
  useEffect(() => {
    if (!node.is_dir) return;
    setIsOpen(false);
    loadedRef.current = false;
    setChildren([]);
  }, [collapseKey]); // eslint-disable-line

  // Refresh — re-read children when an external/disk change happens (fs-tree-changed)
  // or the user clicks the Refresh button. Skipped on initial mount so collapsed
  // folders stay lazily loaded. Expanded folders re-fetch now; collapsed folders
  // just drop their cached listing so a later expand re-reads from disk.
  useEffect(() => {
    if (!node.is_dir) return;
    if (refreshSkipRef.current) { refreshSkipRef.current = false; return; }
    loadedRef.current = false;
    setChildren([]);
    if (isOpen) loadChildren();
  }, [refreshKey]); // eslint-disable-line

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    onClickNode(node, e);
    if (e.shiftKey && !node.is_dir) {
      onDeleteNode([node]);
      return;
    }
    if (node.is_dir) {
      const next = !isOpen;
      setIsOpen(next);
      if (next) await loadChildren();
    } else {
      if (!e.ctrlKey && !e.metaKey) {
        window.dispatchEvent(new CustomEvent("sidebar-open-file", { detail: { path: node.path } }));
      }
    }
  };

  const indent = depth * 14 + 10;
  const isRenaming = renamingPath === node.path;
  const isDragOver = dragOverPath === node.path;
  const isBeingDragged = draggedNodePath === node.path;
  const isActive = activePath === node.path;
  const isSelected = selectedPaths.has(node.path);
  const isCreating = creatingParent === node.path && node.is_dir;

  return (
    <div className="select-none">
      <div
        onMouseDown={(e) => {
          if (isRenaming) return;
          if (e.button !== 0) return; // Only left click
          onStartMouseDrag(e, node);
        }}
        onClick={isRenaming ? undefined : handleClick}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); if (!isRenaming) onContextMenu(e, node); }}
        title={isRenaming ? undefined : node.name}
        data-path={node.path}
        data-is-dir={node.is_dir ? "true" : "false"}
        data-active-file={isActive ? "true" : undefined}
        className={`flex items-center gap-1.5 cursor-pointer transition-colors relative ${isBeingDragged ? "opacity-40" : ""}`}
        style={{
          paddingLeft: `${indent}px`, paddingRight: "8px",
          paddingTop: "4px", paddingBottom: "4px", minHeight: "24px",
          background: isActive
            ? "rgba(79,140,255,0.12)"
            : isSelected
              ? "rgba(79,140,255,0.06)"
              : isDragOver
                ? node.is_dir
                  ? "rgba(79,140,255,0.10)"
                  : "rgba(79,140,255,0.15)"
                : undefined,
          borderLeft: isActive ? "2px solid rgba(79,140,255,0.55)" : "2px solid transparent",
        }}
      >
        {/* Drag indicator line */}
        {isDragOver && (
          <div
            className="absolute top-0 left-0 right-0 h-[2px] pointer-events-none z-10 rounded-b-[1px]"
            style={{
              background: "#4F8CFF",
              boxShadow: "0 0 6px rgba(79,140,255,0.5), 0 0 2px rgba(79,140,255,0.3)",
              animation: "tab-drop-pop-in 150ms ease-out forwards",
            }}
          />
        )}
        {node.is_dir ? (
          <>
            {isOpen
              ? <ChevronDown size={11} className="shrink-0" style={{ color: "rgba(232,234,240,0.35)" }} />
              : <ChevronRight size={11} className="shrink-0" style={{ color: "rgba(232,234,240,0.35)" }} />
            }
            {isOpen
              ? <FolderOpen size={12} className="shrink-0" style={{ color: "#61AFEF" }} />
              : <Folder size={12} className="shrink-0" style={{ color: "#61AFEF" }} />
            }
          </>
        ) : (
          <FileIcon fileName={node.name} isActive={isActive} isGitignored={node.is_gitignored} />
        )}

        {isRenaming ? (
          <input
            autoFocus value={renameValue}
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
            className={`text-sm overflow-hidden text-ellipsis whitespace-nowrap min-w-0 flex-1 transition-colors ${node.is_gitignored ? "italic opacity-60" : ""}`}
            style={{ lineHeight: "1.4" }}
          >
            {node.name}
          </span>
        )}
      </div>

      {node.is_dir && isOpen && (
        <div
          data-path={node.path}
          data-is-dir="true"
        >
          {loading ? (
            <div className="text-on-surface-variant/40 text-[10px] italic py-1" style={{ paddingLeft: `${indent + 24}px` }}>
              Loading…
            </div>
          ) : (
            sortNodes(children.filter((c) => !isExcluded(c.name))).map((child) => (
              <TreeNode
                key={child.path} node={child} depth={depth + 1}
                selectedFile={selectedFile} activePath={activePath}
                selectedPaths={selectedPaths} onClickNode={onClickNode} onContextMenu={onContextMenu}
                renamingPath={renamingPath} renameValue={renameValue}
                onRenameChange={onRenameChange} onRenameCommit={onRenameCommit} onRenameCancel={onRenameCancel}
                dragOverPath={dragOverPath} draggedNodePath={draggedNodePath}
                onStartMouseDrag={onStartMouseDrag} onDeleteNode={onDeleteNode}
                expandPath={expandPath} collapsePath={collapsePath}
                creatingParent={creatingParent} creatingType={creatingType}
                creatingName={creatingName} onCreatingNameChange={onCreatingNameChange}
                onCreatingCommit={onCreatingCommit} onCreatingCancel={onCreatingCancel}
                collapseKey={collapseKey} refreshKey={refreshKey}
              />
            ))
          )}
          {isCreating && (
            <div className="flex items-center gap-1.5" style={{ paddingLeft: `${indent + 24}px`, paddingTop: "4px", paddingBottom: "4px", minHeight: "24px" }}>
              <input
                autoFocus value={creatingName} onChange={(e) => onCreatingNameChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); onCreatingCommit(); }
                  if (e.key === "Escape") { e.preventDefault(); onCreatingCancel(); }
                }}
                onBlur={onCreatingCancel} onClick={(e) => e.stopPropagation()}
                placeholder={creatingType === "folder" ? "folder name" : "file name"}
                className="flex-1 min-w-0 text-sm bg-surface-container-high border border-primary/40 rounded px-1 outline-none text-on-surface placeholder:text-outline/30 focus:border-primary/70 transition-colors"
                style={{ lineHeight: "1.4", marginLeft: "2px" }}
              />
            </div>
          )}
          {!loading && children.length === 0 && !isCreating && (
            <div className="text-on-surface-variant/60 text-sm italic py-1" style={{ paddingLeft: `${indent + 24}px` }}>
              Empty
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── SectionToggle ─────────────────────────────────────────────────────────────
const SECTION_LABELS: Record<SideSection, string> = {
  folders: "Folders", "open-tabs": "Open Tabs", outline: "Outline", timeline: "Timeline", git: "Git",
};

function SectionToggle() {
  const [open, setOpen] = useState(false);
  const sectionVisibility = useAppShellStore((s) => s.sectionVisibility);
  const toggleSection = useAppShellStore((s) => s.toggleSection);
  const isTerminalView = useSessionStore((s) => {
    const t = s.tabs.find((t) => t.id === s.activeTabId);
    return t?.type === "terminal";
  });
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
      <MenuView variant="secondary" open={open} onClose={() => setOpen(false)} className="absolute right-0 top-full mt-1 w-40 z-[100]">
        {SECTIONS.map((section) => {
          const disabled = isTerminalView && disabledInTerminal.includes(section);
          return (
            <MenuViewItem key={section} variant="secondary" checked={sectionVisibility[section]} disabled={disabled}
              onClick={() => { if (!disabled) { toggleSection(section); setOpen(false); } }}
            >
              {SECTION_LABELS[section]}
            </MenuViewItem>
          );
        })}
      </MenuView>
    </div>
  );
}

// ── SidebarIconBtn ────────────────────────────────────────────────────────────
function SidebarIconBtn({ children, title, onClick, active }: { children: React.ReactNode; title?: string; onClick?: () => void; active?: boolean }) {
  return (
    <button type="button" title={title} onClick={onClick}
      className="w-6 h-6 flex items-center justify-center rounded-[6px] cursor-pointer transition-colors"
      style={{
        color: active ? "#E8EAF0" : "rgba(232,234,240,0.4)",
        background: active ? "rgba(255,255,255,0.07)" : "transparent",
      }}
      onMouseEnter={(e) => {
        if (!active) { e.currentTarget.style.background = "rgba(255,255,255,0.07)"; e.currentTarget.style.color = "#E8EAF0"; }
      }}
      onMouseLeave={(e) => {
        if (!active) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "rgba(232,234,240,0.4)"; }
      }}
    >
      {children}
    </button>
  );
}

// ── Section constants ──────────────────────────────────────────────────────────
const HEADER_H = 30;
const RH = 4;
const MIN_SECTION_H = 60;
const SECTIONS: SideSection[] = ['folders', 'open-tabs', 'outline', 'timeline', 'git'];
const DEFAULT_HEIGHTS: Record<SideSection, number> = {
  folders: 400, "open-tabs": 150, outline: 200, timeline: 200, git: 200,
};

// ── CollapsibleSection ────────────────────────────────────────────────────────
// All sections use explicit pixel heights. No flex-grow special cases.
const CollapsibleSection = React.memo(function CollapsibleSection({
  label, open, onToggle, bodyHeight, onResizeStart, showResizeHandle, controls, loading, children, isOnlyOpen,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  bodyHeight: number;
  onResizeStart: (e: React.MouseEvent) => void;
  showResizeHandle?: boolean;
  controls?: React.ReactNode;
  loading?: boolean;
  children?: React.ReactNode;
  isOnlyOpen?: boolean;
}) {
  const outerH = open
    ? HEADER_H + bodyHeight + (showResizeHandle ? RH : 0)
    : HEADER_H;
  return (
    <div
      className={`flex flex-col group/section relative ${isOnlyOpen ? "" : "shrink-0"}`}
      style={isOnlyOpen ? {
        flex: "1 1 0%",
        borderTop: "1px solid rgba(255,255,255,0.05)",
        overflow: "hidden",
      } : {
        height: outerH,
        borderTop: "1px solid rgba(255,255,255,0.05)",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-1.5 px-3 cursor-pointer select-none shrink-0"
        style={{ height: HEADER_H, color: "rgba(232,234,240,0.35)" }}
        onClick={onToggle}
        onMouseEnter={(e) => (e.currentTarget.style.color = "rgba(232,234,240,0.65)")}
        onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(232,234,240,0.35)")}
      >
        <div className="flex items-center gap-1.5 flex-1 min-w-0 pointer-events-none">
          {open
            ? <ChevronDown size={11} className="shrink-0" />
            : <ChevronRight size={11} className="shrink-0" />
          }
          <span className="text-[11px] font-bold uppercase tracking-[0.08em] truncate">{label}</span>
        </div>
        {open && controls && (
          <div className="flex items-center gap-0.5 opacity-0 group-hover/section:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
            {controls}
          </div>
        )}
        {loading && <RefreshCw size={10} className="animate-spin shrink-0" style={{ color: "#4F8CFF" }} />}
      </div>

      {/* Content */}
      {open && (
        <div
          className={`min-h-0 overflow-x-hidden overflow-y-auto section-scroll ${isOnlyOpen ? "flex-1" : "shrink-0"}`}
          style={isOnlyOpen ? undefined : { height: bodyHeight }}
        >
          {children}
        </div>
      )}

      {/* Resize handle — shown only when open and there's a section below */}
      {open && showResizeHandle && (
        <div
          onMouseDown={onResizeStart}
          className="shrink-0 cursor-row-resize z-10 transition-colors"
          style={{ height: `${RH}px`, background: "transparent" }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(79,140,255,0.25)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        />
      )}
    </div>
  );
});

// ── Sidepanel layout hook (mirrors ide_side_panel_v2.html redistribution logic) ─
// All sections get explicit pixel body heights. Container height tracked via
// ResizeObserver. On toggle: redistribute equally. On drag: adjust adjacent pair.
function useSidepanelLayout(
  containerRef: React.RefObject<HTMLDivElement | null>,
  visibleSections: SideSection[]
) {
  const [open, setOpen] = useState<Record<SideSection, boolean>>(() => {
    const init = {} as Record<SideSection, boolean>;
    SECTIONS.forEach(s => { init[s] = s === 'folders'; });
    return init;
  });
  const [heights, setHeights] = useState<Record<string, number>>({ ...DEFAULT_HEIGHTS });
  const [containerH, setContainerH] = useState(0);
  const heightsRef = useRef(heights);
  heightsRef.current = heights;
  const openRef = useRef(open);
  openRef.current = open;

  // Track container height
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      setContainerH(entries[0].contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef]);

  const getAvail = useCallback((openState: Record<SideSection, boolean>) => {
    const openList = visibleSections.filter(s => openState[s]);
    if (openList.length === 0) return 0;
    // All visible sections have a HEADER_H header (open or closed). Only count
    // resize handles between pairs where the top section is open.
    const headerChrome = visibleSections.length * HEADER_H;
    let handleChrome = 0;
    for (let i = 0; i < visibleSections.length - 1; i++) {
      if (openState[visibleSections[i]]) {
        handleChrome += RH;
      }
    }
    return containerH - headerChrome - handleChrome;
  }, [containerH, visibleSections]);

  // Redistribute heights among open sections (proportional scaling, clamp to MIN)
  const redistribute = useCallback((
    openState: Record<SideSection, boolean>,
    curHeights: Record<string, number>
  ): Record<string, number> => {
    const list = visibleSections.filter(s => openState[s]);
    if (list.length === 0) return curHeights;
    const avail = getAvail(openState);
    if (avail <= 0) return curHeights;

    const next = { ...curHeights };
    list.forEach(s => { if (next[s] < MIN_SECTION_H) next[s] = MIN_SECTION_H; });

    let total = list.reduce((sum, s) => sum + next[s], 0);
    if (total !== avail && total > 0) {
      const scale = avail / total;
      let newTotal = 0;
      list.forEach((s, i) => {
        if (i === list.length - 1) {
          next[s] = Math.max(MIN_SECTION_H, avail - newTotal);
        } else {
          const v = Math.max(MIN_SECTION_H, Math.round(next[s] * scale));
          next[s] = v;
          newTotal += v;
        }
      });
    }
    return next;
  }, [visibleSections, getAvail]);

  // Redistribute heights whenever container height changes
  useEffect(() => {
    if (containerH > 100) {
      setHeights(h => {
        const next = redistribute(openRef.current, h);
        const changed = Object.keys(next).some(k => next[k] !== h[k]);
        return changed ? next : h;
      });
    }
  }, [containerH, redistribute]);

  // Sync visibility changes (view mode switch) — close new sections, redistribute
  const prevVisibleRef = useRef(visibleSections);
  useEffect(() => {
    const prev = prevVisibleRef.current;
    const added = visibleSections.filter(s => !prev.includes(s));
    const removed = prev.filter(s => !visibleSections.includes(s));
    prevVisibleRef.current = visibleSections;
    if (added.length > 0 || removed.length > 0) {
      setOpen(prevOpen => {
        const next = { ...prevOpen };
        added.forEach(s => { next[s] = false; });
        setHeights(h => redistribute(next, h));
        return next;
      });
    }
  }, [visibleSections, redistribute]);

  // Redistribute on open/close
  const toggle = useCallback((section: SideSection) => {
    setOpen(prev => {
      const next = { ...prev, [section]: !prev[section] };
      setHeights(h => redistribute(next, h));
      return next;
    });
  }, [redistribute]);

  // Drag resize between adjacent visible sections (one or both may be open)
  const dragRef = useRef<{
    section: SideSection;
    pair: SideSection;
    startY: number;
    startH: number;
    startPairH: number;
    bothOpen: boolean;
  } | null>(null);

  const startResize = useCallback((section: SideSection, e: React.MouseEvent) => {
    e.preventDefault();
    const idx = visibleSections.indexOf(section);
    if (idx < 0 || idx >= visibleSections.length - 1) return;
    if (!open[section]) return;
    const next = visibleSections[idx + 1];
    dragRef.current = {
      section,
      pair: next,
      startY: e.clientY,
      startH: heightsRef.current[section] ?? 200,
      startPairH: heightsRef.current[next] ?? 200,
      bothOpen: open[section] && open[next],
    };
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }, [visibleSections, open]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dy = e.clientY - d.startY;
      if (d.bothOpen) {
        let newTop = d.startH + dy;
        let newBot = d.startPairH - dy;
        if (newTop < MIN_SECTION_H) { newBot += newTop - MIN_SECTION_H; newTop = MIN_SECTION_H; }
        if (newBot < MIN_SECTION_H) { newTop += newBot - MIN_SECTION_H; newBot = MIN_SECTION_H; }
        setHeights(prev => ({
          ...prev,
          [d.section]: Math.round(Math.max(MIN_SECTION_H, newTop)),
          [d.pair]: Math.round(Math.max(MIN_SECTION_H, newBot)),
        }));
      } else {
        // Only the top section is open — adjust it, constrained to available
        const newH = Math.max(MIN_SECTION_H, d.startH + dy);
        setHeights(prev => ({ ...prev, [d.section]: Math.round(newH) }));
      }
    };
    const onUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  const getOpenList = useCallback(() => visibleSections.filter(s => open[s]), [visibleSections, open]);

  return { open, toggle, heights, startResize, getOpenList };
}

// ── Panel resize ──────────────────────────────────────────────────────────────
const MIN_WIDTH = 160;
const MAX_WIDTH = 520;
const DEFAULT_WIDTH = 220;

// ── SidePanel ─────────────────────────────────────────────────────────────────
export function SidePanel({ collapsed, cwd, activeFilePath, onKillTab, onAddTab, onOpenFileAtPath }: SidePanelProps) {
  const [showAddTabMenu, setShowAddTabMenu] = useState(false);
  const addTabBtnRef = useRef<HTMLDivElement>(null);
  const [selectedFile, setSelectedFile] = useState("");
  const [activePath, setActivePath] = useState("");
  const [activeNode, setActiveNode] = useState<FileNode | null>(null);
  const [selectedNodes, setSelectedNodes] = useState<Map<string, { path: string; name: string; is_dir: boolean }>>(new Map());
  const selectedPaths = useMemo(() => new Set(selectedNodes.keys()), [selectedNodes]);
  const [rootNodes, setRootNodes] = useState<FileNode[]>([]);
  const [workspaceName, setWorkspaceName] = useState("Workspace");
  const [resolvedCwd, setResolvedCwd] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);

  const isSidebarFocusedRef = useRef(false);

  useEffect(() => {
    const handleWindowClick = (e: MouseEvent) => {
      const aside = document.getElementById("main-sidebar");
      if (aside && aside.contains(e.target as Node)) {
        isSidebarFocusedRef.current = true;
      } else {
        isSidebarFocusedRef.current = false;
      }
    };
    window.addEventListener("click", handleWindowClick);
    return () => window.removeEventListener("click", handleWindowClick);
  }, []);

  // Inline create
  const [creatingIn, setCreatingIn] = useState<{ parentPath: string; type: "file" | "folder" } | null>(null);
  const [creatingName, setCreatingName] = useState("");
  const creatingInputRef = useRef<HTMLInputElement>(null);

  const [collapseAllKey, setCollapseAllKey] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [outlineRefreshKey, setOutlineRefreshKey] = useState(0);
  const [timelineRefreshKey, setTimelineRefreshKey] = useState(0);
  const [gitRefreshKey, setGitRefreshKey] = useState(0);

  // Context menu / rename / delete
  const [fileMenu, setFileMenu] = useState<FileMenuState | null>(null);
  const [renameState, setRenameState] = useState<RenameState | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmState | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Overwrite confirmation
  interface OverwriteState {
    srcPath: string; destPath: string; operation: "copy" | "cut"; fileName: string;
    drag?: boolean;
  }
  const [overwriteConfirm, setOverwriteConfirm] = useState<OverwriteState | null>(null);

  // Clipboard
  const clipboardRef = useRef<ClipboardState | null>(null);
  const [clipboardHasContent, setClipboardHasContent] = useState(false);

  // Drag & drop
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const [draggedNodePath, setDraggedNodePath] = useState<string | null>(null);
  const [expandPath, setExpandPath] = useState<string | null>(null);
  const [collapsePath, setCollapsePath] = useState<string | null>(null);
  const dragSourcePathRef = useRef<string | null>(null);
  const dragStartRef = useRef<{ x: number; y: number; node: FileNode } | null>(null);

  const sectionsRef = useRef<HTMLDivElement | null>(null);
  const treeRef = useRef<HTMLDivElement | null>(null);
  const loadSeqRef = useRef(0);
  const hasDataRef = useRef(false);
  const serializedRootRef = useRef("");

  // Search
  const searchIsOpen = useSearchStore((s) => s.isOpen);
  const searchToggle = useSearchStore((s) => s.toggle);

  // Stores
  const activeTab = useSessionStore((s) => s.tabs.find((t) => t.id === s.activeTabId));
  const activeFileTab = useSessionStore((s) => s.tabs.find((t) => (t.type === "file" || t.type === "diff") && t.filePath === activeFilePath));
  const activeFileContent = activeFileTab?.type === "file" ? activeFileTab.fileContent : undefined;
  const isTerminalView = activeTab?.type === "terminal";
  const sectionVisibility = useAppShellStore((s) => s.sectionVisibility);
  const projectDir = useAppShellStore((s) => s.projectDir || s.cwdAbsolute);

  // Section layout (collapsible + resize)
  const visibleSections = SECTIONS.filter(s => {
    if (!sectionVisibility[s]) return false;
    if (isTerminalView && (s === 'outline' || s === 'timeline')) return false;
    return true;
  });
  const { open: sectionsOpen, toggle: toggleSection, heights: sectionHeights, startResize, getOpenList } =
    useSidepanelLayout(sectionsRef, visibleSections);

  // Sync active file path
  useEffect(() => {
    if (activeFilePath) { setSelectedFile(activeFilePath); setActivePath(activeFilePath); }
    else { setSelectedFile(""); setActivePath(""); }
  }, [activeFilePath]);

  // Scroll active file into view (poll until rendered after async directory loads)
  useEffect(() => {
    if (!activePath) return;
    let count = 0;
    const maxAttempts = 50;
    let timer: ReturnType<typeof setTimeout>;
    const tryScroll = () => {
      const el = treeRef.current?.querySelector<HTMLElement>('[data-active-file="true"]');
      if (el) {
        el.scrollIntoView({ block: "nearest", behavior: "smooth" });
        return;
      }
      if (count++ < maxAttempts) {
        timer = setTimeout(tryScroll, 100);
      }
    };
    timer = setTimeout(tryScroll, 100);
    return () => clearTimeout(timer);
  }, [activePath]);

  // Close menus on outside events
  useEffect(() => {
    if (!fileMenu) return;
    const handler = () => setFileMenu(null);
    window.addEventListener("click", handler);
    window.addEventListener("contextmenu", handler);
    return () => { window.removeEventListener("click", handler); window.removeEventListener("contextmenu", handler); };
  }, [fileMenu]);

  useEffect(() => {
    const handler = () => { setFileMenu(null); setDeleteConfirm(null); setDeleteError(null); };
    window.addEventListener("aurora-right-click-menu-close", handler);
    const unsub = onClosePopups(handler);
    return () => { window.removeEventListener("aurora-right-click-menu-close", handler); unsub(); };
  }, []);

  // Auto-refresh GitTree when git refs change on disk
  useEffect(() => {
    const unlisten = listen<{ cwd: string; type: string }>("git-changed", (event) => {
      if (event.payload.type === "refs" || event.payload.type === "remote") {
        if (event.payload.cwd === projectDir) {
          setGitRefreshKey((k) => k + 1);
        }
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [projectDir]);

  // Load tree
  const loadTree = useCallback(async (absolutePath: string) => {
    const seq = ++loadSeqRef.current;
    if (!hasDataRef.current) setIsLoading(true);
    setError(null);
    setActivePath(""); setSelectedFile("");
    try {
      const parts = absolutePath.split(/[/\\]/);
      setWorkspaceName(parts[parts.length - 1] || absolutePath);
      const res = await system.readDir(absolutePath);
      if (seq !== loadSeqRef.current) return;
      const sorted = sortNodes(res);
      serializedRootRef.current = JSON.stringify(sorted);
      hasDataRef.current = true;
      setRootNodes(sorted);
    } catch (err) {
      if (seq !== loadSeqRef.current) return;
      setError(String(err) || "Failed to load workspace files.");
    } finally {
      if (seq === loadSeqRef.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (cwd) { setResolvedCwd(cwd); loadTree(cwd); }
  }, [cwd, loadTree]);

  useEffect(() => {
    if (!resolvedCwd) return;
    system.watchDirectory(resolvedCwd).catch(() => { });
  }, [resolvedCwd]);

  useEffect(() => {
    if (collapsed || !resolvedCwd) return;
    let unlisten: (() => void) | null = null;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    listen<void>("fs-tree-changed", async () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        try {
          const res = await system.readDir(resolvedCwd);
          const sorted = sortNodes(res);
          const serialized = JSON.stringify(sorted);
          if (serialized !== serializedRootRef.current) { serializedRootRef.current = serialized; setRootNodes(sorted); }
          // Refresh any expanded subfolders too, so deletions/creations deeper in
          // the tree are reflected live (not just the root level).
          setRefreshKey((k) => k + 1);
        } catch { /* silent */ }
      }, 300);
    }).then((fn) => { unlisten = fn; });
    return () => { if (unlisten) unlisten(); if (debounceTimer) clearTimeout(debounceTimer); };
  }, [collapsed, resolvedCwd]);

  // Panel drag-to-resize
  const panelDragging = useRef(false);
  const panelDragStart = useRef({ x: 0, w: DEFAULT_WIDTH });

  const onDragHandleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    panelDragging.current = true;
    panelDragStart.current = { x: e.clientX, w: width };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!panelDragging.current) return;
      const delta = e.clientX - panelDragStart.current.x;
      setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, panelDragStart.current.w + delta)));
    };
    const onUp = () => {
      if (!panelDragging.current) return;
      panelDragging.current = false;
      document.body.style.cursor = ""; document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

  // Context menu helpers
  const handleFileContextMenu = useCallback((e: React.MouseEvent, node: FileNode) => {
    isSidebarFocusedRef.current = true;
    closeAllPopups();
    setSelectedNodes((prev) => {
      if (prev.has(node.path)) {
        return prev;
      }
      const next = new Map();
      next.set(node.path, { path: node.path, name: node.name, is_dir: node.is_dir });
      return next;
    });
    setActivePath(node.path);
    setActiveNode(node);
    setFileMenu({ x: e.clientX, y: e.clientY, node });
  }, []);

  const handleSelectNode = useCallback((node: FileNode, e: React.MouseEvent) => {
    isSidebarFocusedRef.current = true;
    setSelectedNodes((prev) => {
      const next = new Map(prev);
      if (e.ctrlKey || e.metaKey) {
        if (next.has(node.path)) {
          next.delete(node.path);
        } else {
          next.set(node.path, { path: node.path, name: node.name, is_dir: node.is_dir });
        }
        setActivePath(node.path);
        setActiveNode(node);
      } else if (e.shiftKey && activePath) {
        const rows = Array.from(document.querySelectorAll("#main-sidebar [data-path]")) as HTMLElement[];
        const idxA = rows.findIndex(r => r.dataset.path === activePath);
        const idxB = rows.findIndex(r => r.dataset.path === node.path);
        if (idxA !== -1 && idxB !== -1) {
          const start = Math.min(idxA, idxB);
          const end = Math.max(idxA, idxB);
          next.clear();
          for (let i = start; i <= end; i++) {
            const r = rows[i];
            const p = r.dataset.path!;
            const name = r.title || p.split(/[/\\]/).pop() || "";
            const isDir = r.dataset.isDir === "true";
            next.set(p, { path: p, name, is_dir: isDir });
          }
        }
      } else {
        next.clear();
        next.set(node.path, { path: node.path, name: node.name, is_dir: node.is_dir });
        setActivePath(node.path);
        setActiveNode(node);
      }
      return next;
    });
  }, [activePath]);

  // Helper: find tree node data-path under cursor
  const findNodePathAtPoint = useCallback((x: number, y: number): string | null => {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const nodeEl = el.closest("[data-path]");
    return nodeEl?.getAttribute("data-path") ?? null;
  }, []);

  // Custom Mouse-based Drag & Drop handlers
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastHoverPathRef = useRef<string | null>(null);
  const hoverExpandedPathsRef = useRef<Set<string>>(new Set());

  const cleanupDragState = useCallback(() => {
    setDragOverPath(null);
    setDraggedNodePath(null);
    dragSourcePathRef.current = null;
    lastHoverPathRef.current = null;
    if (hoverTimerRef.current) { clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null; }
    for (const p of hoverExpandedPathsRef.current) {
      setCollapsePath(p);
    }
    hoverExpandedPathsRef.current.clear();
    setExpandPath(null);
  }, []);

  const handleDragOverFolder = useCallback((path: string) => {
    setDragOverPath(path);
    if (path !== lastHoverPathRef.current) {
      lastHoverPathRef.current = path;
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = setTimeout(() => {
        setExpandPath(path);
        hoverExpandedPathsRef.current.add(path);
        hoverTimerRef.current = null;
      }, 600);
    }
  }, []);

  const handleDragLeaveFolder = useCallback((path: string) => {
    setDragOverPath((prev) => (prev === path ? null : prev));
    if (lastHoverPathRef.current === path) {
      lastHoverPathRef.current = null;
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }
    }
  }, []);

  const handleDragOverFile = useCallback((filePath: string) => {
    setDragOverPath(filePath);
  }, []);

  const handleDragLeaveFile = useCallback((filePath: string) => {
    setDragOverPath((prev) => (prev === filePath ? null : prev));
  }, []);

  const handleStartMouseDrag = useCallback((e: React.MouseEvent, node: FileNode) => {
    // Record start position and node
    dragStartRef.current = { x: e.clientX, y: e.clientY, node };

    const handleWindowMouseMove = (moveEvent: MouseEvent) => {
      if (!dragStartRef.current) return;
      const { x, y, node: draggedNode } = dragStartRef.current;
      
      const dx = moveEvent.clientX - x;
      const dy = moveEvent.clientY - y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance > 5) {
        // Start drag!
        if (!dragSourcePathRef.current) {
          dragSourcePathRef.current = draggedNode.path;
          setDraggedNodePath(draggedNode.path);
        }

        // Highlight target element under cursor
        const clientX = moveEvent.clientX;
        const clientY = moveEvent.clientY;
        const targetPath = findNodePathAtPoint(clientX, clientY);
        const el = document.elementFromPoint(clientX, clientY);

        if (el?.closest("#aurora-tab-bar") || el?.closest(".safari-tab")) {
          setDragOverPath("tabbar");
        } else if (targetPath) {
          const nodeEl = el?.closest("[data-path]");
          const isDir = nodeEl?.getAttribute("data-is-dir") === "true";
          
          // Guard circular move: cannot drag folder into itself or its subfolder
          if (draggedNode.is_dir && (pathsEqual(targetPath, draggedNode.path) || pathStartsWith(targetPath, draggedNode.path))) {
            setDragOverPath(null);
            document.body.style.cursor = "no-drop";
          } else {
            setDragOverPath(targetPath);
            document.body.style.cursor = "grabbing";
          }
        } else {
          // If over empty space of tree container
          const treeContainer = treeRef.current;
          if (treeContainer && treeContainer.getBoundingClientRect().top <= clientY && treeContainer.getBoundingClientRect().bottom >= clientY && treeContainer.getBoundingClientRect().left <= clientX && treeContainer.getBoundingClientRect().right >= clientX) {
            setDragOverPath(resolvedCwd);
            document.body.style.cursor = "grabbing";
          } else {
            setDragOverPath(null);
            document.body.style.cursor = "default";
          }
        }
      }
    };

    const handleWindowMouseUp = async (upEvent: MouseEvent) => {
      window.removeEventListener("mousemove", handleWindowMouseMove);
      window.removeEventListener("mouseup", handleWindowMouseUp);
      document.body.style.cursor = "";

      if (dragSourcePathRef.current) {
        const srcPath = dragSourcePathRef.current;
        const clientX = upEvent.clientX;
        const clientY = upEvent.clientY;
        const targetPath = findNodePathAtPoint(clientX, clientY);
        const el = document.elementFromPoint(clientX, clientY);
        
        // Reset drag states
        cleanupDragState();

        if (el?.closest("#aurora-tab-bar") || el?.closest(".safari-tab")) {
          // Open tab
          onOpenFileAtPathRef.current?.(srcPath);
        } else if (targetPath) {
          const nodeEl = el?.closest("[data-path]");
          const isDir = nodeEl?.getAttribute("data-is-dir") === "true";
          const targetDir = isDir ? targetPath : targetPath.replace(/[/\\][^/\\]+$/, "");
          const srcDir = srcPath.replace(/[/\\][^/\\]+$/, "");

          if (pathsEqual(srcDir, targetDir)) {
            return;
          }

          if (srcPath !== targetDir && !pathStartsWith(targetDir, srcPath)) {
            try {
              const name = srcPath.split(/[/\\]/).pop() || "";
              const destPath = targetDir + (targetDir.endsWith("/") || targetDir.endsWith("\\") ? "" : "\\") + name;
              const exists = await system.pathExists(destPath);
              if (exists) {
                setOverwriteConfirm({ srcPath, destPath, operation: "cut", fileName: name, drag: true });
                return;
              }
              await system.movePath(srcPath, targetDir);
              if (resolvedCwd) loadTree(resolvedCwd);
            } catch (err) {
              console.error("Internal move failed:", err);
            }
          }
        } else {
          // Check drop on root container background
          const treeContainer = treeRef.current;
          if (treeContainer && treeContainer.getBoundingClientRect().top <= clientY && treeContainer.getBoundingClientRect().bottom >= clientY && treeContainer.getBoundingClientRect().left <= clientX && treeContainer.getBoundingClientRect().right >= clientX) {
            const srcDir = srcPath.replace(/[/\\][^/\\]+$/, "");
            if (pathsEqual(srcDir, resolvedCwd)) {
              return;
            }
            if (srcPath !== resolvedCwd && !pathStartsWith(resolvedCwd, srcPath)) {
              try {
                const name = srcPath.split(/[/\\]/).pop() || "";
                const destPath = resolvedCwd + (resolvedCwd.endsWith("/") || resolvedCwd.endsWith("\\") ? "" : "\\") + name;
                const exists = await system.pathExists(destPath);
                if (exists) {
                  setOverwriteConfirm({ srcPath, destPath, operation: "cut", fileName: name, drag: true });
                  return;
                }
                await system.movePath(srcPath, resolvedCwd);
                if (resolvedCwd) loadTree(resolvedCwd);
              } catch (err) {
                console.error("Internal root move failed:", err);
              }
            }
          }
        }
      }
      dragStartRef.current = null;
    };

    window.addEventListener("mousemove", handleWindowMouseMove);
    window.addEventListener("mouseup", handleWindowMouseUp);
  }, [resolvedCwd, loadTree, findNodePathAtPoint, cleanupDragState]);

  useEffect(() => {
    if (collapsed) return;
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (selectedNodes.size === 0) return;
      if (!isSidebarFocusedRef.current) return;

      const activeEl = document.activeElement;
      if (activeEl) {
        const tag = activeEl.tagName.toLowerCase();
        if (
          tag === "input" ||
          tag === "textarea" ||
          tag === "select" ||
          activeEl.hasAttribute("contenteditable") ||
          (activeEl as HTMLElement).isContentEditable
        ) {
          return;
        }
      }

      if (e.key === "Delete" || e.key === "Del") {
        e.preventDefault();
        if (e.shiftKey) {
          // Shift+Delete: immediate delete, no confirmation
          const nodes = Array.from(selectedNodes.values());
          (async () => {
            setIsDeleting(true);
            try {
              for (const n of nodes) {
                await system.deletePath(n.path);
              }
              setSelectedNodes(new Map());
              setActivePath("");
              setActiveNode(null);
              if (resolvedCwd) loadTree(resolvedCwd);
            } catch (err) {
              console.error(err);
            } finally {
              setIsDeleting(false);
            }
          })();
        } else {
          startDelete(Array.from(selectedNodes.values()));
        }
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => {
      window.removeEventListener("keydown", handleGlobalKeyDown);
    };
  }, [selectedNodes, collapsed]);

  const { handleCopy: copyToClipboard } = useCopyWithFeedback();
  const revealInExplorer = (path: string) => system.revealInExplorer(path).catch(console.error);
  const getTargetPath = (node: FileNode) => node.is_dir ? node.path : node.path.replace(/[/\\][^/\\]+$/, "");

  const handleOpenFolderInAurora = () => {
    if (!fileMenu?.node.is_dir) return;
    window.dispatchEvent(new CustomEvent("sidebar-open-in-terminal", { detail: { path: getTargetPath(fileMenu.node) } }));
    setFileMenu(null);
  };
  const handleOpenFolderInNewTab = () => {
    if (!fileMenu) return;
    window.dispatchEvent(new CustomEvent("sidebar-open-in-new-tab", { detail: { path: getTargetPath(fileMenu.node) } }));
    setFileMenu(null);
  };

  // Create actions
  const handleCreateFile = useCallback(() => { if (resolvedCwd) { setCreatingIn({ parentPath: resolvedCwd, type: "file" }); setCreatingName(""); } }, [resolvedCwd]);
  const handleCreateFolder = useCallback(() => { if (resolvedCwd) { setCreatingIn({ parentPath: resolvedCwd, type: "folder" }); setCreatingName(""); } }, [resolvedCwd]);
  const handleCreateFileInDir = useCallback(() => {
    if (fileMenu?.node.is_dir) { setFileMenu(null); setCreatingIn({ parentPath: fileMenu.node.path, type: "file" }); setCreatingName(""); }
  }, [fileMenu]);
  const handleCreateFolderInDir = useCallback(() => {
    if (fileMenu?.node.is_dir) { setFileMenu(null); setCreatingIn({ parentPath: fileMenu.node.path, type: "folder" }); setCreatingName(""); }
  }, [fileMenu]);

  const commitCreate = useCallback(async () => {
    if (!creatingIn) return;
    const name = creatingName.trim();
    if (!name) { setCreatingIn(null); return; }
    try {
      const segments = name.replace(/\\/g, "/").split("/");
      let current = creatingIn.parentPath;
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i]; if (!seg) continue;
        const isLast = i === segments.length - 1;
        await system.createPath(current, seg, isLast ? creatingIn.type === "folder" : true).catch(() => { });
        if (!isLast) current = current + "/" + seg;
      }
      const finalPath = (creatingIn.parentPath + "/" + name).replace(/\\/g, "/");
      setCreatingIn(null); setCreatingName("");
      setCollapseAllKey((k) => k + 1);
      if (resolvedCwd) loadTree(resolvedCwd);

      if (creatingIn.type === "file") {
        onOpenFileAtPath?.(finalPath);
      }
    } catch (err) { console.error(err); setCreatingIn(null); }
  }, [creatingIn, creatingName, resolvedCwd, loadTree, onOpenFileAtPath]);

  const cancelCreate = useCallback(() => { setCreatingIn(null); setCreatingName(""); }, []);
  useEffect(() => { if (creatingIn) creatingInputRef.current?.focus(); }, [creatingIn]);

  // Rename
  const startRename = (node: FileNode) => { setFileMenu(null); setRenameState({ path: node.path, currentName: node.name, value: node.name }); };
  const commitRename = async () => {
    if (!renameState) return;
    const newName = renameState.value.trim();
    if (!newName || newName === renameState.currentName) { setRenameState(null); return; }
    try { await system.renamePath(renameState.path, newName); setRenameState(null); if (resolvedCwd) loadTree(resolvedCwd); }
    catch (err) { console.error(err); setRenameState(null); }
  };

  // Delete
  const startDelete = (nodes: { path: string; name: string; is_dir: boolean }[]) => {
    closeAllPopups();
    setFileMenu(null);
    setDeleteError(null);
    setDeleteConfirm({ nodes });
  };
  const confirmDelete = async () => {
    if (!deleteConfirm) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      for (const n of deleteConfirm.nodes) {
        await system.deletePath(n.path);
      }
      setDeleteConfirm(null);
      setSelectedNodes(new Map());
      setActivePath("");
      setActiveNode(null);
      if (resolvedCwd) loadTree(resolvedCwd);
    } catch (err) {
      setDeleteError(String(err));
    } finally {
      setIsDeleting(false);
    }
  };

  // Clipboard
  const handleCopy = useCallback((node: FileNode) => { clipboardRef.current = { path: node.path, operation: "copy" }; setClipboardHasContent(true); setFileMenu(null); }, []);
  const handleCut = useCallback((node: FileNode) => { clipboardRef.current = { path: node.path, operation: "cut" }; setClipboardHasContent(true); setFileMenu(null); }, []);
  const handlePaste = useCallback(async () => {
    if (!clipboardRef.current || !resolvedCwd) return;
    setFileMenu(null);
    const { path: srcPath, operation } = clipboardRef.current;
    const name = srcPath.split(/[/\\]/).pop() || "";
    const destPath = resolvedCwd + (resolvedCwd.endsWith("/") || resolvedCwd.endsWith("\\") ? "" : "\\") + name;
    try {
      const exists = await system.pathExists(destPath);
      if (exists) {
        setOverwriteConfirm({ srcPath, destPath, operation, fileName: name });
        return;
      }
      if (operation === "cut") {
        await system.renamePath(srcPath, name);
      } else {
        await system.copyPath(srcPath, resolvedCwd);
      }
      clipboardRef.current = null; setClipboardHasContent(false);
      if (resolvedCwd) loadTree(resolvedCwd);
    } catch (err) { console.error(err); clipboardRef.current = null; setClipboardHasContent(false); }
  }, [resolvedCwd, loadTree]);

  const confirmOverwrite = useCallback(async () => {
    if (!overwriteConfirm || !resolvedCwd) return;
    const { srcPath, operation, destPath, drag } = overwriteConfirm;
    try {
      await system.deletePath(destPath);
      if (drag) {
        const targetDir = destPath.replace(/[/\\][^/\\]+$/, "");
        if (operation === "cut") {
          await system.movePath(srcPath, targetDir);
        } else {
          await system.copyPath(srcPath, targetDir);
        }
      } else if (operation === "cut") {
        const name = srcPath.split(/[/\\]/).pop() || "";
        await system.renamePath(srcPath, name);
      } else {
        await system.copyPath(srcPath, resolvedCwd);
      }
      clipboardRef.current = null; setClipboardHasContent(false);
      if (resolvedCwd) loadTree(resolvedCwd);
    } catch (err) { console.error(err); }
    setOverwriteConfirm(null);
  }, [overwriteConfirm, resolvedCwd, loadTree]);





  const dragOverPathRef = useRef<string | null>(null);
  useEffect(() => { dragOverPathRef.current = dragOverPath; }, [dragOverPath]);

  const resolvedCwdRef = useRef<string>("");
  useEffect(() => { resolvedCwdRef.current = resolvedCwd; }, [resolvedCwd]);

  const loadTreeRef = useRef<(path: string) => Promise<void>>(loadTree);
  useEffect(() => { loadTreeRef.current = loadTree; }, [loadTree]);

  const onOpenFileAtPathRef = useRef<((path: string, options?: { lineNumber?: number; matchStart?: number; matchEnd?: number }) => void) | undefined>(onOpenFileAtPath);
  useEffect(() => { onOpenFileAtPathRef.current = onOpenFileAtPath; }, [onOpenFileAtPath]);

  // Guard: when browser-native drop handles an internal move, skip appWindow.onDragDropEvent




  useEffect(() => {
    const appWindow = getCurrentWebviewWindow();
    let isCurrent = true;
    let unlisten: (() => void) | null = null;
    appWindow.onDragDropEvent((event) => {
      if (!isCurrent) return;
      const payload = event.payload;

      if (payload.type === "over") {
        // Track mouse position during drag to highlight the target tree node
        const dpr = window.devicePixelRatio || 1;
        const x = payload.position.x / dpr;
        const y = payload.position.y / dpr;

        const el = document.elementFromPoint(x, y);
        const isOverTabBar = el?.closest("#aurora-tab-bar") || el?.closest(".safari-tab");

        if (isOverTabBar) {
          setDragOverPath("tabbar");
          const tabbar = document.getElementById("aurora-tab-bar");
          if (tabbar) {
            tabbar.style.background = "rgba(79,140,255,0.08)";
            tabbar.style.border = "1px dashed rgba(79,140,255,0.3)";
          }
        } else {
          const tabbar = document.getElementById("aurora-tab-bar");
          if (tabbar) {
            tabbar.style.background = "";
            tabbar.style.border = "";
          }
          const nodePath = findNodePathAtPoint(x, y);
          if (nodePath) {
            // Determine if it's a dir or file by checking data-is-dir
            const nodeEl = el?.closest("[data-path]");
            const isDir = nodeEl?.getAttribute("data-is-dir") === "true";
            if (isDir) {
              handleDragOverFolder(nodePath);
            } else {
              handleDragOverFile(nodePath);
            }
          } else {
            // Over the tree container but not a specific node
            setDragOverPath(resolvedCwdRef.current);
          }
        }
      } else if (payload.type === "drop") {
        const dpr = window.devicePixelRatio || 1;
        const x = payload.position.x / dpr;
        const y = payload.position.y / dpr;
        const el = document.elementFromPoint(x, y);
        const isOverTabBar = el?.closest("#aurora-tab-bar") || el?.closest(".safari-tab");

        // Reset tabbar styling
        const tabbar = document.getElementById("aurora-tab-bar");
        if (tabbar) {
          tabbar.style.background = "";
          tabbar.style.border = "";
        }

        // Find the target node from the drop position
        const dropNodePath = findNodePathAtPoint(x, y);
        const currentResolvedCwd = resolvedCwdRef.current;

        if (isOverTabBar) {
          const paths = payload.paths;
          if (paths && paths.length > 0) {
            for (const p of paths) {
              onOpenFileAtPathRef.current?.(p);
            }
          }
        } else {
          let targetDir: string;
          if (dropNodePath) {
            const nodeEl = el?.closest("[data-path]");
            const isDir = nodeEl?.getAttribute("data-is-dir") === "true";
            targetDir = isDir ? dropNodePath : dropNodePath.replace(/[/\\][^/\\]+$/, "");
          } else {
            targetDir = currentResolvedCwd;
          }

          const paths = payload.paths;

          if (paths && paths.length > 0) {
            // External copy
            (async () => {
              try {
                for (const p of paths) {
                  const name = p.split(/[/\\]/).pop() || "";
                  const destPath = targetDir + (targetDir.endsWith("/") || targetDir.endsWith("\\") ? "" : "\\") + name;
                  if (pathsEqual(p, destPath)) {
                    continue; // Skip copying since it's the exact same file/location!
                  }
                  const exists = await system.pathExists(destPath);
                  if (exists) {
                    setOverwriteConfirm({ srcPath: p, destPath, operation: "copy", fileName: name, drag: true });
                    return;
                  }
                  await system.copyPath(p, targetDir);
                }
                if (currentResolvedCwd) loadTreeRef.current(currentResolvedCwd);
              } catch (err) {
                console.error("External copy failed:", err);
              }
            })();
          }
        }

        cleanupDragState();
      } else if (payload.type === "leave") {
        const tabbar = document.getElementById("aurora-tab-bar");
        if (tabbar) {
          tabbar.style.background = "";
          tabbar.style.border = "";
        }

        cleanupDragState();
      }
    }).then((fn) => {
      if (!isCurrent) {
        fn();
      } else {
        unlisten = fn;
      }
    });
    return () => {
      isCurrent = false;
      if (unlisten) unlisten();
    };
  }, []);

  const filteredNodes = sortNodes(
    rootNodes.filter((n) => !isExcluded(n.name))
  );

  const openSections = getOpenList();
  const lastOpenSection = openSections.length > 0 ? openSections[openSections.length - 1] : null;
  const sectionSeamOpen = useMemo(() => {
    const result: Record<string, boolean> = {};
    for (let i = 0; i < visibleSections.length - 1; i++) {
      const top = visibleSections[i];
      result[top] = sectionsOpen[top];
    }
    return result;
  }, [visibleSections, sectionsOpen]);

  const treeNodeProps = {
    selectedFile, activePath, selectedPaths,
    onClickNode: handleSelectNode, onContextMenu: handleFileContextMenu,
    renamingPath: renameState?.path ?? "", renameValue: renameState?.value ?? "",
    onRenameChange: (val: string) => setRenameState((p) => p ? { ...p, value: val } : null),
    onRenameCommit: commitRename, onRenameCancel: () => setRenameState(null),
    dragOverPath, draggedNodePath,
    onStartMouseDrag: handleStartMouseDrag,
    onDeleteNode: startDelete,
    expandPath, collapsePath,
    creatingParent: creatingIn?.parentPath ?? null, creatingType: creatingIn?.type ?? null,
    creatingName, onCreatingNameChange: setCreatingName,
    onCreatingCommit: commitCreate, onCreatingCancel: cancelCreate,
    collapseKey: collapseAllKey, refreshKey,
  };

  if (collapsed) return null;

  return (
    <aside
      id="main-sidebar"
      className="relative flex flex-col z-20"
      style={{
        width, minWidth: MIN_WIDTH, maxWidth: MAX_WIDTH, flexShrink: 0,
        background: "#0F131A",
        borderRight: "1px solid rgba(255,255,255,0.06)",
        // boxShadow: "4px 0 24px rgba(0,0,0,0.15)",
        overflow: "hidden",
        height: "100%",
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Explorer header */}
      <div className="flex items-center justify-between px-3 shrink-0 select-none"
        style={{ height: "34px" }}
      >
        <span className="text-[11px] font-bold tracking-[0.08em] uppercase" style={{ color: "rgba(255,255,255,0.35)" }}>
          Explorer
        </span>
        <div className="flex items-center gap-0.5">
          <SidebarIconBtn title="Search in Files" onClick={searchToggle} active={searchIsOpen}>
            <Search size={12} />
          </SidebarIconBtn>
          <SectionToggle />
        </div>
      </div>

      {/* Sections container — fills remaining height (tracked by ResizeObserver inside useSidepanelLayout) */}
      <div ref={sectionsRef} className="flex flex-col flex-1 min-h-0 overflow-hidden">

        {searchIsOpen ? (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                    <SearchInFiles onOpenFileAtPath={onOpenFileAtPath} cwd={resolvedCwd} />
          </div>
        ) : (
          <>{/* All sections hidden when search is open */}
        {sectionVisibility.folders && (
          <CollapsibleSection
            label={workspaceName}
            open={sectionsOpen.folders}
            onToggle={() => toggleSection("folders")}
            bodyHeight={sectionHeights.folders}
            showResizeHandle={!!sectionSeamOpen.folders}
            onResizeStart={(e) => startResize("folders", e)}
            loading={isLoading}
            isOnlyOpen={lastOpenSection === "folders"}
            controls={
              <>
                <SidebarIconBtn title="New File" onClick={handleCreateFile}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14,2 14,8 20,8" />
                    <line x1="12" y1="13" x2="12" y2="17" /><line x1="10" y1="15" x2="14" y2="15" />
                  </svg>
                </SidebarIconBtn>
                <SidebarIconBtn title="New Folder" onClick={handleCreateFolder}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    <line x1="12" y1="11" x2="12" y2="17" /><line x1="9" y1="14" x2="15" y2="14" />
                  </svg>
                </SidebarIconBtn>
                <SidebarIconBtn title="Refresh" onClick={() => { setRefreshKey((k) => k + 1); loadTree(resolvedCwd); }}>
                  <RefreshCw size={12} />
                </SidebarIconBtn>
                <SidebarIconBtn title="Collapse All" onClick={() => setCollapseAllKey((k) => k + 1)}>
                  <CopyMinus size={12} />
                </SidebarIconBtn>
              </>
            }
          >
            {error ? (
              <div className="text-[11px] px-3 py-3 whitespace-pre-wrap break-words leading-relaxed select-text" style={{ color: "#FF6B6B" }}>{error}</div>
            ) : (
              <>
                {filteredNodes.length === 0 && !isLoading && (
                  <div className="text-[11px] italic px-3 py-3" style={{ color: "rgba(232,234,240,0.2)" }}>No files</div>
                )}
                <div
                  ref={treeRef}
                   className={`min-h-[150px] transition-colors duration-150 ${dragOverPath === resolvedCwd ? "bg-[rgba(79,140,255,0.06)] border border-dashed border-primary/20 rounded-md" : ""}`}
                >
                  {filteredNodes.map((node) => (
                    <TreeNode key={node.path} node={node} depth={0} {...treeNodeProps} />
                  ))}
                </div>
                {creatingIn && creatingIn.parentPath === resolvedCwd && (
                  <div className="flex items-center gap-1.5" style={{ paddingLeft: "10px", paddingTop: "4px", paddingBottom: "4px", minHeight: "24px" }}>
                    <input
                      ref={creatingInputRef} autoFocus value={creatingName}
                      onChange={(e) => setCreatingName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); commitCreate(); }
                        if (e.key === "Escape") { e.preventDefault(); cancelCreate(); }
                      }}
                      onBlur={cancelCreate} onClick={(e) => e.stopPropagation()}
                      placeholder={creatingIn.type === "folder" ? "folder name" : "file name"}
                      className="flex-1 min-w-0 text-sm bg-surface-container-high border border-primary/40 rounded px-1 outline-none text-on-surface placeholder:text-outline/30 focus:border-primary/70 transition-colors"
                      style={{ lineHeight: "1.4", marginLeft: "2px" }}
                    />
                  </div>
                )}
              </>
            )}
          </CollapsibleSection>
        )}

        {/* OPEN TABS */}
        {sectionVisibility["open-tabs"] && (
          <CollapsibleSection
            label="Open Tabs"
            open={sectionsOpen["open-tabs"]}
            onToggle={() => toggleSection("open-tabs")}
            bodyHeight={sectionHeights["open-tabs"]}
            showResizeHandle={!!sectionSeamOpen["open-tabs"]}
            onResizeStart={(e) => startResize("open-tabs", e)}
            isOnlyOpen={lastOpenSection === "open-tabs"}
            controls={
              <div ref={addTabBtnRef} className="relative">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (e.shiftKey) {
                      setShowAddTabMenu(!showAddTabMenu);
                    } else {
                      onAddTab?.("terminal");
                    }
                  }}
                  className="w-6 h-6 flex items-center justify-center rounded-md transition-all cursor-pointer"
                  style={{ color: "rgba(232,234,240,0.35)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.color = "#E8EAF0"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "rgba(232,234,240,0.35)"; }}
                  title="New Tab (click: terminal, shift+click: options)"
                >
                  <Plus size={14} />
                </button>
                {showAddTabMenu && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setShowAddTabMenu(false)} />
                    <MenuView
                      variant="primary"
                      open={true}
                      onClose={() => setShowAddTabMenu(false)}
                      className="absolute left-0 top-[calc(100%+4px)] min-w-[132px] z-20"
                    >
                      <MenuViewItem icon={<Terminal size={12} />} onClick={() => { onAddTab?.("terminal"); setShowAddTabMenu(false); }}>
                        Terminal Tab
                      </MenuViewItem>
                      <MenuViewItem icon={<FileText size={12} />} onClick={() => { onAddTab?.("file"); setShowAddTabMenu(false); }}>
                        Workspace Tab
                      </MenuViewItem>
                    </MenuView>
                  </>
                )}
              </div>
            }
          >
            <div
              onDragOver={(e) => {
                e.preventDefault();
                if (e.dataTransfer) {
                  e.dataTransfer.dropEffect = "copy";
                }
                setDragOverPath("opentabs");
              }}
              onDragLeave={() => {
                setDragOverPath(prev => prev === "opentabs" ? null : prev);
              }}
              className={`transition-colors duration-150 rounded-md ${dragOverPath === "opentabs" ? "bg-[rgba(79,140,255,0.06)] border border-dashed border-primary/20" : ""}`}
            >
              <OpenTabs onKillTab={onKillTab} />
            </div>
          </CollapsibleSection>
        )}

        {/* OUTLINE */}
        {!isTerminalView && sectionVisibility.outline && (
          <CollapsibleSection
            label="Outline"
            open={sectionsOpen.outline}
            onToggle={() => toggleSection("outline")}
            bodyHeight={sectionHeights.outline}
            showResizeHandle={!!sectionSeamOpen.outline}
            onResizeStart={(e) => startResize("outline", e)}
            isOnlyOpen={lastOpenSection === "outline"}
            controls={
              <SidebarIconBtn title="Refresh" onClick={() => setOutlineRefreshKey((k) => k + 1)}>
                <RefreshCw size={12} />
              </SidebarIconBtn>
            }
          >
            <FileOutline key={outlineRefreshKey} filePath={activeFilePath} fileContent={activeFileContent} />
          </CollapsibleSection>
        )}

        {/* TIMELINE */}
        {!isTerminalView && sectionVisibility.timeline && (
          <CollapsibleSection
            label="Timeline"
            open={sectionsOpen.timeline}
            onToggle={() => toggleSection("timeline")}
            bodyHeight={sectionHeights.timeline}
            showResizeHandle={!!sectionSeamOpen.timeline}
            onResizeStart={(e) => startResize("timeline", e)}
            isOnlyOpen={lastOpenSection === "timeline"}
            controls={
              <SidebarIconBtn title="Refresh" onClick={() => setTimelineRefreshKey((k) => k + 1)}>
                <RefreshCw size={12} />
              </SidebarIconBtn>
            }
          >
            <FileTimeline key={timelineRefreshKey} filePath={activeFilePath} />
          </CollapsibleSection>
        )}

        {/* GIT */}
        {sectionVisibility.git && (
          <CollapsibleSection
            label="Git Graph"
            open={sectionsOpen.git}
            onToggle={() => toggleSection("git")}
            bodyHeight={sectionHeights.git}
            showResizeHandle={false}
            onResizeStart={(e) => e.preventDefault()}
            isOnlyOpen={lastOpenSection === "git"}
            controls={
              <SidebarIconBtn title="Refresh" onClick={() => setGitRefreshKey((k) => k + 1)}>
                <RefreshCw size={12} />
              </SidebarIconBtn>
            }
          >
            <GitTree key={gitRefreshKey} />
          </CollapsibleSection>
        )}
        </>)}
      </div>

      {/* Panel resize handle */}
      <div
        onMouseDown={onDragHandleMouseDown}
        className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize z-30"
        title="Drag to resize"
      >
        <div className="w-px h-full ml-auto transition-colors" style={{ background: "transparent" }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(79,140,255,0.35)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        />
      </div>

      {/* File Context Menu */}
      <MenuView variant="rightclick" open={!!fileMenu} onClose={() => setFileMenu(null)} anchorX={fileMenu?.x ?? 0} anchorY={fileMenu?.y ?? 0}>
        <div className="px-3 pt-1 pb-2 flex items-center gap-2 border-b border-outline-variant/10 mb-1">
          {fileMenu?.node.is_dir && <Folder size={12} className="text-primary/70 shrink-0" />}
          <span className="text-sm text-on-surface-variant/60 overflow-hidden text-ellipsis whitespace-nowrap">{fileMenu?.node.name}</span>
        </div>
        <MenuViewItem variant="rightclick" icon={<ClipboardCopy size={13} />} onClick={() => { if (!fileMenu) return; copyToClipboard(fileMenu.node.name); setFileMenu(null); }}>Copy Name</MenuViewItem>
        <MenuViewItem variant="rightclick" icon={<Copy size={13} />} onClick={() => { if (!fileMenu) return; copyToClipboard(fileMenu.node.path); setFileMenu(null); }}>Copy Path</MenuViewItem>
        <MenuViewItem variant="rightclick" icon={<Copy size={13} />} onClick={() => { if (fileMenu) handleCopy(fileMenu.node); }}>Copy</MenuViewItem>
        <MenuViewItem variant="rightclick" icon={<Scissors size={13} />} onClick={() => { if (fileMenu) handleCut(fileMenu.node); }}>Cut</MenuViewItem>
        {clipboardHasContent && <MenuViewItem variant="rightclick" icon={<ClipboardList size={13} />} onClick={handlePaste}>Paste</MenuViewItem>}
        <MenuViewSeparator />
        {fileMenu?.node.is_dir && (
          <>
            <MenuViewItem variant="rightclick" icon={<Plus size={13} />} onClick={handleCreateFileInDir}>New File</MenuViewItem>
            <MenuViewItem variant="rightclick" icon={<FolderOpen size={13} />} onClick={handleCreateFolderInDir}>New Folder</MenuViewItem>
            <MenuViewSeparator />
          </>
        )}
        <MenuViewItem variant="rightclick" icon={<ExternalLink size={13} />} onClick={() => { if (!fileMenu) return; revealInExplorer(fileMenu.node.path); setFileMenu(null); }}>Reveal in Explorer</MenuViewItem>
        <MenuViewItem variant="rightclick" icon={<CopyMinus size={13} />} onClick={() => { if (!fileMenu) return; copyToClipboard(fileMenu.node.path.replace(resolvedCwd, "").replace(/^[/\\]/, "")); setFileMenu(null); }}>Copy Relative Path</MenuViewItem>
        <MenuViewSeparator />
        {fileMenu?.node.is_dir && (
          <>
            <MenuViewItem variant="rightclick" icon={<Terminal size={13} />} onClick={handleOpenFolderInAurora}>Open in Integrated Terminal</MenuViewItem>
            <MenuViewItem variant="rightclick" icon={<ExternalLink size={13} />} onClick={handleOpenFolderInNewTab}>Open in New Tab</MenuViewItem>
          </>
        )}
        {fileMenu && !fileMenu.node.is_dir && (
          <>
            <MenuViewItem variant="rightclick" icon={<FolderOpen size={13} />} onClick={() => { window.dispatchEvent(new CustomEvent("sidebar-open-file", { detail: { path: fileMenu.node.path } })); setFileMenu(null); }}>Open</MenuViewItem>
            <MenuViewItem variant="rightclick" icon={<CopyMinus size={13} />} onClick={() => { setFileMenu(null); window.dispatchEvent(new CustomEvent("file-compare-with", { detail: { path: fileMenu.node.path } })); }}>Compare With...</MenuViewItem>
          </>
        )}
        <MenuViewSeparator />
        <MenuViewItem variant="rightclick" icon={<GitBranch size={13} />} onClick={() => { if (!fileMenu) return; setFileMenu(null); window.dispatchEvent(new CustomEvent("git-file-history", { detail: { path: fileMenu.node.path } })); }}>Git / Version Control</MenuViewItem>
        <MenuViewSeparator />
        <MenuViewItem variant="rightclick" icon={<Pencil size={13} />} onClick={() => { if (fileMenu) startRename(fileMenu.node); }}>Rename</MenuViewItem>
        <MenuViewItem variant="rightclick" icon={<Trash2 size={13} />} onClick={() => {
          if (selectedNodes.size > 0) {
            startDelete(Array.from(selectedNodes.values()));
          } else if (fileMenu) {
            startDelete([fileMenu.node]);
          }
        }} danger>Delete</MenuViewItem>
      </MenuView>

      {/* Delete confirmation modal */}
      <Modal
        open={!!deleteConfirm}
        onClose={() => { if (!isDeleting) setDeleteConfirm(null); }}
        onConfirm={() => { if (!isDeleting) confirmDelete(); }}
        title={`Delete ${deleteConfirm?.nodes.length === 1 ? (deleteConfirm.nodes[0].is_dir ? "folder" : "file") : `${deleteConfirm?.nodes.length ?? 0} items`}?`}
        width="380px"
        dismissible={false}
      >
        <p className="text-[12px] leading-relaxed" style={{ color: "rgba(232,234,240,0.55)" }}>
          Are you sure you want to permanently delete{" "}
          {deleteConfirm?.nodes.length === 1 ? (
            <span style={{ color: "#4F8CFF", fontWeight: 500 }}>{deleteConfirm.nodes[0].name}</span>
          ) : (
            <span>these <span style={{ color: "#4F8CFF", fontWeight: 500 }}>{deleteConfirm?.nodes.length ?? 0} items</span></span>
          )}?
          {deleteConfirm?.nodes.some(n => n.is_dir) && (
            <span style={{ color: "rgba(255,107,107,0.75)" }}> This will delete all contents inside the folders.</span>
          )}
        </p>
        {deleteError && <p className="text-[11px] mt-2" style={{ color: "#FF6B6B" }}>{deleteError}</p>}
        <div className="flex justify-end gap-2 mt-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setDeleteConfirm(null)}
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={confirmDelete}
            disabled={isDeleting}
          >
            {isDeleting ? "Deleting…" : "Delete"}
          </Button>
        </div>
      </Modal>

      {/* Overwrite confirmation modal */}
      <Modal
        open={!!overwriteConfirm}
        onClose={() => setOverwriteConfirm(null)}
        onConfirm={confirmOverwrite}
        title="Replace file?"
        width="380px"
        dismissible={false}
      >
        <p className="text-[12px] leading-relaxed" style={{ color: "rgba(232,234,240,0.55)" }}>
          <span style={{ color: "#4F8CFF", fontWeight: 500 }}>{overwriteConfirm?.fileName}</span>
          {" "}already exists in this location. Do you want to replace it?
        </p>
        <div className="flex justify-end gap-2 mt-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setOverwriteConfirm(null)}
          >
            Skip
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={confirmOverwrite}
          >
            Replace
          </Button>
        </div>
      </Modal>
    </aside>
  );
}

// ── FileIcon ──────────────────────────────────────────────────────────────────
const FILE_ICON_MAP: Record<string, { icon: typeof FileText; color: string }> = {
  ts: { icon: FileCode, color: "#3178C6" }, tsx: { icon: FileCode, color: "#3178C6" },
  js: { icon: FileCode, color: "#F7DF1E" }, jsx: { icon: FileCode, color: "#F7DF1E" },
  rs: { icon: FileCode, color: "#DEA584" }, py: { icon: FileCode, color: "#3572A5" },
  go: { icon: FileCode, color: "#00ADD8" }, json: { icon: FileJson, color: "#8BC34A" },
  css: { icon: FileCode, color: "#42A5F5" }, scss: { icon: FileCode, color: "#C6538C" },
  html: { icon: FileCode, color: "#E44D26" }, svg: { icon: FileImage, color: "#FFB300" },
  png: { icon: FileImage, color: "#29B6F6" }, jpg: { icon: FileImage, color: "#29B6F6" },
  jpeg: { icon: FileImage, color: "#29B6F6" }, gif: { icon: FileImage, color: "#29B6F6" },
  ico: { icon: FileImage, color: "#29B6F6" }, md: { icon: FileText, color: "#42A5F5" },
  toml: { icon: FileCode, color: "#9C27B0" }, yaml: { icon: FileCode, color: "#6B2FA0" },
  yml: { icon: FileCode, color: "#6B2FA0" }, lock: { icon: FileArchive, color: "#78909C" },
  csv: { icon: FileSpreadsheet, color: "#43A047" }, mp3: { icon: FileAudio, color: "#FF7043" },
  wav: { icon: FileAudio, color: "#FF7043" }, mp4: { icon: FileVideo, color: "#FF7043" },
  zip: { icon: FileArchive, color: "#78909C" }, gz: { icon: FileArchive, color: "#78909C" },
  sql: { icon: FileCode, color: "#E91E63" }, sh: { icon: FileCode, color: "#4CAF50" },
  ps1: { icon: FileCode, color: "#012456" },
};

function FileIcon({ fileName, isActive, isGitignored = false }: { fileName: string; isActive: boolean; isGitignored?: boolean }) {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  const match = FILE_ICON_MAP[ext];
  const IconComponent = match?.icon ?? FileText;
  return (
    <IconComponent size={12} className="shrink-0"
      style={{ color: isActive ? "#4F8CFF" : match?.color ?? "rgba(232,234,240,0.4)", opacity: isGitignored ? 0.4 : 1 }}
    />
  );
}
