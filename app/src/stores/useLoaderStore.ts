import { create } from "zustand";

interface LoaderStore {
  /// Number of in-flight background operations (LSP setup, Ctrl+click file
  /// navigation, …). The status-bar spinner is shown while this is > 0. A counter
  /// (not a boolean) is used so overlapping operations compose safely: the spinner
  /// stays on until every starter has also stopped.
  count: number;
  /// Mark a background operation as started (spinner on while count > 0).
  start: () => void;
  /// Mark a background operation as finished. Clamped so count never goes negative.
  stop: () => void;
}

export const useLoaderStore = create<LoaderStore>((set) => ({
  count: 0,
  start: () => set((s) => ({ count: s.count + 1 })),
  stop: () => set((s) => ({ count: Math.max(0, s.count - 1) })),
}));

/// Convenience hook for UI that only needs to know whether anything is loading.
/// The status bar uses this to decide whether to render the spinner.
export function useIsLoading(): boolean {
  return useLoaderStore((s) => s.count > 0);
}
