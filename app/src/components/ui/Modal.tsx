import React, { useEffect, useRef } from "react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  zIndex?: number;
  width?: string;
}

export function Modal({ open, onClose, title, description, children, zIndex = 500, width = "400px" }: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[500] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.50)", zIndex }}
      onMouseDown={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div
        className="rounded-xl shadow-2xl border"
        style={{ width, background: "#0F131A", borderColor: "rgba(255,255,255,0.08)" }}
      >
        {title && (
          <div className="px-5 pt-4 pb-2">
            <h3 className="text-sm font-semibold text-[#E8EAF0]">{title}</h3>
            {description && (
              <p className="text-xs mt-1" style={{ color: "rgba(232,234,240,0.5)" }}>{description}</p>
            )}
          </div>
        )}
        <div className="px-5 py-3">{children}</div>
      </div>
    </div>
  );
}
