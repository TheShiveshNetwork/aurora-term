import React, { createContext, useContext, useState } from "react";

type CollapsibleContextType = {
  open: boolean;
  setOpen: (open: boolean) => void;
};

const CollapsibleContext = createContext<CollapsibleContextType | undefined>(undefined);

export const useCollapsible = () => {
  const ctx = useContext(CollapsibleContext);
  if (!ctx) throw new Error("useCollapsible must be used within a Collapsible");
  return ctx;
};

export const Collapsible = ({
  children,
  open: controlledOpen,
  onOpenChange,
  defaultOpen = false,
  ...props
}: any) => {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen;
  
  const setOpen = (newOpen: boolean) => {
    if (controlledOpen === undefined) {
      setInternalOpen(newOpen);
    }
    onOpenChange?.(newOpen);
  };

  return (
    <CollapsibleContext.Provider value={{ open, setOpen }}>
      <div data-state={open ? "open" : "closed"} {...props}>
        {children}
      </div>
    </CollapsibleContext.Provider>
  );
};

export const CollapsibleTrigger = ({ children, asChild, onClick, ...props }: any) => {
  const { open, setOpen } = useCollapsible();
  
  const handleClick = (e: React.MouseEvent) => {
    setOpen(!open);
    onClick?.(e);
  };

  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children as any, {
      onClick: handleClick,
      "data-state": open ? "open" : "closed",
      ...props
    });
  }

  return (
    <button
      onClick={handleClick}
      data-state={open ? "open" : "closed"}
      {...props}
    >
      {children}
    </button>
  );
};

export const CollapsibleContent = ({ children, className, ...props }: any) => {
  const { open } = useCollapsible();
  if (!open) return null;
  return (
    <div className={className} data-state="open" {...props}>
      {children}
    </div>
  );
};
