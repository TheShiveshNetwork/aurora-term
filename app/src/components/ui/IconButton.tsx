import React, { useState } from "react";

interface IconButtonProps {
  icon: React.ReactNode;
  onClick?: (e: React.MouseEvent) => void;
  tooltip?: string;
  active?: boolean;
  disabled?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
  style?: React.CSSProperties;
  variant?: "ghost" | "primary" | "danger";
}

const SIZE_MAP = { sm: "w-7 h-7", md: "w-8 h-8", lg: "w-9 h-9" };
const ICON_SIZE_MAP = { sm: 14, md: 16, lg: 18 };

export function IconButton({
  icon,
  onClick,
  tooltip,
  active,
  disabled,
  size = "md",
  className = "",
  style,
  variant = "ghost",
}: IconButtonProps) {
  const [hovered, setHovered] = useState(false);

  const bgColor = active ? "rgba(255,255,255,0.1)" : hovered ? "rgba(255,255,255,0.06)" : "transparent";
  const textColor = variant === "danger" && hovered ? "#FF6B6B" : active ? "#E8EAF0" : hovered ? "#E8EAF0" : "rgba(232,234,240,0.35)";

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`flex items-center justify-center rounded-lg transition-all cursor-pointer disabled:opacity-40 disabled:cursor-default bg-[${bgColor}] color-[${textColor}] ${SIZE_MAP[size]} ${className}`}
      title={tooltip}
    >
      <span style={{ fontSize: ICON_SIZE_MAP[size], display: "inline-flex" }}>{icon}</span>
    </button>
  );
}
