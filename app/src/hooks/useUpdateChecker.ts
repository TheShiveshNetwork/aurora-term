import { useEffect, useRef, useState } from "react";
import { update, UpdateInfo } from "../lib/ipc";
import { openUrl } from "@tauri-apps/plugin-opener";

const MIN_INTERVAL_MS = 60 * 60 * 1000;

export interface UpdateCheckerState {
  info: UpdateInfo | null;
  checking: boolean;
  refresh: () => Promise<void>;
  dismiss: () => Promise<void>;
  openRelease: () => void;
}

/**
 * Polls the backend's GitHub Releases proxy on mount and then on the
 * configured interval. `dismissed` is decided by the Rust layer from
 * `state.json` (UiState.dismissed_update_version).
 */
export function useUpdateChecker(enabled: boolean, intervalHours: number): UpdateCheckerState {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const seq = useRef(0);

  const refresh = async () => {
    const id = ++seq.current;
    setChecking(true);
    try {
      const result = await update.check();
      if (id === seq.current) setInfo(result);
    } catch {
      // Keep the previous result on transient failures.
    } finally {
      if (id === seq.current) setChecking(false);
    }
  };

  const dismiss = async () => {
    if (!info || !info.available) return;
    await update.dismiss(info.latest_version);
    setInfo((prev) => (prev ? { ...prev, available: false, dismissed: true } : prev));
  };

  const openRelease = () => {
    if (!info || !info.url) return;
    openUrl(info.url).catch(() => {});
  };

  useEffect(() => {
    if (!enabled) {
      setInfo(null);
      return;
    }
    refresh();
    const intervalMs = Math.max(MIN_INTERVAL_MS, intervalHours * 60 * 60 * 1000);
    const timer = setInterval(refresh, intervalMs);
    return () => {
      clearInterval(timer);
      seq.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, intervalHours]);

  return { info, checking, refresh, dismiss, openRelease };
}
