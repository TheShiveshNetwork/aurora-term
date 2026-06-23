import React, { ReactNode, useLayoutEffect, useRef, useState } from "react";

const MENU_MARGIN = 8;

type MenuPlacement = {
  x: number;
  y: number;
  maxHeight: number;
};

export interface RightClickMenuPanelProps {
  anchorX: number;
  anchorY: number;
  open: boolean;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  topBoundarySelector?: string;
  bottomBoundarySelector?: string;
  horizontalMargin?: number;
  verticalMargin?: number;
}

export interface RightClickMenuItemProps {
  icon?: ReactNode;
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
  className?: string;
  iconClassName?: string;
}

function resolveBoundaryRect(selector?: string): DOMRect | null {
  if (!selector) return null;
  const element = document.querySelector(selector);
  return element ? element.getBoundingClientRect() : null;
}

export function RightClickMenuPanel({
  anchorX,
  anchorY,
  open,
  children,
  className = "",
  contentClassName = "",
  topBoundarySelector = "#aurora-tab-bar",
  bottomBoundarySelector = "#aurora-status-bar",
  horizontalMargin = MENU_MARGIN,
  verticalMargin = MENU_MARGIN,
}: RightClickMenuPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<MenuPlacement | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPlacement(null);
      return;
    }

    const updatePlacement = () => {
      const panelEl = panelRef.current;
      if (!panelEl) return;

      const rect = panelEl.getBoundingClientRect();
      const menuWidth = rect.width || 200;
      const menuHeight = rect.height || 180;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const topBoundary = resolveBoundaryRect(topBoundarySelector);
      const bottomBoundary = resolveBoundaryRect(bottomBoundarySelector);

      const safeTop = Math.max(verticalMargin, topBoundary ? topBoundary.bottom : verticalMargin);
      const safeBottom = Math.min(
        viewportHeight - verticalMargin,
        bottomBoundary ? bottomBoundary.top : viewportHeight - verticalMargin
      );
      const safeLeft = horizontalMargin;
      const safeRight = Math.max(horizontalMargin, viewportWidth - horizontalMargin);
      const availableHeight = Math.max(0, safeBottom - safeTop);
      const clampedWidth = Math.min(menuWidth, safeRight - safeLeft);

      const fitsBelow = anchorY + menuHeight <= safeBottom;
      const fitsAbove = anchorY - menuHeight >= safeTop;

      let nextY = anchorY;
      if (fitsBelow) {
        nextY = anchorY;
      } else if (fitsAbove) {
        nextY = anchorY - menuHeight;
      } else {
        nextY = Math.min(Math.max(anchorY, safeTop), safeBottom - menuHeight);
      }

      nextY = Math.max(safeTop, Math.min(nextY, safeBottom - menuHeight));

      let nextX = anchorX;
      if (nextX + clampedWidth > safeRight) {
        nextX = Math.max(safeLeft, safeRight - clampedWidth);
      }
      nextX = Math.max(safeLeft, Math.min(nextX, safeRight - clampedWidth));

      setPlacement({
        x: nextX,
        y: nextY,
        maxHeight: availableHeight,
      });
    };

    updatePlacement();
    window.addEventListener("resize", updatePlacement);
    window.addEventListener("scroll", updatePlacement, true);
    return () => {
      window.removeEventListener("resize", updatePlacement);
      window.removeEventListener("scroll", updatePlacement, true);
    };
  }, [anchorX, anchorY, bottomBoundarySelector, horizontalMargin, open, topBoundarySelector, verticalMargin]);

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      className={`fixed z-[500] min-w-[200px] glass-panel border border-outline-variant/20 rounded-md shadow-2xl py-1 overflow-y-auto overflow-x-hidden ${className}`}
      style={{
        top: placement ? placement.y : anchorY,
        left: placement ? placement.x : anchorX,
        opacity: placement ? 1 : 0,
        visibility: placement ? "visible" : "hidden",
        maxHeight: placement ? placement.maxHeight : undefined,
      }}
    >
      <div className={contentClassName}>{children}</div>
    </div>
  );
}

export function RightClickMenuItem({
  icon,
  children,
  onClick,
  disabled = false,
  danger = false,
  className = "",
  iconClassName = "",
}: RightClickMenuItemProps) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`w-full flex items-center gap-3 px-3 py-2 text-[13px] border-[.1px] rounded-md transition-colors text-left group ${disabled
        ? "border-transparent bg-none text-on-surface-variant/30"
        : danger
          ? "hover:bg-red-500/10 hover:border-red-500/20 text-red-400 border-transparent"
          : "hover:bg-surface-variant/30 hover:bg-on-surface-variant/10 hover:border-on-surface/30 border-transparent text-on-surface"
        } ${className}`}
    >
      {icon ? (
        <span
          className={`shrink-0 transition-colors ${disabled
            ? "text-on-surface-variant/30"
            : danger
              ? "text-red-400/70 group-hover:text-red-400"
              : "text-on-surface-variant/60 group-hover:text-primary"
            } ${iconClassName}`}
        >
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
}

export function RightClickMenuSeparator() {
  return <div className="h-px bg-outline-variant/20 my-1 mx-2" />;
}