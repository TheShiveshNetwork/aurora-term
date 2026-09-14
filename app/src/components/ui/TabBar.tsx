import React, { useRef, useState, useCallback, useEffect } from "react";
import { flushSync } from "react-dom";
import { Terminal, FileText, Plus, X, Copy, Pin, Edit3, XCircle, Trash2, ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, ExternalLink, GitBranch, GitBranchPlus, GitMerge } from "lucide-react";
import { useOpenTabs, EDITOR_LIKE_TYPES } from "../../hooks/useOpenTabs";
import { useSessionStore } from "../../stores/useSessionStore";
import { Tab } from "@aurora/types";
import { MenuView, MenuViewItem, MenuViewSeparator } from "./MenuView";
import { Button } from "./Button";
import { StreamingText } from "./StreamingText";
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
  const { tabs: sortedTabs, rawTabs, activeTabId, setActiveTabId, updateTab } = useOpenTabs();
  const [dragId, setDragId] = useState<string | null>(null);
  const dragIdRef = useRef<string | null>(null);
  const startXRef = useRef(0);
  const startIdxRef = useRef(0);
  // Elements of every tab captured at drag start (stable — no re-renders
  // happen while dragging). Position changes are driven purely by CSS
  // transforms so the drag stays flicker-free and elastic.
  const elsRef = useRef<{ id: string; el: HTMLElement; index: number }[]>([]);
  // Current translateX (px) applied to each non-dragged tab while dragging.
  const shiftsRef = useRef<Map<string, number>>(new Map());
  const targetIdxRef = useRef(0);
  const gapRef = useRef(4);
  const dragDxRef = useRef(0);
  const draggedBaseLeftRef = useRef(0);
  const draggedWidthRef = useRef(0);
  const settleTimerRef = useRef<number | null>(null);
  const didDragRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Clear any pending drop-settle transition timer on unmount.
  useEffect(() => {
    return () => {
      if (settleTimerRef.current) window.clearTimeout(settleTimerRef.current);
    };
  }, []);

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
      updateTab(renameTabId, { name: renameValue.trim(), manuallyRenamed: true });
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

  // Smooth scroll active tab's right edge to the container's right edge
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

      const targetScrollLeft = activeLeft + activeWidth - containerWidth;

      container.scrollTo({
        left: Math.max(0, targetScrollLeft),
        behavior: "smooth",
      });
    }, 50);
    return () => clearTimeout(t);
  }, [activeTabId]);

  const handleMouseDown = useCallback((e: React.MouseEvent, index: number) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("button")) return;

    // Pinned tabs are locked in place
    const tab = sortedTabs[index];
    if (!tab || tab.pinned) return;

    const container = containerRef.current;
    if (!container) return;

    const tabId = tab.id;
    const els = Array.from(container.querySelectorAll<HTMLElement>("[data-tab-id]"))
      .map((el, i) => ({ id: el.dataset.tabId!, el, index: i }));
    if (els.length === 0) return;

    // Measure the inter-tab gap once (flex gap-1).
    let measuredGap = 4;
    if (els.length > 1) {
      const a = els[0].el.getBoundingClientRect();
      const b = els[1].el.getBoundingClientRect();
      measuredGap = b.left - (a.left + a.width);
      if (!Number.isFinite(measuredGap) || measuredGap < 0) measuredGap = 4;
    }

    dragIdRef.current = tabId;
    elsRef.current = els;
    gapRef.current = measuredGap;
    startXRef.current = e.clientX;
    startIdxRef.current = index;
    targetIdxRef.current = index;
    const draggedEl = els[index].el;
    const draggedRect = draggedEl.getBoundingClientRect();
    draggedBaseLeftRef.current = draggedRect.left;
    draggedWidthRef.current = draggedEl.offsetWidth;
    dragDxRef.current = 0;

    // Freeze transitions for the whole drag: shifts apply instantly so the
    // slot math is deterministic (no animating mid-states to flicker or feed
    // back), and the dragged tab tracks the cursor rock-solid. Elasticity is
    // reserved for the release settle, not the drag itself.
    if (settleTimerRef.current) {
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
    els.forEach(({ el }) => (el.style.transition = "none"));

    const applyDragTransform = (clientX: number) => {
      const el = container.querySelector<HTMLElement>(`[data-tab-id="${tabId}"]`);
      if (!el) return;
      const rect = el.getBoundingClientRect();
      // Remove our own current translate (the rect includes it) to get the
      // true base slot — otherwise the tab would lag/drift behind the cursor.
      const baseCenter = rect.left + rect.width / 2 - dragDxRef.current;
      const w = draggedWidthRef.current;
      // Clamp the dragged tab's center to the span actually occupied by the
      // tab row, so it can't be dragged into empty space toward a side that
      // has no other tabs (and boundary tabs can't escape their slot).
      let minBound = draggedBaseLeftRef.current + w / 2;
      let maxBound = minBound;
      for (const { id, el: other } of els) {
        if (id === tabId) continue;
        const r = other.getBoundingClientRect();
        const baseLeft = r.left - (shiftsRef.current.get(id) ?? 0);
        minBound = Math.min(minBound, baseLeft + w / 2);
        maxBound = Math.max(maxBound, baseLeft + r.width - w / 2);
      }
      const targetCenter = Math.max(minBound, Math.min(clientX, maxBound));
      const dx = targetCenter - baseCenter;
      dragDxRef.current = dx;
      el.style.transform = `translateX(${dx.toFixed(2)}px) scale(0.95)`;
      el.style.zIndex = "50";
      el.style.boxShadow = "0 8px 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06)";
      el.style.willChange = "transform";
    };

    // Reorder once the pointer crosses ~25% of the next tab's width — a light
    // drag already snaps the tab to the nearer side (left or right).
    const SENSITIVITY = 0.25;
    const containerRect = container.getBoundingClientRect();

    const onMouseMove = (ev: MouseEvent) => {
      // A plain click must never enter drag state: the lift styling and the
      // `dragId` render only begin once the pointer actually moves past the
      // slip threshold.
      if (!didDragRef.current) {
        if (Math.abs(ev.clientX - startXRef.current) <= 4) return;
        didDragRef.current = true;
        setDragId(tabId);
      }
      applyDragTransform(ev.clientX);

      // Transform-only drag: no React renders happen here, so nothing can
      // flicker. Slot targets are computed from BASE positions (current rect
      // minus the applied shift) so in-flight shifts can't feed back.
      const pinnedCount = sortedTabs.filter((t) => t.pinned).length;
      const startIdx = startIdxRef.current;
      let passed = 0;
      for (const { id, el, index } of els) {
        if (id === tabId) continue;
        const r = el.getBoundingClientRect();
        const shift = shiftsRef.current.get(id) ?? 0;
        const baseLeft = r.left - shift;
        if (baseLeft + r.width * SENSITIVITY < ev.clientX) passed++;
      }
      const target = Math.max(pinnedCount, Math.min(passed, els.length - 1));
      targetIdxRef.current = target;

      // Shift the tabs between the dragged tab and its target out of the way
      // by exactly one slot (width + gap). Each change animates through the
      // tab's CSS transition (0.18s), producing the elastic "make room" glide.
      const shifts = shiftsRef.current;
      for (const { id, el, index } of els) {
        if (id === tabId) continue;
        let shift = 0;
        if (target < startIdx && index >= target && index < startIdx) {
          shift = el.offsetWidth + gapRef.current;
        } else if (target > startIdx && index > startIdx && index <= target) {
          shift = -(el.offsetWidth + gapRef.current);
        }
        if (shifts.get(id) !== shift) {
          shifts.set(id, shift);
          el.style.transform = shift ? `translateX(${shift}px)` : "";
        }
      }

      // Auto-scroll while dragging, only toward a direction that actually has
      // more tabs to reveal (scrollLeft bounds) — never into empty space.
      const edgeThreshold = 40;
      if (ev.clientX < containerRect.left + edgeThreshold) {
        if (container.scrollLeft > 0) container.scrollLeft -= 8;
      } else if (ev.clientX > containerRect.right - edgeThreshold) {
        if (container.scrollLeft < container.scrollWidth - container.clientWidth - 1) {
          container.scrollLeft += 8;
        }
      }
    };

    const onMouseUp = (ev: MouseEvent) => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);

      // Snapshot where each tab is right now (transforms applied) so the
      // release can settle everything from the drop point to the final slots.
      const fromMap = new Map<string, DOMRect>();
      els.forEach(({ id, el }) => fromMap.set(id, el.getBoundingClientRect()));

      const finalIndex = Math.max(0, Math.min(targetIdxRef.current, els.length - 1));
      let finalTabs: Tab[] | null = null;
      if (finalIndex !== startIdxRef.current) {
        const pinned = sortedTabs.filter((t) => t.pinned);
        const free = sortedTabs.filter((t) => !t.pinned);
        const dragged = free.find((t) => t.id === tabId);
        const rest = free.filter((t) => t.id !== tabId);
        const k = finalIndex - pinned.length;
        if (dragged) {
          finalTabs = [...pinned, ...rest.slice(0, k), dragged, ...rest.slice(k)];
        }
      }

      dragIdRef.current = null;
      shiftsRef.current.clear();

      // Commit the new order and drop the drag class synchronously so the DOM
      // is in its final layout before we measure it for the settle animation.
      flushSync(() => {
        setDragId(null);
        if (finalTabs) useSessionStore.getState().setTabs(finalTabs);
      });

      // Clear leftover imperative styling.
      dragDxRef.current = 0;
      els.forEach(({ el }) => {
        el.style.transform = "";
        el.style.zIndex = "";
        el.style.boxShadow = "";
        el.style.willChange = "";
      });

      if (didDragRef.current) {
        // FLIP every tab from its pre-commit position to its final slot, so
        // the dragged tab elastically glides to wherever the drag pointed it
        // (left or right) and shifted tabs ease back into place.
        const toMap = new Map<string, DOMRect>();
        els.forEach(({ id, el }) => toMap.set(id, el.getBoundingClientRect()));
        els.forEach(({ id, el }) => {
          const f = fromMap.get(id);
          const t = toMap.get(id);
          if (!f || !t) return;
          const fc = f.left + f.width / 2;
          const tc = t.left + t.width / 2;
          const isDragged = id === tabId;
          el.style.transition = "none";
          el.style.transform = `translate(${(fc - tc).toFixed(2)}px, ${(f.top - t.top).toFixed(2)}px)${isDragged ? " scale(0.95)" : ""}`;
        });
        void container.offsetWidth; // force reflow so the inverse transforms register as the animation start
        els.forEach(({ el }) => {
          el.style.transition = "transform 0.28s cubic-bezier(0.34, 1.35, 0.64, 1)";
          el.style.transform = "";
        });
        settleTimerRef.current = window.setTimeout(() => {
          els.forEach(({ el }) => (el.style.transition = ""));
          settleTimerRef.current = null;
        }, 320);
      } else {
        // Plain click — just restore the stylesheet transitions.
        els.forEach(({ el }) => (el.style.transition = ""));
      }

      document.body.style.cursor = "";
      document.body.style.userSelect = "";

      // Swallow the synthetic click that follows a real drag so it can't
      // activate a tab or accidentally trigger the "add tab" button.
      if (didDragRef.current) {
        const suppressNextClick = (ce: MouseEvent) => {
          ce.preventDefault();
          ce.stopPropagation();
          window.removeEventListener("click", suppressNextClick, true);
        };
        window.addEventListener("click", suppressNextClick, true);
      }
      didDragRef.current = false;
      ev.preventDefault();
    };

    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, [sortedTabs]);

  return (
    <div
      className="flex items-center w-full h-13.5 px-3 gap-2"
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
          const isDragging = tab.id === dragId;
          const isExpanded = viewMode === "file" ? EDITOR_LIKE_TYPES.includes(tab.type) : tab.type === "terminal";
          const isPinned = tab.pinned;
          // Separator renders in between two adjacent tabs ONLY when both are
          // inactive — never before the first tab, after the last, or beside
          // the active tab. `order: index` keeps it glued to its tab so flex
          // ordering (tabs use `order: index`) can't bunch them together.
          const nextTab = sortedTabs[index + 1];
          const hasSeparator = !!nextTab && !isActive && nextTab.id !== activeTabId;

          return (
            <React.Fragment key={tab.id}>
            <div
              data-tab-id={tab.id}
              onMouseDown={(e) => handleMouseDown(e, index)}
              onClick={() => {
                if (didDragRef.current) {
                  didDragRef.current = false;
                  return;
                }
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
              className={`safari-tab select-none group ${isActive ? "active" : ""} ${isDragging ? "is-dragging" : ""} ${isExpanded ? "" : "!justify-center !p-0 !gap-0"
                }`}
              style={{
                flex: isExpanded ? "1 1 150px" : "0 0 40px",
                minWidth: isExpanded ? "150px" : undefined,
                height: "36px",
                padding: "0 12px",
                order: index,
                position: "relative",
                zIndex: isDragging ? 50 : undefined,
              }}
              title={isPinned ? `${tab.name} (Pinned)` : tab.name}
            >
              {tab.type === "file" ? (
                <FileText size={14} className={`shrink-0`} />
              ) : tab.type === "terminal" ? (
                <Terminal size={14} className={`shrink-0`} />
              ) : tab.type === "diff" ? (
                <GitBranchPlus size={14} className="shrink-0" />
              ) : tab.type === "merge" ? (
                <GitMerge size={14} className="shrink-0" />
              ) : tab.type === "git" && (
                <GitBranch size={14} className="shrink-0" />
              )}
              <StreamingText
                name={tab.name}
                streaming={!!tab.streaming}
                className={`truncate transition-all duration-200 ${isActive ? "pr-3 text-on-surface" : "pr-0"} ${isExpanded ? "max-w-[160px] opacity-100" : "max-w-0 !opacity-0 overflow-hidden"} ${tab.missing ? "line-through !opacity-50" : ""}`}
              />

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onKillTab(tab.id);
                }}
                className={`absolute right-1.5 shrink-0 transition-all duration-200 hover:bg-surface-variant/40 rounded p-0.5 text-on-surface-variant/40 hover:text-on-surface-variant ${isExpanded ? "" : "opacity-0 pointer-events-none"
                  } flex items-center justify-center`}
                style={{ width: "20px", height: "20px" }}
              >
                {tab.dirty ? (
                  <>
                    <span className="w-2 h-2 rounded-full bg-[#4F8CFF] group-hover:hidden inline-block" />
                    <X size={14} className="hidden group-hover:block" />
                  </>
                ) : (
                  <X size={14} className={`transition-opacity duration-200 ${isActive ? "" : "opacity-0 group-hover:opacity-100"}`} />
                )}
              </button>
            </div>
            {hasSeparator && (
              <div
                className="shrink-0 w-px"
                style={{
                  height: "25px",
                  marginTop: "5px",
                  background: "rgba(255,255,255,0.06)",
                  order: index,
                  opacity: dragId ? 0 : undefined,
                  transition: "opacity .18s ease",
                }}
              />
            )}
            </React.Fragment>
          );
        })}
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
        className="w-9 h-9 mt-1.5 self-start flex items-center justify-center rounded-[10px] transition-all cursor-pointer"
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
          const rightIdx = rawTabs.findIndex((t) => t.id === contextTab.tab.id);
          rawTabs.forEach((t, i) => {
            if (i < rightIdx && !t.pinned) {
              onKillTab(t.id);
            }
          });
          setContextTab(null);
        }}>
          Close to Left
        </MenuViewItem>

        <MenuViewItem variant="rightclick" icon={<ArrowRight size={13} />} onClick={() => {
          if (!contextTab) return;
          const rightIdx = rawTabs.findIndex((t) => t.id === contextTab.tab.id);
          rawTabs.forEach((t, i) => {
            if (i > rightIdx && !t.pinned) {
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

