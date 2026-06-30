export type TabType = "terminal" | "file" | "diff" | "git";

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
  everChanged?: boolean;
}

export interface SessionState {
  tabs: Tab[];
  activeTabId: string | null;
}