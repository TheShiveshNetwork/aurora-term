import { create } from "zustand";

export type AppViewMode = "terminal" | "file" | "agent";

export type AppContextMenu = {
  x: number;
  y: number;
  selectedText?: string;
  source?: "terminal" | "input" | "file";
  filePath?: string;
} | null;

export type SideSection = "folders" | "open-tabs" | "outline" | "timeline" | "git";

interface AppShellStore {
  sidebarCollapsed: boolean;
  showSettings: boolean;
  showAiBar: boolean;
  chatInputOpen: boolean;
  showMenuDropdown: boolean;
  tabBarVisible: boolean;
  viewMode: AppViewMode;
  contextMenu: AppContextMenu;
  pendingCloseTabId: string | null;
  lastActiveTerminalId: string | null;
  lastActiveFileId: string | null;
  cwd: string;
  cwdAbsolute: string;
  sessionCwds: Record<string, string>;
  shellHistory: string[];
  commandInputs: Record<string, string>;
  interactedSessions: Record<string, true>;
  isCwdLoading: boolean;
  sectionVisibility: Record<SideSection, boolean>;

  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebarCollapsed: () => void;
  setShowSettings: (show: boolean) => void;
  setShowAiBar: (show: boolean) => void;
  setChatInputOpen: (open: boolean) => void;
  toggleChatInputOpen: () => void;
  setShowMenuDropdown: (show: boolean) => void;
  toggleShowMenuDropdown: () => void;
  setTabBarVisible: (visible: boolean) => void;
  toggleTabBarVisible: () => void;
  setViewMode: (mode: AppViewMode) => void;
  setContextMenu: (menu: AppContextMenu) => void;
  clearContextMenu: () => void;
  setPendingCloseTabId: (tabId: string | null) => void;
  setLastActiveTerminalId: (tabId: string | null) => void;
  setLastActiveFileId: (tabId: string | null) => void;
  setCwd: (cwd: string) => void;
  setCwdAbsolute: (cwdAbsolute: string) => void;
  setWorkspaceCwd: (cwdAbsolute: string) => void;
  setSessionCwd: (sessionId: string, cwd: string) => void;
  setShellHistory: (history: string[]) => void;
  setCommandInput: (sessionId: string, value: string) => void;
  appendCommandInput: (sessionId: string, value: string) => void;
  clearCommandInput: (sessionId: string) => void;
  markSessionInteracted: (sessionId: string) => void;
  clearSessionInteracted: (sessionId: string) => void;
  setIsCwdLoading: (loading: boolean) => void;
  toggleSection: (section: SideSection) => void;
  setSectionVisibility: (sections: Partial<Record<SideSection, boolean>>) => void;
}

function workspaceLabel(cwdAbsolute: string): string {
  const parts = cwdAbsolute.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? `~/${parts[parts.length - 1]}` : "~/workspace";
}

export const useAppShellStore = create<AppShellStore>((set) => ({
  sidebarCollapsed: false,
  showSettings: false,
  showAiBar: false,
  chatInputOpen: true,
  showMenuDropdown: false,
  tabBarVisible: true,
  viewMode: "terminal",
  contextMenu: null,
  pendingCloseTabId: null,
  lastActiveTerminalId: null,
  lastActiveFileId: null,
  cwd: "~/workspace",
  cwdAbsolute: "",
  sessionCwds: {},
  shellHistory: [],
  commandInputs: {},
  interactedSessions: {},
  isCwdLoading: false,
  sectionVisibility: {
    folders: true,
    "open-tabs": true,
    outline: false,
    timeline: false,
    git: false,
  },

  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  toggleSidebarCollapsed: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setShowSettings: (show) => set({ showSettings: show }),
  setShowAiBar: (show) => set({ showAiBar: show }),
  setChatInputOpen: (chatInputOpen) => set({ chatInputOpen }),
  toggleChatInputOpen: () => set((state) => ({ chatInputOpen: !state.chatInputOpen })),
  setShowMenuDropdown: (show) => set({ showMenuDropdown: show }),
  toggleShowMenuDropdown: () => set((state) => ({ showMenuDropdown: !state.showMenuDropdown })),
  setTabBarVisible: (visible) => set({ tabBarVisible: visible }),
  toggleTabBarVisible: () => set((state) => ({ tabBarVisible: !state.tabBarVisible })),
  setViewMode: (mode) => set({ viewMode: mode }),
  setContextMenu: (contextMenu) => set({ contextMenu }),
  clearContextMenu: () => set({ contextMenu: null }),
  setPendingCloseTabId: (pendingCloseTabId) => set({ pendingCloseTabId }),
  setLastActiveTerminalId: (lastActiveTerminalId) => set({ lastActiveTerminalId }),
  setLastActiveFileId: (lastActiveFileId) => set({ lastActiveFileId }),
  setCwd: (cwd) => set({ cwd }),
  setCwdAbsolute: (cwdAbsolute) => set({ cwdAbsolute }),
  setWorkspaceCwd: (cwdAbsolute) =>
    set({ cwdAbsolute, cwd: workspaceLabel(cwdAbsolute) }),
  setSessionCwd: (sessionId, cwd) =>
    set((state) => ({
      sessionCwds: {
        ...state.sessionCwds,
        [sessionId]: cwd,
      },
    })),
  setShellHistory: (shellHistory) => set({ shellHistory }),
  setCommandInput: (sessionId, value) =>
    set((state) => ({
      commandInputs: {
        ...state.commandInputs,
        [sessionId]: value,
      },
    })),
  appendCommandInput: (sessionId, value) =>
    set((state) => ({
      commandInputs: {
        ...state.commandInputs,
        [sessionId]: (state.commandInputs[sessionId] || "") + value,
      },
    })),
  clearCommandInput: (sessionId) =>
    set((state) => {
      const copy = { ...state.commandInputs };
      delete copy[sessionId];
      return { commandInputs: copy };
    }),
  markSessionInteracted: (sessionId) =>
    set((state) => ({
      interactedSessions: {
        ...state.interactedSessions,
        [sessionId]: true,
      },
    })),
  clearSessionInteracted: (sessionId) =>
    set((state) => {
      const copy = { ...state.interactedSessions };
      delete copy[sessionId];
      return { interactedSessions: copy };
    }),
  setIsCwdLoading: (isCwdLoading) => set({ isCwdLoading }),
  toggleSection: (section) =>
    set((state) => ({
      sectionVisibility: {
        ...state.sectionVisibility,
        [section]: !state.sectionVisibility[section],
      },
    })),
  setSectionVisibility: (sections) =>
    set((state) => ({
      sectionVisibility: {
        ...state.sectionVisibility,
        ...sections,
      },
    })),
}));