import React, { useRef, useState, useCallback, useEffect } from "react";
import { Terminal, FileText, Plus, X, Copy, Pin, Edit3, XCircle, Trash2, ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, ExternalLink, GitBranch, GitBranchPlus } from "lucide-react";
import { useOpenTabs, EDITOR_LIKE_TYPES } from "../../hooks/useOpenTabs";
import { Tab } from "@aurora/types";
import { MenuView, MenuViewItem, MenuViewSeparator } from "./MenuView";
import { Button } from "./Button";
import { closeAllPopups, onClosePopups } from "../../lib/popups";
import { system } from "../../lib/ipc";

interface TabBarProps {
  viewMode: "terminal" | "file";
  onSetViewMode: (mode: "terminal" | "file") => void;
  onAddTab: (type: "terminal" | "file") => void;
  onKillTab: (id: string) => void;
  onDuplicateTab?: (tab: Tab) => void;
}

export function TabBar({ viewMode, onSetViewMode, onAddTab, onKillTab, onDuplicateTab }: TabBarProps) {
  const { tabs: sortedTabs, rawTabs, activeTabId, setActiveTabId, reorderTabs, updateTab } = useOpenTabs();
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const [dropIndicator, setDropIndicator] = useState<{ left: number } | null>(null);
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

  const expandedTabs = viewMode === "file"
    ? rawTabs.filter((t) => EDITOR_LIKE_TYPES.includes(t.type))
    : rawTabs.filter((t) => t.type === "terminal");

  // ── Dynamic overflow detection ───────────────────────────────────
  const [isOverflowing, setIsOverflowing] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const measure = () => {
      // Wait for DOM to settle so initial render uses flex-grow
      requestAnimationFrame(() => {
        const overflow = el.scrollWidth > el.clientWidth + 1;
        setIsOverflowing(overflow);
      });
    };

    // Initial measurement after first paint
    measure();

    const ro = new ResizeObserver(() => {
      measure();
    });

    ro.observe(el);

    return () => {
      ro.disconnect();
    };
  }, [expandedTabs.length]);

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
  }, [rawTabs, viewMode, updateScrollState]);

  // Horizontal mouse wheel scrolling
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      if (isOverflowing) {
        if (e.deltaY !== 0) {
          e.preventDefault();
          el.scrollLeft += e.deltaY * 0.85;
        }
      }
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [isOverflowing]);

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
    const unsub = onClosePopups(() => {
      setContextTab(null);
      setShowAddMenu(false);
      setRenameTabId(null);
    });
    return () => {
      window.removeEventListener("click", close);
      unsub();
    };
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
    const containerRect = container.getBoundingClientRect();

    const onMouseMove = (ev: MouseEvent) => {
      const idx = getTabIndexFromX(ev.clientX);
      setOverIdx(idx);

      if (idx !== null) {
        const rects = tabRectsRef.current;
        const tabRect = rects[idx];
        const tabCenterX = tabRect.left + tabRect.width / 2;
        const side = ev.clientX < tabCenterX ? "left" : "right";
        const gapCenter = side === "left"
          ? tabRect.left - 2
          : tabRect.right + 2;
        const indicatorLeft = gapCenter - containerRect.left + container.scrollLeft;
        setDropIndicator({ left: indicatorLeft });
      } else {
        setDropIndicator(null);
      }

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
          const originalFrom = rawTabs.findIndex(t => t.id === fromTab.id);
          const originalTo = rawTabs.findIndex(t => t.id === toTab.id);

          if (originalFrom !== -1 && originalTo !== -1) {
            reorderTabs(originalFrom, originalTo);
          }
        }
      }
      dragIdxRef.current = null;
      setDragIdx(null);
      setOverIdx(null);
      setDropIndicator(null);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, [getTabIndexFromX, reorderTabs, sortedTabs, rawTabs]);

  return (
    <div
      className="flex items-center w-full h-12 px-3 gap-2"
      style={{
        background: "#0A0D14",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
      }}
    >
      {isOverflowing && canScrollLeft && (
        <button
          onClick={slideLeft}
          className="shrink-0 w-7 h-8 flex items-center justify-center rounded-[8px] transition-all cursor-pointer animate-in fade-in duration-200"
          style={{ color: "rgba(232,234,240,0.35)" }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; e.currentTarget.style.color = "#4F8CFF"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "rgba(232,234,240,0.35)"; }}
          title="Scroll Left"
        >
          <ChevronLeft size={15} />
        </button>
      )}

      <div
        ref={containerRef}
        id="aurora-tab-bar"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className={`flex items-start h-full pt-[5px] flex-1 gap-1 overflow-x-auto overflow-y-hidden min-w-0 relative ${isOverflowing
          ? `has-tabs-scrollbar`
          : ""
          }`}
      >
        {sortedTabs.map((tab, index) => {
          const isActive = tab.id === activeTabId;
          const isDragging = dragIdx === index;
          const isOver = overIdx === index && !isDragging;
          const isExpanded = viewMode === "file" ? EDITOR_LIKE_TYPES.includes(tab.type) : tab.type === "terminal";
          const isPinned = tab.pinned;

          return (
            <div
              key={tab.id}
              data-tab-id={tab.id}
              onMouseDown={(e) => handleMouseDown(e, index)}
              onClick={() => {
                setActiveTabId(tab.id);
                const mode = EDITOR_LIKE_TYPES.includes(tab.type) ? "file" : "terminal";
                if (mode !== viewMode) {
                  onSetViewMode(mode);
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                closeAllPopups();
                setContextTab({ x: e.clientX, y: e.clientY, tab });
              }}
              className={`safari-tab select-none group ${isActive ? "active" : ""} ${isOver ? "drag-over" : ""} ${isDragging ? "opacity-40" : ""} ${isExpanded ? "" : "!justify-center !p-0 !gap-0"
                }`}
              style={{
                flex: isExpanded ? "1 1 150px" : "0 0 40px",
                minWidth: isExpanded ? "150px" : undefined,
                height: "36px",
                padding: "0 12px",
                order: index,
                transform: isDragging ? "scale(0.95)" : "none",
                position: "relative",
              }}
              title={isPinned ? `${tab.name} (Pinned)` : tab.name}
            >
              {tab.type === "file" ? (
                <FileText size={14} className={`shrink-0`} />
              ) : tab.type === "terminal" ? (
                <Terminal size={14} className={`shrink-0`} />
              ) : tab.type === "diff" ? (
                <GitBranchPlus size={14} className="shrink-0" />
              ) : tab.type === "git" && (
                <GitBranch size={14} className="shrink-0" />
              )}
              <span
                className={`truncate transition-all duration-200 ${isActive ? "text-on-surface" : ""} ${isExpanded ? "max-w-[160px] opacity-100" : "max-w-0 opacity-0 overflow-hidden"
                  }`}
              >
                {tab.name}
              </span>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onKillTab(tab.id);
                }}
                className={`absolute right-1.5 shrink-0 transition-all duration-200 hover:bg-surface-variant/40 rounded p-0.5 text-on-surface-variant/40 hover:text-on-surface-variant ${isExpanded ? "opacity-100" : "opacity-0 pointer-events-none"
                  } flex items-center justify-center`}
                style={{ width: "20px", height: "20px" }}
              >
                {tab.dirty ? (
                  <>
                    <span className="w-2 h-2 rounded-full bg-[#4F8CFF] group-hover:hidden inline-block" />
                    <X size={14} className="hidden group-hover:block" />
                  </>
                ) : (
                  <X size={14} />
                )}
              </button>
            </div>
          );
        })}

        {/* Drop indicator square */}
        {dropIndicator && (
          <div
            className="absolute top-0 w-[3px] h-full rounded-[2px] pointer-events-none z-10"
            style={{
              left: dropIndicator.left - 1.5,
              background: "#4F8CFF",
              boxShadow: "0 0 8px rgba(79,140,255,0.5), 0 0 2px rgba(79,140,255,0.3)",
              animation: "tab-drop-pop-in 150ms ease-out forwards",
              transition: "left 80ms ease-out",
            }}
          />
        )}
      </div>

      {isOverflowing && canScrollRight && (
        <button
          onClick={slideRight}
          className="shrink-0 w-7 h-8 flex items-center justify-center rounded-[8px] transition-all cursor-pointer animate-in fade-in duration-200"
          style={{ color: "rgba(232,234,240,0.35)" }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; e.currentTarget.style.color = "#4F8CFF"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "rgba(232,234,240,0.35)"; }}
          title="Scroll Right"
        >
          <ChevronRight size={15} />
        </button>
      )}

      <div className="relative shrink-0">
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (showAddMenu) {
              setShowAddMenu(false);
            } else if (e.shiftKey) {
              closeAllPopups();
              setShowAddMenu(true);
            } else {
              onAddTab("terminal");
            }
          }}
          className="w-8 h-8 flex items-center justify-center rounded-[10px] transition-all cursor-pointer"
          style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.07)",
            color: "rgba(232,234,240,0.5)",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(79,140,255,0.10)"; e.currentTarget.style.color = "#4F8CFF"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; e.currentTarget.style.color = "rgba(232,234,240,0.5)"; }}
          title="New Tab Options"
        >
          <Plus size={15} className={`transition-transform duration-200 ${showAddMenu ? "rotate-45" : ""}`} />
        </button>

        <MenuView
          variant="primary"
          open={showAddMenu}
          onClose={() => setShowAddMenu(false)}
          className="absolute right-0 top-[calc(100%+6px)] min-w-[132px]"
          style={{ pointerEvents: "auto" }}
        >
          <MenuViewItem icon={<Terminal size={12} />} onClick={() => { onAddTab("terminal"); setShowAddMenu(false); }}>
            Terminal Tab
          </MenuViewItem>
          <MenuViewItem icon={<FileText size={12} />} onClick={() => { onAddTab("file"); setShowAddMenu(false); }}>
            Workspace Tab
          </MenuViewItem>
        </MenuView>
      </div>

      <MenuView
        variant="rightclick"
        open={!!contextTab}
        onClose={() => setContextTab(null)}
        anchorX={contextTab?.x ?? 0}
        anchorY={contextTab?.y ?? 0}
      >
        {/* Header */}
        <div className="px-3 pt-1 pb-2 flex items-center gap-2 mb-1 select-none" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          {contextTab?.tab.type === "file"
            ? <FileText size={11} style={{ color: "rgba(79,140,255,0.7)" }} className="shrink-0" />
            : contextTab?.tab.type === "terminal" && <Terminal size={11} style={{ color: "rgba(154,124,255,0.7)" }} className="shrink-0" />
          }
          <span className="text-[11px] overflow-hidden text-ellipsis whitespace-nowrap" style={{ color: "rgba(232,234,240,0.5)" }}>
            {contextTab?.tab.name}
          </span>
        </div>

        {/* Toggle Pin */}
        <MenuViewItem variant="rightclick" icon={<Pin size={13} />} onClick={() => {
          if (!contextTab) return;
          updateTab(contextTab.tab.id, { pinned: !contextTab.tab.pinned });
          setContextTab(null);
        }}>
          {contextTab?.tab.pinned ? "Unpin Tab" : "Pin Tab"}
        </MenuViewItem>

        {/* Rename for terminals */}
        {contextTab?.tab.type === "terminal" && (
          <MenuViewItem variant="rightclick" icon={<Edit3 size={13} />} onClick={() => {
            if (!contextTab) return;
            closeAllPopups();
            setRenameTabId(contextTab.tab.id);
            setRenameValue(contextTab.tab.name);
            setContextTab(null);
          }}>
            Rename Tab
          </MenuViewItem>
        )}

        <MenuViewSeparator />

        {/* Close current tab */}
        <MenuViewItem variant="rightclick" icon={<X size={13} />} onClick={() => {
          if (!contextTab) return;
          onKillTab(contextTab.tab.id);
          setContextTab(null);
        }}>
          Close Tab
        </MenuViewItem>

        {/* Close Others */}
        <MenuViewItem variant="rightclick" icon={<XCircle size={13} />} onClick={() => {
          if (!contextTab) return;
          const targetType = contextTab.tab.type;
          rawTabs.forEach((t) => {
            if (t.type === targetType && t.id !== contextTab.tab.id && !t.pinned) {
              onKillTab(t.id);
            }
          });
          setContextTab(null);
        }}>
          Close Other {contextTab?.tab.type === "file" ? "Files" : "Terminals"}
        </MenuViewItem>

        {/* Close All */}
        <MenuViewItem variant="rightclick" icon={<Trash2 size={13} />} onClick={() => {
          if (!contextTab) return;
          const targetType = contextTab.tab.type;
          rawTabs.forEach((t) => {
            if (t.type === targetType && !t.pinned) {
              onKillTab(t.id);
            }
          });
          setContextTab(null);
        }}>
          Close All {contextTab?.tab.type === "file" ? "Files" : "Terminals"}
        </MenuViewItem>

        <MenuViewSeparator />

        {/* Close Left / Right */}
        <MenuViewItem variant="rightclick" icon={<ArrowLeft size={13} />} onClick={() => {
          if (!contextTab) return;
          const targetType = contextTab.tab.type;
          const rightIdx = rawTabs.findIndex((t) => t.id === contextTab.tab.id);
          rawTabs.forEach((t, i) => {
            if (t.type === targetType && i < rightIdx && !t.pinned) {
              onKillTab(t.id);
            }
          });
          setContextTab(null);
        }}>
          Close to Left
        </MenuViewItem>

        <MenuViewItem variant="rightclick" icon={<ArrowRight size={13} />} onClick={() => {
          if (!contextTab) return;
          const targetType = contextTab.tab.type;
          const rightIdx = rawTabs.findIndex((t) => t.id === contextTab.tab.id);
          rawTabs.forEach((t, i) => {
            if (t.type === targetType && i > rightIdx && !t.pinned) {
              onKillTab(t.id);
            }
          });
          setContextTab(null);
        }}>
          Close to Right
        </MenuViewItem>

        {/* File specific options */}
        {contextTab?.tab.type === "file" && contextTab?.tab.filePath && (
          <>
            <MenuViewSeparator />
            <MenuViewItem variant="rightclick" icon={<Copy size={13} />} onClick={() => {
              navigator.clipboard.writeText(contextTab?.tab.filePath || "").catch(console.error);
              setContextTab(null);
            }}>
              Copy Path
            </MenuViewItem>
            <MenuViewItem variant="rightclick" icon={<ExternalLink size={13} />} onClick={async () => {
              if (!contextTab) return;
              try {
                const cwd = await system.getCwd();
                const rel = contextTab.tab.filePath
                  ? contextTab.tab.filePath.replace(cwd, "").replace(/^[/\\]/, "")
                  : "";
                navigator.clipboard.writeText(rel).catch(console.error);
              } catch (e) {
                console.error("Failed to copy relative path:", e);
              }
              setContextTab(null);
            }}>
              Copy Relative Path
            </MenuViewItem>
          </>
        )}
      </MenuView>

      {renameTabId && (
        <div
          className="fixed inset-0 z-[500] flex items-center justify-center backdrop-blur-sm animate-in fade-in duration-200"
          style={{ background: "rgba(0,0,0,0.6)" }}
          onClick={() => setRenameTabId(null)}
        >
          <div
            className="p-6 w-[360px] flex flex-col gap-4 animate-in zoom-in-95 duration-200"
            style={{
              background: "#0F131A",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: "18px",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03), 0 24px 64px rgba(0,0,0,0.6)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h3 className="text-[14px] font-semibold" style={{ color: "#E8EAF0" }}>Rename Terminal Tab</h3>
              <p className="text-[12px] mt-1 leading-relaxed" style={{ color: "rgba(232,234,240,0.45)" }}>
                Provide a descriptive name for this terminal session.
              </p>
            </div>

            <input
              ref={inputRef}
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRenameSubmit();
                else if (e.key === "Escape") setRenameTabId(null);
              }}
              className="w-full px-3.5 py-2.5 text-[13px] outline-none transition-all"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: "14px",
                color: "#E8EAF0",
                fontFamily: "Inter, sans-serif",
              }}
              onFocus={(e) => {
                e.currentTarget.style.border = "1px solid rgba(79,140,255,0.35)";
                e.currentTarget.style.boxShadow = "0 0 0 1px rgba(79,140,255,0.12)";
              }}
              onBlur={(e) => {
                e.currentTarget.style.border = "1px solid rgba(255,255,255,0.08)";
                e.currentTarget.style.boxShadow = "none";
              }}
              placeholder="e.g. Server Logs, Build Terminal"
            />

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setRenameTabId(null)}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleRenameSubmit}
              >
                Rename
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* â”€â”€ AddMenuButton helper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function AddMenuButton({
  children,
  icon,
  accentColor,
  onClick,
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
  accentColor?: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full px-3 py-1.5 flex items-center gap-2 text-[11px] font-semibold text-left cursor-pointer transition-colors"
      style={{ color: "rgba(232,234,240,0.6)" }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "rgba(255,255,255,0.04)";
        if (accentColor) e.currentTarget.style.color = accentColor;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = "rgba(232,234,240,0.6)";
      }}
    >
      {icon && (
        <span style={{ color: accentColor ?? "rgba(232,234,240,0.5)" }}>{icon}</span>
      )}
      <span>{children}</span>
    </button>
  );
}

