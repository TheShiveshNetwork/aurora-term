import { useMemo } from "react";
import { Tab } from "@aurora/types";

export function useTargetSessionId(tabs: Tab[], activeTabId: string | null): string | null {
  return useMemo(() => {
    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (!activeTab) return null;
    if (activeTab.type === "terminal") return activeTab.id;
    const firstTerminal = tabs.find((t) => t.type === "terminal");
    return firstTerminal?.id ?? null;
  }, [tabs, activeTabId]);
}
