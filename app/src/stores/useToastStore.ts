import { create } from "zustand";
import { v4 as uuidv4 } from "uuid";

export interface Toast {
  id: string;
  message: string;
  type: "error" | "info" | "success";
  duration?: number;
}

interface ToastStore {
  toasts: Toast[];
  addToast: (message: string, type?: Toast["type"], duration?: number) => string;
  removeToast: (id: string) => void;
}

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  addToast: (message, type = "error", duration = 5000) => {
    const id = uuidv4();
    set((s) => ({ toasts: [...s.toasts, { id, message, type, duration }] }));
    if (duration > 0) {
      setTimeout(() => {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
      }, duration);
    }
    return id;
  },
  removeToast: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));
