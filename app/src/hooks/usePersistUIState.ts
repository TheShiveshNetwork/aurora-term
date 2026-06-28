import { useEffect, useRef } from "react";
import { useAppShellStore } from "../stores/useAppShellStore";
import { useSessionStore } from "../stores/useSessionStore";
import { config } from "../lib/ipc";

export function usePersistUIState() {
  const dirtyRef = useRef(false);
  const latestRef = useRef({
    sidebarCollapsed: useAppShellStore.getState().sidebarCollapsed,
    tabBarVisible: useAppShellStore.getState().tabBarVisible,
    pinnedTabs: useSessionStore.getState().tabs.filter((t) => t.pinned).map((t) => t.id),
    workspaceCwd: useAppShellStore.getState().cwdAbsolute,
    projectDir: useAppShellStore.getState().projectDir,
  });

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useRef(() => {
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    const { sidebarCollapsed, tabBarVisible, pinnedTabs, workspaceCwd, projectDir } = latestRef.current;
    config.get()
      .then((cfg) => {
        cfg.ui.sidebar_collapsed = sidebarCollapsed;
        cfg.ui.tab_bar_visible = tabBarVisible;
        cfg.ui.pinned_tabs = pinnedTabs;
        cfg.ui.workspace_cwd = workspaceCwd || undefined;
        cfg.ui.project_dir = projectDir || undefined;
        return config.set(cfg);
      })
      .catch(() => {});
  });

  useEffect(() => {
    const scheduleWrite = () => {
      dirtyRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush.current, 5000);
    };

    let prevSidebarCollapsed = latestRef.current.sidebarCollapsed;
    let prevTabBarVisible = latestRef.current.tabBarVisible;
    let prevWorkspaceCwd = latestRef.current.workspaceCwd;
    let prevProjectDir = latestRef.current.projectDir;

    const unsub1 = useAppShellStore.subscribe((state) => {
      if (
        state.sidebarCollapsed === prevSidebarCollapsed &&
        state.tabBarVisible === prevTabBarVisible &&
        state.cwdAbsolute === prevWorkspaceCwd &&
        state.projectDir === prevProjectDir
      ) {
        return;
      }
      prevSidebarCollapsed = state.sidebarCollapsed;
      prevTabBarVisible = state.tabBarVisible;
      prevWorkspaceCwd = state.cwdAbsolute;
      prevProjectDir = state.projectDir;

      latestRef.current.sidebarCollapsed = state.sidebarCollapsed;
      latestRef.current.tabBarVisible = state.tabBarVisible;
      latestRef.current.workspaceCwd = state.cwdAbsolute;
      latestRef.current.projectDir = state.projectDir;
      scheduleWrite();
    });

    let prevPinned = JSON.stringify(latestRef.current.pinnedTabs);

    const unsub2 = useSessionStore.subscribe((state) => {
      const pinned = state.tabs.filter((t) => t.pinned).map((t) => t.id);
      const pinnedStr = JSON.stringify(pinned);
      if (pinnedStr === prevPinned) {
        return;
      }
      prevPinned = pinnedStr;

      latestRef.current.pinnedTabs = pinned;
      scheduleWrite();
    });

    const onUnload = () => flush.current();

    window.addEventListener("beforeunload", onUnload);

    return () => {
      unsub1();
      unsub2();
      window.removeEventListener("beforeunload", onUnload);
      if (timerRef.current) clearTimeout(timerRef.current);
      flush.current();
    };
  }, []);
}
