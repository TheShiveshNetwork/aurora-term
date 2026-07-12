import React, { useEffect, useRef } from "react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm?: () => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  zIndex?: number;
  width?: string;
  dismissible?: boolean;
}

export function Modal({
  open,
  onClose,
  onConfirm,
  title,
  description,
  children,
  zIndex = 500,
  width = "400px",
  dismissible = true,
}: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dismissible) onClose();
      if (e.key === "Enter" && onConfirm) {
        e.preventDefault();
        onConfirm();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose, onConfirm, dismissible]);

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[500] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.50)", zIndex }}
      onMouseDown={
        dismissible
          ? (e) => {
              if (e.target === overlayRef.current) onClose();
            }
          : undefined
      }
    >
      <div
        ref={innerRef}
        className="rounded-xl shadow-2xl border"
        style={{
          width,
          background: "#0F131A",
          borderColor: "rgba(255,255,255,0.08)",
          boxShadow:
            "inset 0 1px 0 rgba(255,255,255,0.03), 0 24px 64px rgba(0,0,0,0.6)",
        }}
      >
        {title && (
          <div className="px-5 pt-4 pb-2">
            <h3 className="text-sm font-semibold text-[#E8EAF0]">{title}</h3>
            {description && (
              <p
                className="text-xs mt-1"
                style={{ color: "rgba(232,234,240,0.5)" }}
              >
                {description}
              </p>
            )}
          </div>
        )}
        <div className="px-5 py-3">{children}</div>
      </div>
    </div>
  );
}
