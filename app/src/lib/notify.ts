import { useNotificationStore } from "../stores/useToastStore";
import { notifyNative } from "./osNotify";

type NotificationType = "error" | "info" | "success";

export { notifyNative };

/**
 * Central entry point for surfacing errors/notifications in the app.
 * Always shows an in-app toast; the store also raises a Tauri OS notification
 * for every entry so the user gets the OS-level alert alongside the toast.
 */
export function notify(
  message: unknown,
  type: NotificationType = "error",
  duration?: number
): string {
  return useNotificationStore
    .getState()
    .addNotification(message, type, duration);
}

export const notifyError = (m: unknown, duration?: number) =>
  notify(m, "error", duration);
export const notifyInfo = (m: unknown, duration?: number) =>
  notify(m, "info", duration);
export const notifySuccess = (m: unknown, duration?: number) =>
  notify(m, "success", duration);
