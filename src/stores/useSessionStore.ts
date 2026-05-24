import { create } from "zustand";
import { Tab } from "../types/session";

interface SessionStore {
  tabs: Tab[];
  activeTabId: string | null;
  addTab: (tab: Tab) => void;
  removeTab: (id: string) => void;
  setActiveTabId: (id: string) => void;
  updateTabCwd: (id: string, cwd: string) => void;
  updateTab: (id: string, partial: Partial<Tab>) => void;
  reorderTabs: (fromIndex: number, toIndex: number) => void;
}

export const useSessionStore = create<SessionStore>((set) => ({
  tabs: [],
  activeTabId: null,
  addTab: (tab) =>
    set((state) => ({
      tabs: [...state.tabs, tab],
      activeTabId: state.activeTabId || tab.id,
    })),
  removeTab: (id) =>
    set((state) => {
      const filteredTabs = state.tabs.filter((t) => t.id !== id);
      let newActiveTabId = state.activeTabId;
      if (state.activeTabId === id) {
        newActiveTabId = filteredTabs.length > 0 ? filteredTabs[filteredTabs.length - 1].id : null;
      }
      return {
        tabs: filteredTabs,
        activeTabId: newActiveTabId,
      };
    }),
  setActiveTabId: (id) => set({ activeTabId: id }),
  updateTabCwd: (id, cwd) =>
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, cwd } : t)),
    })),
  updateTab: (id, partial) =>
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, ...partial } : t)),
    })),
  reorderTabs: (fromIndex, toIndex) =>
    set((state) => {
      const tabs = [...state.tabs];
      const [moved] = tabs.splice(fromIndex, 1);
      tabs.splice(toIndex, 0, moved);
      return { tabs };
    }),
}));
