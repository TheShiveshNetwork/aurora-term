import { type ReactElement, useEffect, useRef, useState } from "react";
import { AlertTriangle, Info, CheckCircle2, X, Loader2 } from "lucide-react";
import { useNotificationStore, toStr } from "../stores/useToastStore";
import type { NotificationItem } from "../stores/useToastStore";
import { notifyNative } from "./osNotify";

export type NotificationType = "error" | "info" | "success";

export { notifyNative };

export interface NotifyAsyncOptions<T = unknown> {
  /** Title shown while the task is in flight. */
  loadingTitle: string;
  /** Description shown while the task is in flight. */
  loadingMessage: string;
  /**
   * Called once the task resolves (the loading toast is already removed).
   * Own the success follow-up here if provided.
   */
  onSuccess?: (result: T) => void;
  /**
   * Called once the task rejects (the loading toast is already removed).
   * Own the error follow-up here if provided.
   */
  onError?: (err: unknown) => void;
  /** Default success toast text, used only when `onSuccess` is omitted. */
  successMessage?: string;
  /** Default error toast builder, used only when `onError` is omitted. */
  errorMessage?: (err: unknown) => string;
  successDuration?: number;
  errorDuration?: number;
}

/**
 * Central entry point for surfacing notifications in the app.
 *
 * Two forms:
 *  - Sync:  `notify(message, type?, duration?)` — shows an in-app toast and
 *    raises a Tauri OS notification. Returns the new notification id.
 *  - Async: `notify(options, task)` — shows a loading toast, runs `task`, then
 *    transitions to a success/error toast. The loading toast is always removed.
 */
export function notify(message: unknown, type?: NotificationType, duration?: number): string;
export function notify<T = unknown>(
  options: NotifyAsyncOptions<T>,
  task: () => Promise<T>,
): Promise<T>;
export function notify(...args: unknown[]): string | Promise<unknown> {
  const store = useNotificationStore.getState();

  // Async form: notify(options, task)
  if (args.length >= 2 && typeof args[1] === "function") {
    const [options, task] = args as [NotifyAsyncOptions, () => Promise<unknown>];
    const loadingId = store.addLoadingNotification({
      title: options.loadingTitle,
      message: options.loadingMessage,
    });
    return task().then(
      (result) => {
        store.removeNotification(loadingId);
        if (options.onSuccess) {
          options.onSuccess(result);
        } else if (options.successMessage) {
          store.addNotification(options.successMessage, "success", options.successDuration ?? 3000);
        }
        return result;
      },
      (err) => {
        store.removeNotification(loadingId);
        if (options.onError) {
          options.onError(err);
        } else {
          const msg = options.errorMessage ? options.errorMessage(err) : toStr(err);
          store.addNotification(msg, "error", options.errorDuration ?? 8000);
        }
        throw err;
      },
    );
  }

  // Sync form: notify(message, type?, duration?)
  const [message, type, duration] = args as [unknown, NotificationType?, number?];
  return store.addNotification(message, type, duration);
}

export const notifyError = (m: unknown, duration?: number) => notify(m, "error", duration);
export const notifyInfo = (m: unknown, duration?: number) => notify(m, "info", duration);
export const notifySuccess = (m: unknown, duration?: number) => notify(m, "success", duration);

/* ------------------------------------------------------------------ */
/* Viewport                                                            */
/* ------------------------------------------------------------------ */

const MAX_VISIBLE = 5;

const STYLES: Record<
  NotificationItem["type"],
  { border: string; icon: ReactElement; iconColor: string }
> = {
  error: {
    border: "border-red-500/20",
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
  loading: {
    border: "border-[#4F8CFF]/30",
    icon: <Loader2 size={16} className="animate-spin" />,
    iconColor: "text-[#4F8CFF]",
  },
};

const cardClass = (border: string) =>
  `pointer-events-auto relative flex items-start gap-2.5 overflow-hidden rounded-sm border ${border} bg-surface-container-high/95 px-3.5 py-3 shadow-[0_2px_14px_rgba(0,0,0,0.55)] backdrop-blur`;

// Shared stacked-card layout: each card overlaps the one beneath it slightly
// and stacks above by z-index, giving a deck-of-cards look.
const stackItem = (i: number) => ({
  style: { zIndex: i, marginTop: i === 0 ? 0 : -45 },
});

// Always render at most the {@link MAX_VISIBLE} most recent notifications. Older
// ones stay in the store but are not rendered until a visible one is dismissed
// (or auto-expires), which makes the slice shift and reveal the next one.
const visibleSlice = (items: NotificationItem[]) => items.slice(-MAX_VISIBLE);

/**
 * One notification card. Shared by {@link Toaster} (normal) and
 * {@link AsyncNotify} (loading) — the only difference is `showProgress`, which
 * renders the indeterminate bottom bar for in-flight toasts.
 *
 * Long messages are clamped to two lines; when the text overflows, a `show
 * more` affordance is pinned to the end of the last line (no new line) and
 * toggles the full text inline.
 */
function BaseNotification({ n, showProgress }: { n: NotificationItem; showProgress?: boolean }) {
  const remove = useNotificationStore((s) => s.removeNotification);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const textRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const measure = () => setOverflowing(el.scrollHeight - el.clientHeight > 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [n.message]);

  const style = STYLES[n.type];
  const canToggle = overflowing || expanded;

  return (
    <div role="alert" className={cardClass(style.border)}>
      <span className={`mt-0.5 shrink-0 ${style.iconColor}`}>{style.icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold leading-tight text-on-surface">{n.title}</p>
        <div className="relative">
          <p
            ref={textRef}
            className={`mt-0.5 whitespace-pre-wrap break-words text-[12px] leading-snug text-on-surface-variant ${
              expanded ? "" : "line-clamp-2"
            } ${!expanded && overflowing ? "pr-16" : ""}`}
          >
            {n.message}
          </p>
          {canToggle && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="absolute bottom-0 right-0 rounded bg-surface-container-high px-1 text-[11px] font-medium text-[#4F8CFF] hover:underline"
            >
              {expanded ? "show less" : "show more"}
            </button>
          )}
        </div>
      </div>
      <button
        aria-label="Dismiss notification"
        onClick={() => remove(n.id)}
        className="shrink-0 rounded-md p-0.5 text-on-surface-variant transition-colors hover:bg-white/[0.06] hover:text-on-surface"
      >
        <X size={14} />
      </button>
      {showProgress && (
        <div className="absolute inset-x-0 bottom-0 h-0.5 bg-white/5">
          <div className="h-full w-1/3 rounded-full bg-[#4F8CFF] animate-[loading-bar_1.2s_ease-in-out_infinite]" />
        </div>
      )}
    </div>
  );
}

/**
 * Renders the non-loading notifications (success / error / info) in a stacked
 * list, capped at {@link MAX_VISIBLE}. Loading toasts are handled by
 * {@link AsyncNotify}.
 */
function Toaster() {
  const notifications = useNotificationStore((s) => s.notifications);
  const visible = visibleSlice(notifications.filter((n) => n.type !== "loading"));
  if (visible.length === 0) return null;

  return (
    <div className="flex w-[340px] max-w-[calc(100vw-2rem)] flex-col">
      {visible.map((n, i) => (
        <div key={n.id} {...stackItem(i)}>
          <BaseNotification n={n} />
        </div>
      ))}
    </div>
  );
}

/**
 * Renders the in-flight (loading) notifications via {@link BaseNotification}
 * with its indeterminate bottom progress bar. The normal {@link Toaster} never
 * shows a loading state.
 */
export function AsyncNotify() {
  const notifications = useNotificationStore((s) => s.notifications);
  const visible = visibleSlice(notifications.filter((n) => n.type === "loading"));
  if (visible.length === 0) return null;

  return (
    <div className="flex w-[340px] max-w-[calc(100vw-2rem)] flex-col">
      {visible.map((n, i) => (
        <div key={n.id} {...stackItem(i)}>
          <BaseNotification n={n} showProgress />
        </div>
      ))}
    </div>
  );
}

/**
 * Fixed viewport that stacks the async (loading) notifications above the normal
 * ones, so a loading toast resolves into a success/error toast in the same
 * corner without the two stacks overlapping.
 */
export function NotificationView() {
  return (
    <div className="pointer-events-none fixed bottom-12 right-4 z-[9999] flex w-[340px] max-w-[calc(100vw-2rem)] flex-col gap-2">
      <AsyncNotify />
      <Toaster />
    </div>
  );
}
