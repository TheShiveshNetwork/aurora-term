export interface PtyDataEvent {
  session_id: string;
  data: string;
}

export interface PtyExitEvent {
  session_id: string;
  exit_code: number;
}

export interface AIStreamChunkEvent {
  request_id: string;
  chunk: string;
  done: boolean;
}

export interface ProcessSpawnedEvent {
  pid: number;
  command: string;
  session_id: string;
}

export interface ProcessInfo {
  pid: number;
  command: string;
  status: string;
}

// ─── UI State (from state.json) ─────────────────────────

export interface SavedTab {
  id: string;
  tab_type: string;
  title: string;
  cwd: string;
  pinned: boolean;
  file_path: string | null;
  shell: string | null;
}

export interface UiState {
  sidebar_collapsed: boolean;
  tab_bar_visible: boolean;
  pinned_tabs: string[];
  section_visibility: Record<string, boolean>;
  open_tabs: SavedTab[];
  active_tab_id: string | null;
  last_project_dir: string | null;
  last_workspace_cwd: string | null;
}
