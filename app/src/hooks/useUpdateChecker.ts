import { useEffect } from "react";
import { UpdateInfo } from "../lib/ipc";
import { useUpdateStore } from "../stores/useUpdateStore";

export interface UpdateCheckerState {
  info: UpdateInfo | null;
  checking: boolean;
  refresh: () => Promise<void>;
  dismiss: () => Promise<void>;
  openRelease: () => void;
}

/**
 * Checks for app updates on mount (i.e. every app restart) and then on a fixed
 * background interval. The actual state lives in `useUpdateStore` (one instance
 * per webview) so multiple components (header button, account menu, settings
 * page) share a single source of truth and a single checker.
 * `dismissed` is decided by the Rust layer from `state.json`.
 */
export function useUpdateChecker(enabled: boolean): UpdateCheckerState {
  const info = useUpdateStore((s) => s.info);
  const checking = useUpdateStore((s) => s.checking);
  const refresh = useUpdateStore((s) => s.refresh);
  const dismiss = useUpdateStore((s) => s.dismiss);
  const openRelease = useUpdateStore((s) => s.openRelease);
  const start = useUpdateStore((s) => s.start);

  useEffect(() => {
    const stop = start(enabled);
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, start]);

  return { info, checking, refresh, dismiss, openRelease };
}
