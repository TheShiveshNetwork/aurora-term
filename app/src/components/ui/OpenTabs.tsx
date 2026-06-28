import React, { useRef, useState, useCallback, useEffect } from "react";
import {
  Terminal, FileText, GitBranch, GitBranchPlus, X, Pin, Edit3, XCircle, Trash2,
  ArrowUp, ArrowDown, Copy, ExternalLink,
} from "lucide-react";
import { useSessionStore } from "../../stores/useSessionStore";
import { useOpenTabs } from "../../hooks/useOpenTabs";
import { MenuView, MenuViewItem, MenuViewSeparator } from "./MenuView";
import { closeAllPopups, onClosePopups } from "../../lib/popups";
import type { Tab } from "@aurora/types";
import { system } from "../../lib/ipc";

interface OpenTabsProps {
  onKillTab?: (id: string) => void;
}

function TabIcon({ type }: { type: Tab["type"] }) {
  switch (type) {
    case "terminal":
      return <Terminal size={13} style={{ color: "rgba(154,124,255,0.7)" }} className="shrink-0" />;
    case "file":
      return <FileText size={13} style={{ color: "rgba(79,140,255,0.7)" }} className="shrink-0" />;
    case "diff":
      return <GitBranchPlus size={13} style={{ color: "rgba(79,140,255,0.7)" }} className="shrink-0" />;
    case "git":
      return <GitBranch size={13} style={{ color: "rgba(79,140,255,0.7)" }} className="shrink-0" />;
  }
}

interface TabRowProps {
  tab: Tab;
  index: number;
  isActive: boolean;
  onSelect: (id: string) => void;
  onKillTab?: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, tab: Tab) => void;
  onPointerDown: (e: React.PointerEvent, index: number) => void;
  isDragging: boolean;
}

function TabRow({ tab, index, isActive, onSelect, onKillTab, onContextMenu, onPointerDown, isDragging }: TabRowProps) {
  return (
    <div
      onPointerDown={(e) => onPointerDown(e, index)}
      onClick={() => onSelect(tab.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onContextMenu(e, tab);
      }}
      className={`flex items-center gap-2 px-3 py-1 cursor-pointer transition-colors select-none`}
      style={{
        // minHeight: "28px",
        background: isActive || isDragging
          ? "rgba(214, 214, 214, 0.1)"
          : "transparent",
        border: isActive
          ? "1px solid rgba(44,44,44,1)"
          : "1px solid transparent",
        borderRadius: "6px",
        color: isActive ? "#E8EAF0" : "rgba(232,234,240,0.65)",
        boxShadow: isActive
          ? "0 1px 3px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.04)"
          : "none",
        margin: "0 4px",
        opacity: isDragging ? 0.5 : 1,
        transform: isDragging ? "scale(0.97)" : "none",
      }}
      onMouseEnter={(e) => {
        if (!isActive && !isDragging) e.currentTarget.style.background = "rgba(255,255,255,0.04)";
      }}
      onMouseLeave={(e) => {
        if (!isActive && !isDragging) e.currentTarget.style.background = "transparent";
      }}
    >
      <TabIcon type={tab.type} />
      <span className="text-[12px] overflow-hidden text-ellipsis whitespace-nowrap min-w-0 flex-1">
        {tab.name}
      </span>
      {tab.pinned && (
        <Pin size={10} className="shrink-0" style={{ color: "rgba(232,234,240,0.25)" }} />
      )}
      {tab.dirty && (
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: "#E8EAF0" }} />
      )}
      {onKillTab && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onKillTab(tab.id);
          }}
          className="shrink-0 opacity-0 group-hover/tabrow:opacity-100 hover:bg-surface-variant/40 rounded p-0.5 transition-colors"
          style={{ color: "rgba(232,234,240,0.35)" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "#E8EAF0")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(232,234,240,0.35)")}
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}

export function OpenTabs({ onKillTab }: OpenTabsProps) {
  const rawTabs = useSessionStore((s) => s.tabs);
  const reorderTabs = useSessionStore((s) => s.reorderTabs);
  const updateTab = useSessionStore((s) => s.updateTab);
  const { tabs, activeTabId, setActiveTabId } = useOpenTabs();

  // Drag state
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);
  const dragIdxRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rowRectsRef = useRef<DOMRect[]>([]);
  const [dropIndicatorY, setDropIndicatorY] = useState<number | null>(null);

  // Context menu state
  const [contextTab, setContextTab] = useState<{ x: number; y: number; tab: Tab } | null>(null);

  // Rename modal state
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

  // Close context menu on outside click
  useEffect(() => {
    const close = () => {
      setContextTab(null);
    };
    window.addEventListener("click", close);
    const unsub = onClosePopups(() => {
      setContextTab(null);
      setRenameTabId(null);
    });
    return () => {
      window.removeEventListener("click", close);
      unsub();
    };
  }, []);

  const getTabIndexFromY = useCallback((clientY: number): number | null => {
    const rects = rowRectsRef.current;
    if (rects.length === 0) return null;
    for (let i = 0; i < rects.length; i++) {
      if (clientY >= rects[i].top && clientY <= rects[i].bottom) {
        return i;
      }
    }
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < rects.length; i++) {
      const cy = rects[i].top + rects[i].height / 2;
      const d = Math.abs(clientY - cy);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    return best;
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent, index: number) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("button")) return;

    const tab = tabs[index];
    if (tab?.pinned) return;

    dragIdxRef.current = index;
    setDragIdx(index);

    const container = containerRef.current;
    if (!container) return;

    const elements = container.querySelectorAll<HTMLElement>("[data-tabrow-idx]");
    rowRectsRef.current = Array.from(elements).map(el => el.getBoundingClientRect());
    const containerRect = container.getBoundingClientRect();

    const onPointerMove = (ev: PointerEvent) => {
      const idx = getTabIndexFromY(ev.clientY);
      setDropIdx(idx);

      if (idx !== null) {
        const rects = rowRectsRef.current;
        const rowRect = rects[idx];
        const rowCenterY = rowRect.top + rowRect.height / 2;
        const side = ev.clientY < rowCenterY ? "top" : "bottom";
        const gapCenter = side === "top"
          ? rowRect.top - 2
          : rowRect.bottom + 2;
        const indicatorTop = gapCenter - containerRect.top + container.scrollTop;
        setDropIndicatorY(indicatorTop);
      } else {
        setDropIndicatorY(null);
      }
    };

    const onPointerUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);

      const fromIdx = dragIdxRef.current;
      const toIdx = getTabIndexFromY(ev.clientY);

      if (fromIdx !== null && toIdx !== null && fromIdx !== toIdx) {
        const fromTab = tabs[fromIdx];
        const toTab = tabs[toIdx];

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
      setDropIdx(null);
      setDropIndicatorY(null);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }, [getTabIndexFromY, reorderTabs, tabs, rawTabs]);

  const handleContextMenu = useCallback((e: React.MouseEvent, tab: Tab) => {
    closeAllPopups();
    setContextTab({ x: e.clientX, y: e.clientY, tab });
  }, []);

  if (tabs.length === 0) {
    return (
      <div
        className="text-[11px] italic px-3 py-3 select-none"
        style={{ color: "rgba(232,234,240,0.2)" }}
      >
        No open tabs
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative px-1 flex flex-col gap-1">
      {tabs.map((tab) => {
        const globalIdx = tabs.indexOf(tab);
        return (
          <div key={tab.id} data-tabrow-idx={globalIdx} className="group/tabrow">
            <TabRow
              tab={tab}
              index={globalIdx}
              isActive={tab.id === activeTabId}
              onSelect={setActiveTabId}
              onKillTab={onKillTab}
              onContextMenu={handleContextMenu}
              onPointerDown={handlePointerDown}
              isDragging={dragIdx === globalIdx}
            />
          </div>
        );
      })}

      {/* Drop indicator */}
      {dropIndicatorY !== null && (
        <div
          className="absolute left-2 right-2 h-[3px] rounded-[2px] pointer-events-none z-10"
          style={{
            top: dropIndicatorY,
            background: "#4F8CFF",
            boxShadow: "0 0 8px rgba(79,140,255,0.5), 0 0 2px rgba(79,140,255,0.3)",
            transition: "top 80ms ease-out",
          }}
        />
      )}

      {/* Context Menu */}
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
          onKillTab?.(contextTab.tab.id);
          setContextTab(null);
        }}>
          Close Tab
        </MenuViewItem>

        {/* Close Others */}
        <MenuViewItem variant="rightclick" icon={<XCircle size={13} />} onClick={() => {
          if (!contextTab) return;
          rawTabs.forEach((t) => {
            if (t.id !== contextTab.tab.id && !t.pinned) {
              onKillTab?.(t.id);
            }
          });
          setContextTab(null);
        }}>
          Close Others
        </MenuViewItem>

        {/* Close All */}
        <MenuViewItem variant="rightclick" icon={<Trash2 size={13} />} onClick={() => {
          if (!contextTab) return;
          rawTabs.forEach((t) => {
            if (!t.pinned) {
              onKillTab?.(t.id);
            }
          });
          setContextTab(null);
        }}>
          Close All
        </MenuViewItem>

        <MenuViewSeparator />

        {/* Close to Top / Bottom */}
        <MenuViewItem variant="rightclick" icon={<ArrowUp size={13} />} onClick={() => {
          if (!contextTab) return;
          const tabIdx = rawTabs.findIndex((t) => t.id === contextTab.tab.id);
          rawTabs.forEach((t, i) => {
            if (i < tabIdx && !t.pinned) {
              onKillTab?.(t.id);
            }
          });
          setContextTab(null);
        }}>
          Close to Top
        </MenuViewItem>

        <MenuViewItem variant="rightclick" icon={<ArrowDown size={13} />} onClick={() => {
          if (!contextTab) return;
          const tabIdx = rawTabs.findIndex((t) => t.id === contextTab.tab.id);
          rawTabs.forEach((t, i) => {
            if (i > tabIdx && !t.pinned) {
              onKillTab?.(t.id);
            }
          });
          setContextTab(null);
        }}>
          Close to Bottom
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

      {/* Rename Modal */}
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
              <button
                className="px-4 py-2 rounded-[10px] text-[12px] font-medium transition-all cursor-pointer"
                style={{ color: "rgba(232,234,240,0.55)" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; e.currentTarget.style.color = "#E8EAF0"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "rgba(232,234,240,0.55)"; }}
                onClick={() => setRenameTabId(null)}
              >
                Cancel
              </button>
              <button
                className="px-4 py-2 rounded-[10px] text-[12px] font-semibold transition-all cursor-pointer"
                style={{
                  background: "rgba(79,140,255,0.15)",
                  border: "1px solid rgba(79,140,255,0.25)",
                  color: "#4F8CFF",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(79,140,255,0.22)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(79,140,255,0.15)"; }}
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
