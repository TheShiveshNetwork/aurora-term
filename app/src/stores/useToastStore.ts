import { create } from "zustand";
import { v4 as uuidv4 } from "uuid";
import { notifyNative } from "../lib/osNotify";

const ERROR_VARIANTS = ["Io", "Pty", "Ai", "Db", "Config", "Sidecar"] as const;

const VARIANT_TITLE: Record<string, string> = {
  Io: "Git Error",
  Pty: "Terminal Error",
  Ai: "AI Error",
  Db: "Database Error",
  Config: "Config Error",
  Sidecar: "Sidecar Error",
};

export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  type: "error" | "info" | "success" | "loading";
  duration?: number;
}

interface NotificationStore {
  notifications: NotificationItem[];
  addNotification: (message: unknown, type?: NotificationItem["type"], duration?: number) => string;
  addLoadingNotification: (opts: { title: string; message: string }) => string;
  removeNotification: (id: string) => void;
}

function extractTitle(v: unknown): string | undefined {
  if (!v || typeof v !== "object") return undefined;
  for (const key of Object.keys(v)) {
    if (ERROR_VARIANTS.includes(key as any)) {
      return VARIANT_TITLE[key] ?? `${key} Error`;
    }
  }
  return undefined;
}

function extractDescription(obj: Record<string, unknown>): string | undefined {
  for (const val of Object.values(obj)) {
    if (typeof val === "string" && val.length > 0) return val;
  }
  return undefined;
}

export function toStr(v: unknown): string {
  if (typeof v === "string") return v;
  if (v instanceof Error) return v.message;
  if (v !== null && v !== undefined && typeof v === "object") {
    if ("message" in v) {
      const m = (v as any).message;
      if (typeof m === "string") return m;
      if (m !== undefined && m !== null) return String(m);
    }
    const desc = extractDescription(v as Record<string, unknown>);
    if (desc) return desc;
    try {
      const json = JSON.stringify(v);
      if (json && json !== "{}" && json !== '{"message":""}') return json;
    } catch {}
    return "An unknown error occurred";
  }
  return String(v);
}

export const useNotificationStore = create<NotificationStore>((set) => ({
  notifications: [],
  addNotification: (message, type = "error", duration = 5000) => {
    const id = uuidv4();

    let title = type === "error" ? "Error" : type === "success" ? "Success" : "Information";
    let text = "";

    if (typeof message === "string") {
      text = message;
    } else if (message instanceof Error) {
      text = message.message;
    } else if (message !== null && message !== undefined && typeof message === "object") {
      const extractedTitle = extractTitle(message);
      if (extractedTitle) title = extractedTitle;
      const obj = message as Record<string, unknown>;
      const desc = extractDescription(obj);
      if (desc) {
        text = desc;
      } else if ("message" in obj) {
        const m = obj.message;
        text = typeof m === "string" ? m : m !== undefined && m !== null ? String(m) : JSON.stringify(obj);
      } else {
        try {
          const json = JSON.stringify(obj);
          text = json && json !== "{}" ? json : "An unknown error occurred";
        } catch {
          text = "An unknown error occurred";
        }
      }
    } else {
      text = String(message);
    }

    set((s) => ({ notifications: [...s.notifications, { id, title, message: text, type, duration }] }));

    // Raise an OS-level (Tauri) notification alongside the in-app toast so the
    // user always gets the alert, even when the app window is not focused.
    void notifyNative({ title, body: text });

    if (duration > 0) {
      setTimeout(() => {
        set((s) => ({ notifications: s.notifications.filter((n) => n.id !== id) }));
      }, duration);
    }
    return id;
  },
  removeNotification: (id) => {
    set((s) => ({ notifications: s.notifications.filter((n) => n.id !== id) }));
  },
  addLoadingNotification: ({ title, message }) => {
    const id = uuidv4();
    set((s) => ({
      notifications: [...s.notifications, { id, title, message, type: "loading" }],
    }));
    return id;
  },
}));

// ---- backward compat aliases -----
/** @deprecated Use useNotificationStore instead */
export const useToastStore = useNotificationStore;
