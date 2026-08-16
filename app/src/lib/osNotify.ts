import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

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
 * Fire an OS-level (Tauri) notification. Best-effort only — never throws.
 * Fires regardless of window focus so the user always receives the OS
 * notification alongside the in-app toast.
 */
export async function notifyNative(opts: {
  title: string;
  body: string;
}): Promise<void> {
  if (!isTauri()) return;
  try {
    const granted = permissionResolved ?? (await ensurePermission());
    if (!granted) return;
    sendNotification({ title: opts.title, body: opts.body });
  } catch {
    /* native notification is best-effort only */
  }
}
