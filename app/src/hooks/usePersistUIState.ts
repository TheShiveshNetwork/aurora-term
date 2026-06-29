import { useEffect, useRef } from "react";
import { useAppShellStore } from "../stores/useAppShellStore";
import { useSessionStore } from "../stores/useSessionStore";
import { state } from "../lib/ipc";

export function usePersistUIState() {
  const dirtyRef = useRef(false);
  const latestRef = useRef({
    sidebarCollapsed: useAppShellStore.getState().sidebarCollapsed,
    tabBarVisible: useAppShellStore.getState().tabBarVisible,
    pinnedTabs: useSessionStore.getState().tabs.filter((t) => t.pinned).map((t) => t.id),
    sectionVisibility: { ...useAppShellStore.getState().sectionVisibility },
    projectDir: useAppShellStore.getState().projectDir,
    workspaceCwd: useAppShellStore.getState().cwdAbsolute,
    openTabs: useSessionStore.getState().tabs.map((t) => ({
      id: t.id,
      tab_type: t.type,
      title: t.name || "",
      cwd: t.cwd || "",
      pinned: !!t.pinned,
      file_path: t.filePath || null,
      shell: t.shell || null,
    })),
    activeTabId: useSessionStore.getState().activeTabId,
  });

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useRef(() => {
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    const {
      sidebarCollapsed, tabBarVisible, pinnedTabs, sectionVisibility,
      projectDir, workspaceCwd, openTabs, activeTabId,
    } = latestRef.current;

    // Save UI toggles to state.json
    state.updateSidebar(sidebarCollapsed, tabBarVisible).catch(() => {});
    state.updatePinnedTabs(pinnedTabs).catch(() => {});
    if (sectionVisibility) {
      state.updateSectionVisibility(sectionVisibility).catch(() => {});
    }
    if (projectDir) {
      state.setProjectDir(projectDir).catch(() => {});
    }
    if (workspaceCwd) {
      state.setWorkspaceCwd(workspaceCwd).catch(() => {});
    }
    state.updateTabs(openTabs, activeTabId).catch(() => {});
  });

  useEffect(() => {
    const scheduleWrite = () => {
      dirtyRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush.current, 1000);
    };

    const unsub1 = useAppShellStore.subscribe((s) => {
      const { sidebarCollapsed, tabBarVisible, sectionVisibility, projectDir, cwdAbsolute } = s;
      const l = latestRef.current;
      l.sidebarCollapsed = sidebarCollapsed;
      l.tabBarVisible = tabBarVisible;
      l.sectionVisibility = { ...sectionVisibility };
      l.projectDir = projectDir;
      l.workspaceCwd = cwdAbsolute;
      scheduleWrite();
    });

    const unsub2 = useSessionStore.subscribe((s) => {
      const pinned = s.tabs.filter((t) => t.pinned).map((t) => t.id);
      latestRef.current.pinnedTabs = pinned;
      latestRef.current.openTabs = s.tabs.map((t) => ({
        id: t.id,
        tab_type: t.type,
        title: t.name || "",
        cwd: t.cwd || "",
        pinned: !!t.pinned,
        file_path: t.filePath || null,
        shell: t.shell || null,
      }));
      latestRef.current.activeTabId = s.activeTabId;
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
