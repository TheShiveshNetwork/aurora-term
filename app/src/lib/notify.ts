import {
  isPermissionGranted,
  requestPermission,
  notify,
} from "@tauri-apps/plugin-notification";
import { useNotificationStore, toStr } from "../stores/useToastStore";

type NotificationType = "error" | "info" | "success";

const isTauri = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

let permissionResolved: boolean | null = null;

async function ensurePermission(): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    let granted = await isPermissionGranted();
    if (granted === null) {
      const res = await requestPermission();
      granted =
        typeof res === "string"
          ? res === "granted"
          : Boolean((res as { granted?: boolean })?.granted);
    }
    permissionResolved = Boolean(granted);
    return permissionResolved;
  } catch {
    return false;
  }
}

/**
 * Fire an OS-level (Tauri) notification. We skip it while the app window is
 * focused so it doesn't double up with the in-app toast, and we never throw —
 * the in-app toast is the source of truth.
 */
export async function notifyNative(opts: {
  title: string;
  body: string;
}): Promise<void> {
  if (!isTauri()) return;
  if (typeof document !== "undefined" && document.hasFocus()) return;
  try {
    const granted = permissionResolved ?? (await ensurePermission());
    if (!granted) return;
    await notify({ title: opts.title, body: opts.body });
  } catch {
    /* native notification is best-effort only */
  }
}

/**
 * Central entry point for surfacing errors/notifications in the app.
 * Always shows an in-app toast; errors additionally raise an OS notification.
 */
export function notify(
  message: unknown,
  type: NotificationType = "error",
  duration?: number
): string {
  const id = useNotificationStore
    .getState()
    .addNotification(message, type, duration);
  if (type === "error") {
    void notifyNative({ title: "Aurora", body: toStr(message) });
  }
  return id;
}

export const notifyError = (m: unknown, duration?: number) =>
  notify(m, "error", duration);
export const notifyInfo = (m: unknown, duration?: number) =>
  notify(m, "info", duration);
export const notifySuccess = (m: unknown, duration?: number) =>
  notify(m, "success", duration);
