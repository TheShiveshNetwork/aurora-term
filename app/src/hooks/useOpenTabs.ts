import { useSessionStore } from "../stores/useSessionStore";
import type { Tab } from "@aurora/types";

export type TabGroup = "terminal" | "editor";

export const EDITOR_LIKE_TYPES: Tab["type"][] = ["file", "diff", "git"];

export function tabGroup(type: Tab["type"]): TabGroup {
  return type === "terminal" ? "terminal" : "editor";
}

export function useOpenTabs() {
  const tabs = useSessionStore((s) => s.tabs);
  const activeTabId = useSessionStore((s) => s.activeTabId);
  const setActiveTabId = useSessionStore((s) => s.setActiveTabId);
  const reorderTabs = useSessionStore((s) => s.reorderTabs);
  const updateTab = useSessionStore((s) => s.updateTab);

  const sortedTabs = [...tabs].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return 0;
  });

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;

  return {
    tabs: sortedTabs,
    activeTabId,
    activeTab,
    setActiveTabId,
    reorderTabs,
    updateTab,
  };
}
