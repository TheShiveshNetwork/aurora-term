import React, { useRef, useState, useCallback, useEffect } from "react";
import { Terminal, FileText, Plus, X, Copy, Pin, Edit3, XCircle, Trash2, ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { useSessionStore } from "../../stores/useSessionStore";
import { Tab } from "@aurora/types";
import { RightClickMenuPanel, RightClickMenuItem, RightClickMenuSeparator } from "./RightClickMenu";
import { invoke } from "@tauri-apps/api/core";

interface TabBarProps {
  viewMode: "terminal" | "file";
  onSetViewMode: (mode: "terminal" | "file") => void;
  onAddTab: (type: "terminal" | "file") => void;
  onKillTab: (id: string) => void;
  onDuplicateTab?: (tab: Tab) => void;
}

export function TabBar({ viewMode, onSetViewMode, onAddTab, onKillTab, onDuplicateTab }: TabBarProps) {
  const { tabs, activeTabId, setActiveTabId, reorderTabs, updateTab } = useSessionStore();
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const dragIdxRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const tabRectsRef = useRef<DOMRect[]>([]);

  const [contextTab, setContextTab] = useState<{ x: number; y: number; tab: Tab } | null>(null);

  // Hover visibility states
  const [isHovered, setIsHovered] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);

  // Scroll visibility states
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  // Custom rename modal states
  const [renameTabId, setRenameTabId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renameTabId !== null) {
      const t = setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);
      return () => clearTimeout(t);
    }
  }, [renameTabId]);

  const handleRenameSubmit = () => {
    if (renameTabId && renameValue.trim()) {
      updateTab(renameTabId, { name: renameValue.trim() });
    }
    setRenameTabId(null);
  };

  const expandedTabs = tabs.filter((t) => t.type === viewMode);
  const isScrollable = expandedTabs.length > 6;

  // Pinned tabs always sorted first
  const sortedTabs = [...tabs].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return 0;
  });

  // Check scroll positions
  const updateScrollState = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 1);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 1);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const t = setTimeout(updateScrollState, 50);
    el.addEventListener("scroll", updateScrollState);
    window.addEventListener("resize", updateScrollState);
    return () => {
      clearTimeout(t);
      el.removeEventListener("scroll", updateScrollState);
      window.removeEventListener("resize", updateScrollState);
    };
  }, [tabs, viewMode, updateScrollState]);

  // Horizontal mouse wheel scrolling
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      if (isScrollable) {
        if (e.deltaY !== 0) {
          e.preventDefault();
          el.scrollLeft += e.deltaY * 0.85;
        }
      }
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [isScrollable]);

  // Slide left / right buttons
  const slideLeft = () => {
    const el = containerRef.current;
    if (el) {
      el.scrollBy({ left: -220, behavior: "smooth" });
    }
  };

  const slideRight = () => {
    const el = containerRef.current;
    if (el) {
      el.scrollBy({ left: 220, behavior: "smooth" });
    }
  };

  useEffect(() => {
    const close = () => {
      setContextTab(null);
      setShowAddMenu(false);
    };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  // Smooth scroll and center active tab
  useEffect(() => {
    if (!activeTabId) return;
    const t = setTimeout(() => {
      const container = containerRef.current;
      if (!container) return;

      const activeEl = container.querySelector<HTMLElement>(`[data-tab-id="${activeTabId}"]`);
      if (!activeEl) return;

      const containerWidth = container.clientWidth;
      const activeLeft = activeEl.offsetLeft;
      const activeWidth = activeEl.clientWidth;

      const targetScrollLeft = activeLeft - (containerWidth / 2) + (activeWidth / 2);

      container.scrollTo({
        left: targetScrollLeft,
        behavior: "smooth",
      });
    }, 50);
    return () => clearTimeout(t);
  }, [activeTabId]);

  const getTabIndexFromX = useCallback((clientX: number): number | null => {
    const rects = tabRectsRef.current;
    if (rects.length === 0) return null;
    for (let i = 0; i < rects.length; i++) {
      if (clientX >= rects[i].left && clientX <= rects[i].right) {
        return i;
      }
    }
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < rects.length; i++) {
      const cx = rects[i].left + rects[i].width / 2;
      const d = Math.abs(clientX - cx);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    return best;
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent, index: number) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("button")) return;

    // Pinned tabs are locked in place
    const tab = sortedTabs[index];
    if (tab?.pinned) return;

    const container = containerRef.current;
    if (!container) return;

    dragIdxRef.current = index;
    setDragIdx(index);

    const elements = container.querySelectorAll<HTMLElement>("[data-tab-id]");
    tabRectsRef.current = Array.from(elements).map(el => el.getBoundingClientRect());

    const onMouseMove = (ev: MouseEvent) => {
      const idx = getTabIndexFromX(ev.clientX);
      setOverIdx(idx);

      const containerRect = container.getBoundingClientRect();
      const edgeThreshold = 40;
      if (ev.clientX < containerRect.left + edgeThreshold) {
        container.scrollLeft -= 8;
      } else if (ev.clientX > containerRect.right - edgeThreshold) {
        container.scrollLeft += 8;
      }
    };

    const onMouseUp = (ev: MouseEvent) => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);

      const fromIdx = dragIdxRef.current;
      const toIdx = getTabIndexFromX(ev.clientX);

      if (fromIdx !== null && toIdx !== null && fromIdx !== toIdx) {
        const fromTab = sortedTabs[fromIdx];
        const toTab = sortedTabs[toIdx];

        if (fromTab && toTab && !fromTab.pinned && !toTab.pinned) {
          const originalFrom = tabs.findIndex(t => t.id === fromTab.id);
          const originalTo = tabs.findIndex(t => t.id === toTab.id);

          if (originalFrom !== -1 && originalTo !== -1) {
            reorderTabs(originalFrom, originalTo);
          }
        }
      }
      dragIdxRef.current = null;
      setDragIdx(null);
      setOverIdx(null);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, [getTabIndexFromX, reorderTabs, sortedTabs, tabs]);

  return (
    <div className="flex items-center w-full h-12 px-3 bg-background border-b border-outline-variant/5 gap-2">
      {isScrollable && canScrollLeft && (
        <button
          onClick={slideLeft}
          className="shrink-0 w-7 h-8 flex items-center justify-center rounded hover:bg-surface-variant/30 text-outline/50 hover:text-primary transition-all cursor-pointer animate-in fade-in duration-200"
          title="Scroll Left"
        >
          <ChevronLeft size={16} />
        </button>
      )}

      <div
        ref={containerRef}
        id="aurora-tab-bar"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className={`flex items-start h-full pt-[5px] flex-1 gap-1 overflow-x-auto overflow-y-hidden min-w-0 relative ${isScrollable
          ? `has-tabs-scrollbar ${isHovered ? "tabs-scroll-hovered" : ""}`
          : "no-scrollbar"
          }`}
      >
        {sortedTabs.map((tab, index) => {
          const isActive = tab.id === activeTabId;
          const isDragging = dragIdx === index;
          const isOver = overIdx === index && !isDragging;
          const isExpanded = tab.type === viewMode;
          const isPinned = tab.pinned;

          return (
            <div
              key={tab.id}
              data-tab-id={tab.id}
              onMouseDown={(e) => handleMouseDown(e, index)}
              onClick={() => {
                setActiveTabId(tab.id);
                if (tab.type !== viewMode) {
                  onSetViewMode(tab.type);
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setContextTab({ x: e.clientX, y: e.clientY, tab });
              }}
              className={`safari-tab select-none ${isActive ? "active" : ""} ${isOver ? "drag-over" : ""} ${isDragging ? "opacity-40" : ""} ${isExpanded && !isPinned ? "" : "!justify-center !p-0 !gap-0"
                }`}
              style={{
                flex: isExpanded && !isPinned ? (isScrollable ? "0 0 140px" : "1 1 0%") : "0 0 40px",
                height: "36px",
                padding: isPinned ? "0" : "0 12px",
                order: index,
                transform: isDragging ? "scale(0.95)" : "none",
                position: "relative",
              }}
              title={isPinned ? `${tab.name} (Pinned)` : tab.name}
            >
              {tab.type === "file" ? (
                <FileText size={14} className={`shrink-0 ${isActive ? "text-primary" : "text-outline/70"}`} />
              ) : (
                <Terminal size={14} className={`shrink-0 ${isActive ? "text-outline" : "text-outline/70"}`} />
              )}

              {isPinned ? null : (
                <span
                  className={`truncate transition-all duration-200 ${isActive ? "text-on-surface" : ""} ${isExpanded ? "max-w-[160px] opacity-100" : "max-w-0 opacity-0 overflow-hidden"
                    }`}
                >
                  {tab.name}
                </span>
              )}

              {isPinned ? (
                <Pin size={8} className="absolute top-1 right-1 text-primary/70 animate-pulse" />
              ) : (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onKillTab(tab.id);
                  }}
                  className={`absolute right-1.5 shrink-0 transition-all duration-200 hover:bg-surface-variant/40 rounded p-0.5 text-on-surface-variant/40 hover:text-error ${isExpanded ? "opacity-100" : "opacity-0 pointer-events-none"
                    }`}
                >
                  <X size={14} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {isScrollable && canScrollRight && (
        <button
          onClick={slideRight}
          className="shrink-0 w-7 h-8 flex items-center justify-center rounded hover:bg-surface-variant/30 text-outline/50 hover:text-primary transition-all cursor-pointer animate-in fade-in duration-200"
          title="Scroll Right"
        >
          <ChevronRight size={16} />
        </button>
      )}

      <div className="relative shrink-0">
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (showAddMenu) {
              setShowAddMenu(false);
            } else if (e.shiftKey) {
              setShowAddMenu(true);
            } else {
              onAddTab("terminal");
            }
          }}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-variant/30 hover:scale-105 active:scale-95 text-on-surface hover:text-primary transition-all border border-outline-variant/10 cursor-pointer shadow-sm"
          title="New Tab Options"
        >
          <Plus size={16} className={`transition-transform duration-200 ${showAddMenu ? "rotate-45" : ""}`} />
        </button>

        {showAddMenu && (
          <div
            className="absolute right-0 top-[calc(100%+6px)] bg-surface-container-lowest border border-outline-variant/15 rounded-xl py-1.5 min-w-[125px] shadow-xl z-[100] animate-in fade-in slide-in-from-top-2 duration-150"
            style={{ pointerEvents: "auto" }}
          >
            <button
              onClick={() => {
                onAddTab("terminal");
                setShowAddMenu(false);
              }}
              className="w-full px-3 py-1.5 flex items-center gap-2 text-[10px] font-semibold text-on-surface-variant hover:bg-surface-variant/20 hover:text-primary transition-colors text-left cursor-pointer"
            >
              <Terminal size={12} className="text-primary/70 shrink-0" />
              <span>Terminal Tab</span>
            </button>

            <button
              onClick={() => {
                onAddTab("file");
                setShowAddMenu(false);
              }}
              className="w-full px-3 py-1.5 flex items-center gap-2 text-[10px] font-semibold text-on-surface-variant hover:bg-surface-variant/20 hover:text-secondary transition-colors text-left cursor-pointer"
            >
              <FileText size={12} className="text-secondary/70 shrink-0" />
              <span>Workspace Tab</span>
            </button>
          </div>
        )}
      </div>

      {contextTab && (
        <RightClickMenuPanel anchorX={contextTab.x} anchorY={contextTab.y} open={true}>
          {/* Header */}
          <div className="px-3 pt-1 pb-2 flex items-center gap-2 border-b border-outline-variant/10 mb-1 select-none">
            {contextTab.tab.type === "file" ? <FileText size={11} className="text-primary/70 shrink-0" /> : <Terminal size={11} className="text-outline/70 shrink-0" />}
            <span className="text-[11px] text-on-surface-variant/60 overflow-hidden text-ellipsis whitespace-nowrap">
              {contextTab.tab.name}
            </span>
          </div>

          {/* Toggle Pin */}
          <RightClickMenuItem
            icon={<Pin size={13} className={contextTab.tab.pinned ? "text-primary" : ""} />}
            onClick={() => {
              updateTab(contextTab.tab.id, { pinned: !contextTab.tab.pinned });
              setContextTab(null);
            }}
          >
            {contextTab.tab.pinned ? "Unpin Tab" : "Pin Tab"}
          </RightClickMenuItem>

          {/* Rename for terminals */}
          {contextTab.tab.type === "terminal" && (
            <RightClickMenuItem
              icon={<Edit3 size={13} />}
              onClick={() => {
                setRenameTabId(contextTab.tab.id);
                setRenameValue(contextTab.tab.name);
                setContextTab(null);
              }}
            >
              Rename Tab
            </RightClickMenuItem>
          )}

          <RightClickMenuSeparator />

          {/* Close current tab */}
          <RightClickMenuItem
            icon={<X size={13} />}
            onClick={() => {
              onKillTab(contextTab.tab.id);
              setContextTab(null);
            }}
          >
            Close Tab
          </RightClickMenuItem>

          {/* Close Others */}
          <RightClickMenuItem
            icon={<XCircle size={13} />}
            onClick={() => {
              const targetType = contextTab.tab.type;
              tabs.forEach((t) => {
                if (t.type === targetType && t.id !== contextTab.tab.id && !t.pinned) {
                  onKillTab(t.id);
                }
              });
              setContextTab(null);
            }}
          >
            Close Other {contextTab.tab.type === "file" ? "Files" : "Terminals"}
          </RightClickMenuItem>

          {/* Close All */}
          <RightClickMenuItem
            icon={<Trash2 size={13} />}
            onClick={() => {
              const targetType = contextTab.tab.type;
              tabs.forEach((t) => {
                if (t.type === targetType && !t.pinned) {
                  onKillTab(t.id);
                }
              });
              setContextTab(null);
            }}
          >
            Close All {contextTab.tab.type === "file" ? "Files" : "Terminals"}
          </RightClickMenuItem>

          <RightClickMenuSeparator />

          {/* Close Left / Right */}
          <RightClickMenuItem
            icon={<ArrowLeft size={13} />}
            onClick={() => {
              const targetType = contextTab.tab.type;
              const rightIdx = tabs.findIndex((t) => t.id === contextTab.tab.id);
              tabs.forEach((t, i) => {
                if (t.type === targetType && i < rightIdx && !t.pinned) {
                  onKillTab(t.id);
                }
              });
              setContextTab(null);
            }}
          >
            Close to Left
          </RightClickMenuItem>

          <RightClickMenuItem
            icon={<ArrowRight size={13} />}
            onClick={() => {
              const targetType = contextTab.tab.type;
              const rightIdx = tabs.findIndex((t) => t.id === contextTab.tab.id);
              tabs.forEach((t, i) => {
                if (t.type === targetType && i > rightIdx && !t.pinned) {
                  onKillTab(t.id);
                }
              });
              setContextTab(null);
            }}
          >
            Close to Right
          </RightClickMenuItem>

          {/* File specific options */}
          {contextTab.tab.type === "file" && contextTab.tab.filePath && (
            <>
              <RightClickMenuSeparator />
              <RightClickMenuItem
                icon={<Copy size={13} />}
                onClick={() => {
                  navigator.clipboard.writeText(contextTab.tab.filePath || "").catch(console.error);
                  setContextTab(null);
                }}
              >
                Copy Path
              </RightClickMenuItem>
              <RightClickMenuItem
                icon={<ExternalLink size={13} />}
                onClick={async () => {
                  try {
                    const cwd = await invoke<string>("get_cwd");
                    const rel = contextTab.tab.filePath
                      ? contextTab.tab.filePath.replace(cwd, "").replace(/^[/\\]/, "")
                      : "";
                    navigator.clipboard.writeText(rel).catch(console.error);
                  } catch (e) {
                    console.error("Failed to copy relative path:", e);
                  }
                  setContextTab(null);
                }}
              >
                Copy Relative Path
              </RightClickMenuItem>
            </>
          )}
        </RightClickMenuPanel>
      )}

      {renameTabId && (
        <div
          className="fixed inset-0 z-[500] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => setRenameTabId(null)}
        >
          <div
            className="bg-surface border border-outline-variant/30 rounded-2xl p-6 w-[360px] shadow-2xl flex flex-col gap-4 animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h3 className="text-sm font-bold text-on-surface font-headline-md">Rename Terminal Tab</h3>
              <p className="text-xs text-on-surface-variant/60 mt-1 leading-relaxed">
                Provide a descriptive name for this terminal session.
              </p>
            </div>
            
            <input
              ref={inputRef}
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleRenameSubmit();
                } else if (e.key === "Escape") {
                  setRenameTabId(null);
                }
              }}
              className="w-full bg-surface-container-lowest border border-outline-variant/30 rounded-xl px-3.5 py-2 text-sm text-on-surface outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all font-body-base"
              placeholder="e.g. Server Logs, Build Terminal"
            />

            <div className="flex justify-end gap-2 mt-2">
              <button
                className="px-4 py-2 rounded-xl text-xs font-semibold text-on-surface-variant hover:bg-surface-variant/20 hover:text-on-surface transition-colors cursor-pointer"
                onClick={() => setRenameTabId(null)}
              >
                Cancel
              </button>
              <button
                className="px-4 py-2 rounded-xl bg-primary text-on-primary text-xs font-semibold hover:opacity-90 active:scale-95 transition-all shadow-md shadow-primary/10 cursor-pointer"
                onClick={handleRenameSubmit}
              >
                Rename
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
