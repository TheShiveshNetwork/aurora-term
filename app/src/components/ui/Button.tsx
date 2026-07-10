import React from "react";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline" | "danger" | "ghost" | "link" | "destructive";
  size?: "sm" | "md" | "lg" | "icon";
}

const variantStyles: Record<string, { background: string; color: string; border: string }> = {
  primary: { background: "rgba(79,140,255,1)", color: "#FFFFFF", border: "none" },
  secondary: { background: "rgba(255, 255, 255, 0.05)", color: "rgba(232, 234, 240, 0.8)", border: "1px solid rgba(255, 255, 255, 0.08)" },
  outline: { background: "transparent", color: "rgba(232, 234, 240, 0.8)", border: "1px solid rgba(255, 255, 255, 0.15)" },
  danger: { background: "rgba(255, 107, 107, 1)", color: "#FFFFFF", border: "none" },
  ghost: { background: "transparent", color: "rgba(232, 234, 240, 0.8)", border: "none" },
  link: { background: "transparent", color: "#4F8CFF", border: "none" },
  destructive: { background: "rgba(255, 107, 107, 1)", color: "#FFFFFF", border: "none" },
};

const disabledStyles: Record<string, { background: string; color: string; border: string }> = {
  primary: { background: "rgba(79,140,255,0.35)", color: "rgba(255,255,255,0.4)", border: "none" },
  secondary: { background: "rgba(255, 255, 255, 0.02)", color: "rgba(232, 234, 240, 0.3)", border: "1px solid rgba(255, 255, 255, 0.08)" },
  outline: { background: "transparent", color: "rgba(232, 234, 240, 0.3)", border: "1px solid rgba(255, 255, 255, 0.15)" },
  danger: { background: "rgba(255, 107, 107, 0.35)", color: "rgba(255,255,255,0.4)", border: "none" },
  ghost: { background: "transparent", color: "rgba(232, 234, 240, 0.3)", border: "none" },
  link: { background: "transparent", color: "rgba(79,140,255,0.5)", border: "none" },
  destructive: { background: "rgba(255, 107, 107, 0.35)", color: "rgba(255,255,255,0.4)", border: "none" },
};

const hoverBg: Record<string, string> = {
  primary: "rgba(59, 120, 235, 1)",
  secondary: "rgba(255, 255, 255, 0.08)",
  outline: "rgba(255, 255, 255, 0.05)",
  danger: "rgba(235, 87, 87, 1)",
  ghost: "rgba(255, 255, 255, 0.05)",
  link: "transparent",
  destructive: "rgba(235, 87, 87, 1)",
};

const sizeClassMap: Record<string, string> = {
  sm: "px-2.5 py-1 text-[11px]",
  icon: "p-1.5 text-[11px]",
  md: "px-3 py-1.5 text-[12px]",
  lg: "px-4 py-2.5 text-[14px]",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ children, variant = "primary", size = "md", className = "", style, disabled, ...props }, ref) => {
    const v = variant || "primary";
    const s = size || "md";
    const styles = disabled ? (disabledStyles[v] || disabledStyles.primary) : (variantStyles[v] || variantStyles.primary);
    const sizeClass = sizeClassMap[s] || sizeClassMap.md;

    return (
      <button
        ref={ref}
        disabled={disabled}
        className={`font-medium rounded-sm transition-all duration-150 flex items-center justify-center gap-1.5 active:scale-[0.98] ${disabled ? "cursor-default opacity-50" : "cursor-pointer"} ${sizeClass} ${className}`}
        style={{ ...styles, ...style }}
        onMouseEnter={(e) => {
          if (disabled) return;
          e.currentTarget.style.background = hoverBg[v] || hoverBg.primary;
          if (v === "secondary" || v === "outline" || v === "ghost") {
            e.currentTarget.style.color = "#FFFFFF";
          }
        }}
        onMouseLeave={(e) => {
          if (disabled) return;
          const ds = variantStyles[v] || variantStyles.primary;
          e.currentTarget.style.background = ds.background;
          e.currentTarget.style.color = ds.color;
        }}
        {...props}
      >
        {children}
      </button>
    );
  }
);
Button.displayName = "Button";

export const buttonVariants = (options: any) => {
  return "";
};
