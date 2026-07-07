import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification"
import { useNotificationStore } from "../stores/useToastStore"

let permissionGranted: boolean | null = null

async function ensurePermission(): Promise<boolean> {
  if (permissionGranted !== null) return permissionGranted
  try {
    let granted = await isPermissionGranted()
    if (!granted) {
      const result = await requestPermission()
      granted = result === "granted"
    }
    permissionGranted = granted
    return granted
  } catch {
    return false
  }
}

export async function showError(message: unknown, duration?: number) {
  useNotificationStore.getState().addNotification(message, "error", duration)
  try {
    if (document.hidden && (await ensurePermission())) {
      sendNotification({ title: "Aurora", body: useNotificationStore.getState().notifications.slice(-1)[0]?.message ?? "Error" })
    }
  } catch (e) {
    console.error("Failed to send OS notification:", e)
  }
}

export async function showInfo(message: unknown, duration?: number) {
  useNotificationStore.getState().addNotification(message, "info", duration)
}

export async function showSuccess(message: unknown, duration?: number) {
  useNotificationStore.getState().addNotification(message, "success", duration)
}
