export type TabType = "terminal" | "file" | "diff" | "git" | "merge";

export interface Tab {
  id: string;
  name: string;
  type: TabType;
  shell?: string;
  cwd?: string;
  filePath?: string;
  dirty?: boolean;
  fileContent?: string;
  diffOldContent?: string;
  diffNewContent?: string;
  diffContent?: string;
  diffCommitHash?: string;
  created_at: number;
  pinned?: boolean;
  missing?: boolean;
  everChanged?: boolean;
  streaming?: boolean;
  manuallyRenamed?: boolean;
  scrollToLine?: number;
  scrollToMatchStart?: number;
  scrollToMatchEnd?: number;
}

export interface SessionState {
  tabs: Tab[];
  activeTabId: string | null;
}