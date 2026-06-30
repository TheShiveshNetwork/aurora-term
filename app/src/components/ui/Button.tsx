import React from "react";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline" | "danger";
  size?: "sm" | "md" | "lg";
}

export function Button({
  children,
  variant = "primary",
  size = "md",
  className = "",
  style,
  disabled,
  ...props
}: ButtonProps) {
  // Styles based on variant
  const getStyles = () => {
    switch (variant) {
      case "primary":
        return {
          background: disabled ? "rgba(79,140,255,0.35)" : "rgba(79,140,255,1)",
          color: disabled ? "rgba(255,255,255,0.4)" : "#FFFFFF",
          border: "none",
        };
      case "secondary":
        return {
          background: disabled ? "rgba(255, 255, 255, 0.02)" : "rgba(255, 255, 255, 0.05)",
          color: disabled ? "rgba(232, 234, 240, 0.3)" : "rgba(232, 234, 240, 0.8)",
          border: "1px solid rgba(255, 255, 255, 0.08)",
        };
      case "danger":
        return {
          background: disabled ? "rgba(255, 107, 107, 0.35)" : "rgba(255, 107, 107, 1)",
          color: disabled ? "rgba(255,255,255,0.4)" : "#FFFFFF",
          border: "none",
        };
      case "outline":
      default:
        return {
          background: "transparent",
          color: disabled ? "rgba(232, 234, 240, 0.3)" : "rgba(232, 234, 240, 0.8)",
          border: "1px solid rgba(255, 255, 255, 0.15)",
        };
    }
  };

  const getHoverBg = () => {
    switch (variant) {
      case "primary":
        return "rgba(59, 120, 235, 1)";
      case "secondary":
        return "rgba(255, 255, 255, 0.08)";
      case "danger":
        return "rgba(235, 87, 87, 1)";
      case "outline":
      default:
        return "rgba(255, 255, 255, 0.05)";
    }
  };

  const handleMouseEnter = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (disabled) return;
    e.currentTarget.style.background = getHoverBg();
    if (variant === "secondary" || variant === "outline") {
      e.currentTarget.style.color = "#FFFFFF";
    }
  };

  const handleMouseLeave = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const defaultStyle = getStyles();
    e.currentTarget.style.background = defaultStyle.background;
    e.currentTarget.style.color = defaultStyle.color;
  };

  // Size padding and font size
  const sizeClass = 
    size === "sm" ? "px-2.5 py-1 text-[11px]" :
    size === "lg" ? "px-4 py-2.5 text-[14px]" :
    "px-3 py-1.5 text-[12px]";

  const defaultStyle = getStyles();

  return (
    <button
      disabled={disabled}
      className={`font-medium rounded-lg transition-all duration-150 flex items-center justify-center gap-1.5 active:scale-[0.98] ${disabled ? "cursor-default opacity-50" : "cursor-pointer"} ${sizeClass} ${className}`}
      style={{
        ...defaultStyle,
        ...style,
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      {...props}
    >
      {children}
    </button>
  );
}
