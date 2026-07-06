import { X } from "lucide-react";
import { useNotificationStore } from "../../stores/useToastStore";

const TYPE_STYLES = {
  error: {
    border: "border-l-error/50",
    title: "text-error",
  },
  success: {
    border: "border-l-[#50E3C2]/50",
    title: "text-[#50E3C2]",
  },
  info: {
    border: "border-l-primary/50",
    title: "text-primary",
  },
} as const;

export function NotificationContainer() {
  const notifications = useNotificationStore((s) => s.notifications);
  const removeNotification = useNotificationStore((s) => s.removeNotification);

  if (notifications.length === 0) return null;

  return (
    <div className="fixed bottom-12 right-4 z-[9999] flex flex-col gap-2 pointer-events-none max-w-sm">
      {notifications.map((n) => {
        const style = TYPE_STYLES[n.type] ?? TYPE_STYLES.info;
        return (
          <div
            key={n.id}
            className={`pointer-events-auto flex flex-col gap-0.5 px-4 py-3 rounded-md text-[13px] shadow-lg bg-surface-container-high border border-outline border-l-[3px] ${style.border} animate-in fade-in slide-in-from-bottom-2`}
          >
            <div className="flex items-center justify-between">
              <span className={`text-[11px] font-semibold tracking-wide uppercase ${style.title}`}>
                {n.title}
              </span>
              <button
                onClick={() => removeNotification(n.id)}
                className="shrink-0 opacity-40 hover:opacity-100 transition-opacity cursor-pointer text-on-surface-variant hover:text-on-surface -mr-1 -mt-1"
              >
                <X size={14} />
              </button>
            </div>
            <span className="text-on-surface leading-snug min-w-0 break-words">{n.message}</span>
          </div>
        );
      })}
    </div>
  );
}
