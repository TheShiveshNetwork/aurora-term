import React, { useRef, useState, useCallback, useEffect } from "react";
import { Terminal, FileText, Plus, X, Copy } from "lucide-react";
import { useSessionStore } from "../../stores/useSessionStore";
import { Tab } from "../../types/session";
import { RightClickMenuPanel, RightClickMenuItem } from "./RightClickMenu";

interface TabBarProps {
  viewMode: "terminal" | "file";
  onSetViewMode: (mode: "terminal" | "file") => void;
  onAddTab: () => void;
  onKillTab: (id: string) => void;
  onDuplicateTab?: (tab: Tab) => void;
}

export function TabBar({ viewMode, onSetViewMode, onAddTab, onKillTab, onDuplicateTab }: TabBarProps) {
  const { tabs, activeTabId, setActiveTabId, reorderTabs } = useSessionStore();
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const dragIdxRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const tabRectsRef = useRef<DOMRect[]>([]);

  const [contextTab, setContextTab] = useState<{ x: number; y: number; tab: Tab } | null>(null);

  useEffect(() => {
    const close = () => setContextTab(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

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

    const container = containerRef.current;
    if (!container) return;

    dragIdxRef.current = index;
    setDragIdx(index);

    const tabs = container.querySelectorAll<HTMLElement>("[data-tab-id]");
    tabRectsRef.current = Array.from(tabs).map(el => el.getBoundingClientRect());

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
        reorderTabs(fromIdx, toIdx);
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
  }, [getTabIndexFromX, reorderTabs]);

  return (
    <div className="flex items-center w-full px-3 py-2 bg-background border-b border-outline-variant/5 gap-2">
      <div
        ref={containerRef}
        id="aurora-tab-bar"
        className="flex items-center flex-1 gap-1 overflow-x-auto no-scrollbar min-w-0"
      >
          {tabs.map((tab, index) => {
          const isActive = tab.id === activeTabId;
          const isDragging = dragIdx === index;
          const isOver = overIdx === index && !isDragging;
          const isExpanded = tab.type === viewMode;

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
              className={`safari-tab select-none ${isActive ? "active" : ""} ${isOver ? "drag-over" : ""} ${isDragging ? "opacity-40" : ""} ${isExpanded ? "" : "!justify-center !p-0 !gap-0"}`}
              style={{
                flex: isExpanded ? "1 1 0%" : "0 0 28px",
                height: isExpanded ? "32px" : "24px",
                padding: isExpanded ? "0 12px" : "0",
                order: index,
                transform: isDragging ? "scale(0.95)" : "none",
                position: "relative",
              }}
            >
              {tab.type === "file" ? (
                <FileText size={12} className={`shrink-0 ${isActive ? "text-primary" : "text-outline/70"}`} />
              ) : (
                <Terminal size={12} className={`shrink-0 ${isActive ? "text-outline" : "text-outline/70"}`} />
              )}
              <span
                className={`truncate transition-all duration-200 ${isActive ? "text-on-surface" : ""} ${
                  isExpanded ? "max-w-[160px] opacity-100" : "max-w-0 opacity-0 overflow-hidden"
                }`}
              >
                {tab.name}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onKillTab(tab.id);
                }}
                className={`absolute right-1 shrink-0 transition-all duration-200 hover:bg-surface-variant/40 rounded p-0.5 text-on-surface-variant/40 hover:text-error ${
                  isExpanded ? "opacity-100" : "opacity-0 pointer-events-none"
                }`}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
      </div>
      <button
        onClick={onAddTab}
        className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-variant/20 hover:text-primary transition-colors border border-outline-variant/10"
        title="New Tab"
      >
        <Plus size={14} />
      </button>

      {contextTab && onDuplicateTab && (
        <RightClickMenuPanel anchorX={contextTab.x} anchorY={contextTab.y} open={true}>
          <RightClickMenuItem
            icon={<Copy size={14} />}
            onClick={() => {
              onDuplicateTab(contextTab.tab);
              setContextTab(null);
            }}
          >
            Duplicate
          </RightClickMenuItem>
        </RightClickMenuPanel>
      )}
    </div>
  );
}
