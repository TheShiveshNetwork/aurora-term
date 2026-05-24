export type TabType = "terminal" | "file";

export interface Tab {
  id: string;
  name: string;
  type: TabType;
  shell?: string;
  cwd?: string;
  filePath?: string;
  dirty?: boolean;
  fileContent?: string;
  created_at: number;
}

export interface SessionState {
  tabs: Tab[];
  activeTabId: string | null;
}
