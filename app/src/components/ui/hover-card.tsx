import React from "react";

export const HoverCard = ({ children, ...props }: any) => {
  return <div className="relative group inline-block" {...props}>{children}</div>;
};

export const HoverCardTrigger = ({ children, asChild, ...props }: any) => {
  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children as any, props);
  }
  return <span {...props}>{children}</span>;
};

export const HoverCardContent = ({ children, className, ...props }: any) => {
  return (
    <div
      className={`absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 hidden group-hover:block z-[999] bg-[#1E2430] border border-outline p-3 rounded shadow-lg text-xs min-w-[200px] text-on-surface ${className}`}
      {...props}
    >
      {children}
    </div>
  );
};
