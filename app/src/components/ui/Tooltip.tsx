import React from "react";
import { Tooltip as CustomTooltip } from "./Tooltip";

export const TooltipProvider = ({ children }: { children: React.ReactNode }) => <>{children}</>;

export const Tooltip = ({ children, tooltip, ...props }: any) => {
  // Let's find TooltipTrigger and TooltipContent in children
  let trigger: React.ReactNode = null;
  let content: React.ReactNode = null;

  React.Children.forEach(children, (child) => {
    if (React.isValidElement(child)) {
      if ((child.type as any).displayName === "TooltipTrigger") {
        trigger = child;
      } else if ((child.type as any).displayName === "TooltipContent") {
        content = child;
      }
    }
  });

  // If tooltip is explicitly passed as prop (as in PromptInputAction)
  if (tooltip) {
    return (
      <CustomTooltip content={typeof tooltip === "string" ? tooltip : ""} position="top">
        {children}
      </CustomTooltip>
    );
  }

  if (!trigger || !content) return <>{children}</>;

  // TooltipContent will have some side prop and children
  const contentText = (content as any).props.children;
  const side = (content as any).props.side || "top";

  return (
    <CustomTooltip content={typeof contentText === "string" ? contentText : ""} position={side}>
      {trigger}
    </CustomTooltip>
  );
};

export const TooltipTrigger = ({ children, asChild, ...props }: any) => {
  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children as any, props);
  }
  return <div {...props}>{children}</div>;
};
TooltipTrigger.displayName = "TooltipTrigger";

export const TooltipContent = ({ children, side, className, ...props }: any) => {
  return null; // Tooltip wrapper extracts children and shows via CustomTooltip
};
TooltipContent.displayName = "TooltipContent";
