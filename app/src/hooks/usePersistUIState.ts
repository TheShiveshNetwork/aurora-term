import { useEffect, useRef } from "react";
import { useAppShellStore } from "../stores/useAppShellStore";
import { useSessionStore } from "../stores/useSessionStore";
import { config } from "../lib/ipc";

export function usePersistUIState() {
  const latestRef = useRef({
    sidebarCollapsed: useAppShellStore.getState().sidebarCollapsed,
    tabBarVisible: useAppShellStore.getState().tabBarVisible,
    pinnedTabs: useSessionStore.getState().tabs.filter((t) => t.pinned).map((t) => t.id),
    workspaceCwd: useAppShellStore.getState().cwdAbsolute,
  });

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const scheduleWrite = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        const { sidebarCollapsed, tabBarVisible, pinnedTabs, workspaceCwd } = latestRef.current;
        config.get()
          .then((cfg) => {
            cfg.ui.sidebar_collapsed = sidebarCollapsed;
            cfg.ui.tab_bar_visible = tabBarVisible;
            cfg.ui.pinned_tabs = pinnedTabs;
            cfg.ui.workspace_cwd = workspaceCwd || undefined;
            return config.set(cfg);
          })
          .catch(() => {});
      }, 300);
    };

    const unsub1 = useAppShellStore.subscribe((state) => {
      latestRef.current.sidebarCollapsed = state.sidebarCollapsed;
      latestRef.current.tabBarVisible = state.tabBarVisible;
      latestRef.current.workspaceCwd = state.cwdAbsolute;
      scheduleWrite();
    });

    const unsub2 = useSessionStore.subscribe((state) => {
      const pinned = state.tabs.filter((t) => t.pinned).map((t) => t.id);
      latestRef.current.pinnedTabs = pinned;
      scheduleWrite();
    });

    return () => {
      unsub1();
      unsub2();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);
}
