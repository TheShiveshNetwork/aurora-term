import { AlertTriangle, Info, CheckCircle2, X } from "lucide-react";
import { useNotificationStore } from "../../stores/useToastStore";
import type { NotificationItem } from "../../stores/useToastStore";

const STYLES: Record<
  NotificationItem["type"],
  { border: string; icon: JSX.Element; iconColor: string }
> = {
  error: {
    border: "border-red-500/40",
    icon: <AlertTriangle size={16} />,
    iconColor: "text-red-400",
  },
  info: {
    border: "border-[#4F8CFF]/40",
    icon: <Info size={16} />,
    iconColor: "text-[#4F8CFF]",
  },
  success: {
    border: "border-emerald-500/40",
    icon: <CheckCircle2 size={16} />,
    iconColor: "text-emerald-400",
  },
};

export function Toaster() {
  const notifications = useNotificationStore((s) => s.notifications);
  const remove = useNotificationStore((s) => s.removeNotification);

  if (notifications.length === 0) return null;

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[1000] flex w-[340px] max-w-[calc(100vw-2rem)] flex-col gap-2">
      {notifications.map((n) => {
        const style = STYLES[n.type];
        return (
          <div
            key={n.id}
            role="alert"
            className={`pointer-events-auto flex items-start gap-2.5 rounded-xl border ${style.border} bg-surface-container-high/95 px-3.5 py-3 shadow-lg shadow-black/30 backdrop-blur`}
          >
            <span className={`mt-0.5 shrink-0 ${style.iconColor}`}>
              {style.icon}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold leading-tight text-on-surface">
                {n.title}
              </p>
              <p className="mt-0.5 whitespace-pre-wrap break-words text-[12px] leading-snug text-on-surface-variant">
                {n.message}
              </p>
            </div>
            <button
              aria-label="Dismiss notification"
              onClick={() => remove(n.id)}
              className="shrink-0 rounded-md p-0.5 text-on-surface-variant transition-colors hover:bg-white/[0.06] hover:text-on-surface"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
