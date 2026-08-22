import { create } from "zustand";
import { update, UpdateInfo } from "../lib/ipc";
import { openUrl } from "@tauri-apps/plugin-opener";

const MIN_INTERVAL_MS = 60 * 60 * 1000;

interface UpdateStore {
  info: UpdateInfo | null;
  checking: boolean;
  installing: boolean;
  installError: string | null;
  /** Begin (or restart) background update checking. Returns a stop function. */
  start: (enabled: boolean) => () => void;
  refresh: () => Promise<void>;
  dismiss: () => Promise<void>;
  /** Download and run the installer from the release cache; falls back to
   *  opening the release URL if the artifact can't be fetched/run. */
  install: () => Promise<void>;
  openRelease: () => void;
}

export const useUpdateStore = create<UpdateStore>((set, get) => {
  let seq = 0;
  let timer: ReturnType<typeof setInterval> | null = null;

  const refresh = async () => {
    const id = ++seq;
    set({ checking: true });
    try {
      const result = await update.check();
      if (id === seq) set({ info: result });
    } catch {
      // Keep the previous result on transient failures.
    } finally {
      if (id === seq) set({ checking: false });
    }
  };

  const dismiss = async () => {
    const info = get().info;
    if (!info || !info.available) return;
    await update.dismiss(info.latest_version);
    set((s) => (s.info ? { info: { ...s.info, available: false, dismissed: true } } : s));
  };

  const openRelease = () => {
    const url = get().info?.url;
    if (url) openUrl(url).catch(() => {});
  };

  const install = async () => {
    set({ installing: true, installError: null });
    try {
      await update.install();
    } catch (e: any) {
      // Defensive fallback: if we couldn't fetch/run the installer artifact
      // (e.g. the URL points at a release page rather than a direct asset),
      // open the release URL so the user can install manually.
      const url = get().info?.url;
      if (url) openUrl(url).catch(() => {});
      set({ installError: String(e?.message ?? e) });
    } finally {
      set({ installing: false });
    }
  };

  const start = (enabled: boolean) => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    seq++;
    if (!enabled) {
      set({ info: null, checking: false });
      return () => {};
    }
    refresh();
    timer = setInterval(refresh, MIN_INTERVAL_MS);
    return () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      seq++;
    };
  };

  return {
    info: null,
    checking: false,
    installing: false,
    installError: null,
    start,
    refresh,
    dismiss,
    install,
    openRelease,
  };
});
