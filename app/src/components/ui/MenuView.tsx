import React, { ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";

export type MenuVariant = "primary" | "secondary" | "rightclick";

const MENU_MARGIN = 8;

type MenuPlacement = {
  x: number;
  y: number;
  maxHeight: number;
};

interface MenuViewProps {
  variant?: MenuVariant;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
  anchorX?: number;
  anchorY?: number;
  topBoundarySelector?: string;
  bottomBoundarySelector?: string;
}

export function MenuView({
  variant = "primary",
  open,
  onClose,
  children,
  className = "",
  style,
  anchorX = 0,
  anchorY = 0,
  topBoundarySelector = "#aurora-tab-bar",
  bottomBoundarySelector = "#aurora-status-bar",
}: MenuViewProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<MenuPlacement | null>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler, true);
    return () => document.removeEventListener("mousedown", handler, true);
  }, [open, onClose]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Smart positioning for rightclick variant
  useLayoutEffect(() => {
    if (variant !== "rightclick" || !open) {
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

      const topBoundaryEl = topBoundarySelector ? document.querySelector(topBoundarySelector) : null;
      const bottomBoundaryEl = bottomBoundarySelector ? document.querySelector(bottomBoundarySelector) : null;

      const safeTop = Math.max(MENU_MARGIN, topBoundaryEl ? topBoundaryEl.getBoundingClientRect().bottom : MENU_MARGIN);
      const safeBottom = Math.min(viewportHeight - MENU_MARGIN, bottomBoundaryEl ? bottomBoundaryEl.getBoundingClientRect().top : viewportHeight - MENU_MARGIN);
      const safeLeft = MENU_MARGIN;
      const safeRight = Math.max(MENU_MARGIN, viewportWidth - MENU_MARGIN);
      const availableHeight = Math.max(0, safeBottom - safeTop);
      const clampedWidth = Math.min(menuWidth, safeRight - safeLeft);

      const fitsBelow = anchorY + menuHeight <= safeBottom;
      const fitsAbove = anchorY - menuHeight >= safeTop;

      let nextY = anchorY;
      if (fitsBelow) nextY = anchorY;
      else if (fitsAbove) nextY = anchorY - menuHeight;
      else nextY = Math.min(Math.max(anchorY, safeTop), safeBottom - menuHeight);
      nextY = Math.max(safeTop, Math.min(nextY, safeBottom - menuHeight));

      let nextX = anchorX;
      if (nextX + clampedWidth > safeRight) nextX = Math.max(safeLeft, safeRight - clampedWidth);
      nextX = Math.max(safeLeft, Math.min(nextX, safeRight - clampedWidth));

      setPlacement({ x: nextX, y: nextY, maxHeight: availableHeight });
    };

    updatePlacement();
    window.addEventListener("resize", updatePlacement);
    window.addEventListener("scroll", updatePlacement, true);
    return () => {
      window.removeEventListener("resize", updatePlacement);
      window.removeEventListener("scroll", updatePlacement, true);
    };
  }, [anchorX, anchorY, open, variant, topBoundarySelector, bottomBoundarySelector]);

  if (!open) return null;

  const variantStyles = getVariantStyles(variant);

  const isRightClick = variant === "rightclick";

  return (
    <div
      ref={panelRef}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      className={variantStyles.containerClass + " " + className}
      style={{
        ...(isRightClick
          ? {
            top: placement ? placement.y : anchorY,
            left: placement ? placement.x : anchorX,
            opacity: placement ? 1 : 0,
            visibility: placement ? "visible" : "hidden",
            maxHeight: placement ? placement.maxHeight : undefined,
          }
          : {}),
        background: variantStyles.background,
        border: variantStyles.border,
        borderRadius: variantStyles.borderRadius,
        boxShadow: variantStyles.boxShadow,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ── MenuViewItem ─────────────────────────────────────────────────────

interface MenuViewItemProps {
  variant?: MenuVariant;
  icon?: ReactNode;
  children: ReactNode;
  onClick?: () => void;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  checked?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function MenuViewItem({
  variant = "primary",
  icon,
  children,
  onClick,
  shortcut,
  danger = false,
  disabled = false,
  checked,
  className = "",
  style,
}: MenuViewItemProps) {
  const itemStyles = getItemStyles(variant);

  const itemClass = [
    "w-full flex gap-2 items-center text-left cursor-pointer transition-colors",
    itemStyles.baseClass,
    disabled ? itemStyles.disabledClass : "",
    !disabled && danger ? itemStyles.dangerClass : "",
    !disabled && !danger ? itemStyles.hoverClass : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={itemClass}
      style={{
        color: disabled
          ? itemStyles.disabledColor
          : danger
            ? itemStyles.dangerColor
            : itemStyles.color,
        ...style,
      }}
    >
      {(icon || checked !== undefined) && (
        <span
          className="shrink-0 flex items-center justify-center"
          style={{
            width: itemStyles.iconSize,
            height: itemStyles.iconSize,
            color: disabled
              ? itemStyles.disabledColor
              : danger
                ? itemStyles.dangerIconColor
                : checked
                  ? itemStyles.checkedColor
                  : itemStyles.iconColor,
          }}
        >
          {checked !== undefined ? (
            checked ? (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : null
          ) : (
            icon
          )}
        </span>
      )}
      <span className="flex-1 truncate">{children}</span>
      {shortcut && <span className={itemStyles.shortcutClass} style={{ color: itemStyles.shortcutColor }}>{shortcut}</span>}
    </button>
  );
}

// ── MenuViewSeparator ─────────────────────────────────────────────────

export function MenuViewSeparator() {
  return <div className="h-px bg-outline-variant/20 my-1 mx-2" />;
}

// ── Internal ─────────────────────────────────────────────────────────

function getVariantStyles(variant: MenuVariant) {
  const base = "z-[100] animate-in fade-in duration-150";

  switch (variant) {
    case "primary":
      return {
        containerClass: `${base} p-1`,
        background: "#0F131A",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "14px",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03), 0 16px 40px rgba(0,0,0,0.5)",
      };
    case "secondary":
      return {
        containerClass: `${base} p-1`,
        background: "#0F131A",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "8px",
        boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
      };
    case "rightclick":
      return {
        containerClass: `fixed glass-panel z-[500] min-w-[200px] py-1 px-1 slide-in-from-top-1 duration-150`,
        background: "#0F131A",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "12px",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03), 0 16px 40px rgba(0,0,0,0.5)",
      };
  }
}

function getItemStyles(variant: MenuVariant) {
  const base = {
    iconSize: "16px" as const,
    checkedColor: "#4F8CFF",
  };

  switch (variant) {
    case "primary":
      return {
        ...base,
        baseClass: "px-3 py-[7px] text-[12px] rounded-[8px]",
        hoverClass: "hover:bg-white/5 hover:text-[#E8EAF0]",
        disabledClass: "opacity-30 pointer-events-none",
        dangerClass: "hover:bg-red-500/10 text-red-400",
        color: "rgba(232,234,240,0.75)",
        disabledColor: "rgba(232,234,240,0.25)",
        dangerColor: "#FF6B6B",
        iconColor: "rgba(232,234,240,0.35)",
        dangerIconColor: "#FF6B6B",
        shortcutClass: "text-[10px]",
        shortcutColor: "rgba(232,234,240,0.25)",
      };
    case "secondary":
      return {
        ...base,
        baseClass: "px-2 py-1.5 text-[13px] rounded-[6px]",
        hoverClass: "hover:bg-white/5",
        disabledClass: "opacity-30 pointer-events-none",
        dangerClass: "hover:bg-red-500/10 text-red-400",
        color: "rgba(232,234,240,0.7)",
        disabledColor: "rgba(232,234,240,0.25)",
        dangerColor: "#FF6B6B",
        iconColor: "rgba(232,234,240,0.35)",
        dangerIconColor: "#FF6B6B",
        shortcutClass: "text-[10px]",
        shortcutColor: "rgba(232,234,240,0.25)",
      };
    case "rightclick":
      return {
        ...base,
        baseClass: "px-3 py-2 text-[13px] border-[.1px] rounded-sm",
        hoverClass: "hover:bg-white/5 hover:border-white/10 border-transparent",
        disabledClass: "border-transparent bg-none opacity-30 pointer-events-none",
        dangerClass: "hover:bg-red-500/10 hover:border-red-500/20 text-red-400",
        color: "var(--color-on-surface, rgba(232,234,240,0.85))",
        disabledColor: "rgba(232,234,240,0.25)",
        dangerColor: "#FF6B6B",
        iconColor: "rgba(232,234,240,0.4)",
        dangerIconColor: "#FF6B6B",
        shortcutClass: "text-[11px]",
        shortcutColor: "rgba(232,234,240,0.3)",
      };
  }
}
