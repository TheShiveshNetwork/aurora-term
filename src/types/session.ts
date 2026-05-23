export interface Tab {
  id: string;
  name: string;
  shell: string;
  cwd: string;
  created_at: number;
}

export interface SessionState {
  tabs: Tab[];
  activeTabId: string | null;
}
