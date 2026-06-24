import { invoke } from "@tauri-apps/api/core";
import { ProviderName, ProcessInfo } from "@aurora/types";

// ─── Config types mirrored from Rust side ────────────────────────────────
export interface TerminalConfig {
  shell: string;
  font_family: string;
  font_size: number;
  scrollback: number;
  theme: string;
  cursor_style: string;
  cursor_blink: boolean;
}

export interface AiConfig {
  active_provider: string;
  auto_explain: boolean;
  context_lines: number;
  anthropic: ProviderConfig;
  openai: ProviderConfig;
  gemini: ProviderConfig;
  nvidia: ProviderConfig;
  ollama: ProviderConfig;
}

export interface ProviderConfig {
  fast_model: string;
  balanced_model: string;
  powerful_model: string;
  base_url: string | null;
}

export interface KeybindingsConfig {
  mode: string;
  open_palette: string;
  open_ai_bar: string;
  new_tab: string;
  close_tab: string;
  split_h: string;
  split_v: string;
}

export interface AppearanceConfig {
  compact_ui: boolean;
  show_statusbar: boolean;
  blur_sidebar: boolean;
}

export interface UiStateConfig {
  sidebar_collapsed: boolean;
  tab_bar_visible: boolean;
  pinned_tabs: string[];
  workspace_cwd?: string;
}

export interface AppConfig {
  terminal: TerminalConfig;
  ai: AiConfig;
  keybindings: KeybindingsConfig;
  appearance: AppearanceConfig;
  ui: UiStateConfig;
}

export const pty = {
  spawn: (shell: string, args: string[], env: Record<string, string>, cwd?: string, sessionId?: string) =>
    invoke<string>("pty_spawn", { shell, args, env, cwd, sessionId }),

  write: (sessionId: string, data: string) =>
    invoke<void>("pty_write", { sessionId, data }),

  resize: (sessionId: string, cols: number, rows: number) =>
    invoke<void>("pty_resize", { sessionId, cols, rows }),

  kill: (sessionId: string) =>
    invoke<void>("pty_kill", { sessionId }),
};

export const ai = {
  translateCommand: (query: string, context: string) =>
    invoke<void>("ai_translate_command", { query, context }),

  explainError: (command: string, output: string, exitCode: number) =>
    invoke<void>("ai_explain_error", { command, output, exitCode }),

  saveApiKey: (provider: ProviderName, key: string) =>
    invoke<void>("ai_save_api_key", { provider, key }),

  deleteApiKey: (provider: ProviderName) =>
    invoke<void>("ai_delete_api_key", { provider }),

  testProvider: (provider: ProviderName) =>
    invoke<boolean>("ai_test_provider", { provider }),

  getProviderStatus: () =>
    invoke<Record<ProviderName, boolean>>("ai_provider_status"),
};

export const history = {
  search: (query: string, limit: number) =>
    invoke<any[]>("history_search", { query, limit }),

  add: (entry: any) =>
    invoke<void>("history_add", { entry }),
};

export const config = {
  get: () => invoke<AppConfig>("config_get"),
  set: (appConfig: AppConfig) => invoke<void>("config_set", { config: appConfig }),
};

export const process = {
  list: () => invoke<ProcessInfo[]>("process_list"),
  kill: (pid: number) => invoke<void>("process_kill", { pid }),
};

export interface GitCommit {
  hash: string;
  parents: string[];
  author: string;
  date: string;
  message: string;
}

export interface GitRef {
  name: string;
  commit_hash: string;
}

export interface GitLogResult {
  commits: GitCommit[];
  branches: GitRef[];
  tags: GitRef[];
  current_branch: string | null;
}

export interface ChangedFile {
  status: string;
  file_path: string;
}

export const system = {
  getCurrentPwd: () =>
    invoke<string>("get_current_pwd"),
  revealInExplorer: (path: string) =>
    invoke<void>("reveal_in_explorer", { path }),
  getGitBranch: (cwd: string) =>
    invoke<string | null>("get_git_branch", { cwd }),
  getGitLog: (cwd: string) =>
    invoke<GitLogResult>("get_git_log", { cwd }),
  getGitFileLog: (cwd: string, filePath: string) =>
    invoke<GitLogResult>("get_git_file_log", { cwd, filePath }),
  getGitGraph: (cwd: string) =>
    invoke<string>("get_git_graph", { cwd }),
  getGitFileDiff: (cwd: string, filePath: string, commitHash: string) =>
    invoke<string>("get_git_file_diff", { cwd, filePath, commitHash }),
  getGitCommitDiff: (cwd: string, commitHash: string) =>
    invoke<string>("get_git_commit_diff", { cwd, commitHash }),
  getGitFileContentAtCommit: (cwd: string, filePath: string, commitHash: string) =>
    invoke<string>("get_git_file_content_at_commit", { cwd, filePath, commitHash }),
  getGitCommitFiles: (cwd: string, commitHash: string) =>
    invoke<ChangedFile[]>("get_git_commit_files", { cwd, commitHash }),
  getAvailableCommands: () =>
    invoke<string[]>("get_available_commands"),
};
