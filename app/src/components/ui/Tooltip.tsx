import React, { useState, useRef } from "react";

interface TooltipProps {
  content?: string;
  tooltip?: React.ReactNode;
  children: React.ReactNode;
  position?: "top" | "bottom" | "left" | "right";
  side?: "top" | "bottom" | "left" | "right";
  delay?: number;
  className?: string;
}

export const TooltipProvider = ({ children }: { children: React.ReactNode }) => <>{children}</>;

export function Tooltip({
  content,
  tooltip,
  children,
  position = "top",
  side,
  delay = 200,
  className = "",
}: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activePosition = side || position;

  const show = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setVisible(true), delay);
  };
  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    setVisible(false);
  };

  const positionStyles: Record<string, React.CSSProperties> = {
    top: { bottom: "100%", left: "50%", transform: "translateX(-50%)", marginBottom: 6 },
    bottom: { top: "100%", left: "50%", transform: "translateX(-50%)", marginTop: 6 },
    left: { right: "100%", top: "50%", transform: "translateY(-50%)", marginRight: 6 },
    right: { left: "100%", top: "50%", transform: "translateY(-50%)", marginLeft: 6 },
  };

  let trigger: React.ReactNode = null;
  let contentFromChildren: React.ReactNode = null;

  React.Children.forEach(children, (child) => {
    if (React.isValidElement(child)) {
      if ((child.type as any).displayName === "TooltipTrigger") {
        trigger = child;
      } else if ((child.type as any).displayName === "TooltipContent") {
        contentFromChildren = child;
      }
    }
  });

  const finalTrigger = trigger || children;
  const rawTooltipText = tooltip || content || contentFromChildren;
  const finalTooltipText = typeof rawTooltipText === "string" ? rawTooltipText : null;

  return (
    <div className={`relative inline-flex ${className}`} onMouseEnter={show} onMouseLeave={hide}>
      {finalTrigger}
      {visible && finalTooltipText && (
        <div
          className="absolute z-[999] px-2 py-1 text-[11px] font-medium whitespace-nowrap rounded pointer-events-none"
          style={{
            ...positionStyles[activePosition],
            background: "#1E2430",
            color: "#E8EAF0",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          {finalTooltipText}
        </div>
      )}
    </div>
  );
}

export const TooltipTrigger = ({ children, asChild, ...props }: any) => {
  if (asChild && React.isValidElement(children)) {
    const childProps = (children as any).props;
    return React.cloneElement(children as any, {
      ...props,
      onClick: (e: any) => {
        props.onClick?.(e);
        childProps.onClick?.(e);
      },
    });
  }
  return <div {...props}>{children}</div>;
};
TooltipTrigger.displayName = "TooltipTrigger";

export const TooltipContent = ({ children, side, className, ...props }: any) => {
  return <>{children}</>;
};
TooltipContent.displayName = "TooltipContent";
