export const Colors = {
  PRIMARY: "#4F8CFF",
  PRIMARY_HOVER: "rgba(79,140,255,0.35)",
  PRIMARY_BORDER: "rgba(79,140,255,0.4)",
  TEXT_PRIMARY: "#E8EAF0",
  TEXT_SECONDARY: "rgba(232,234,240,0.35)",
  TEXT_ON_SURFACE: "rgba(232,234,240,0.8)",
  BG_PRIMARY: "#0A0D14",
  BG_SECONDARY: "#0F131A",
  BG_SURFACE: "rgba(15,19,26,0.6)",
  BG_OVERLAY: "rgba(0,0,0,0.20)",
  BORDER_DEFAULT: "rgba(255,255,255,0.05)",
  BORDER_MEDIUM: "rgba(255,255,255,0.06)",
  BORDER_STRONG: "rgba(255,255,255,0.08)",
  BORDER_OUTLINE: "rgba(232,234,240,0.07)",
  HOVER_BG: "rgba(255,255,255,0.04)",
  HOVER_STRONG: "rgba(255,255,255,0.05)",
  SUCCESS: "#3DDC84",
  ERROR: "#FF6B6B",
  WARNING: "#FFB454",
};

export function hoverStyle(baseBg = "transparent", baseColor = Colors.TEXT_SECONDARY) {
  return {
    background: baseBg,
    color: baseColor,
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
      e.currentTarget.style.background = Colors.HOVER_STRONG;
      e.currentTarget.style.color = Colors.TEXT_PRIMARY;
    },
    onMouseLeave: (e: React.MouseEvent<HTMLElement>) => {
      e.currentTarget.style.background = baseBg;
      e.currentTarget.style.color = baseColor;
    },
  };
}
