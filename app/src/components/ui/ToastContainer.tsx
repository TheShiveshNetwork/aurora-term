import { X } from "lucide-react";
import { useToastStore } from "../../stores/useToastStore";

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9999] flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto flex items-center gap-3 px-4 py-2.5 rounded-xl text-[13px] shadow-lg animate-in fade-in slide-in-from-bottom-2"
          style={{
            background: t.type === "error" ? "rgba(239,68,68,0.15)" : t.type === "success" ? "rgba(34,197,94,0.15)" : "rgba(79,140,255,0.15)",
            border: `1px solid ${t.type === "error" ? "rgba(239,68,68,0.3)" : t.type === "success" ? "rgba(34,197,94,0.3)" : "rgba(79,140,255,0.3)"}`,
            color: t.type === "error" ? "#FCA5A5" : t.type === "success" ? "#86EFAC" : "#93C5FD",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
          }}
        >
          <span className="flex-1">{t.message}</span>
          <button
            onClick={() => removeToast(t.id)}
            className="shrink-0 opacity-60 hover:opacity-100 transition-opacity cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
