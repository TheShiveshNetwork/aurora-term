import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ProviderName } from "@aurora/types";

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
  groq: ProviderConfig;
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
  project_dir?: string;
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

export const config = {
  get: () => invoke<AppConfig>("config_get"),
  set: (appConfig: AppConfig) => invoke<void>("config_set", { config: appConfig }),
};

export interface FileNode {
  name: string;
  path: string;
  is_dir: boolean;
  is_gitignored?: boolean;
  children?: FileNode[];
}

export interface SystemInfo {
  ram_used_mb: number;
  ram_total_mb: number;
  git_branch: string | null;
  encoding: string;
}

export interface AgentStepResult {
  status: string;
  command?: string;
  explanation?: string;
  subagent?: string;
  message?: string;
}

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
  has_more: boolean;
}

export interface ChangedFile {
  status: string;
  file_path: string;
}

export interface GitStatusEntry {
  path: string;
  x: string;
  y: string;
}

export interface GitBranchInfo {
  name: string;
  current: boolean;
  remote: string | null;
  ahead: number;
  behind: number;
  commit_hash: string;
}

// Deduplicate concurrent file reads — when openFile starts reading a file
// before the FileViewer mounts, both calls share the same in-flight promise.
const pendingFileReads = new Map<string, Promise<string>>();

export function preloadFileContent(path: string): void {
  if (!pendingFileReads.has(path)) {
    pendingFileReads.set(path, invoke<string>("read_file_content", { path }));
  }
}

export const system = {
  getCwd: () =>
    invoke<string>("get_cwd"),
  getCurrentPwd: () =>
    invoke<string>("get_current_pwd"),
  getSystemInfo: (cwd?: string, force?: boolean) =>
    invoke<SystemInfo>("get_system_info", { cwd, force }),
  readDir: (path: string) =>
    invoke<FileNode[]>("read_dir", { path }),
  searchFiles: (root: string, query: string) =>
    invoke<FileNode[]>("search_files", { root, query }),
  readFileContent: async (path: string) => {
    const pending = pendingFileReads.get(path);
    if (pending) {
      pendingFileReads.delete(path);
      return pending;
    }
    return invoke<string>("read_file_content", { path });
  },
  readFileBase64: (path: string) =>
    invoke<string>("read_file_base64", { path }),
  writeFileContent: (path: string, content: string) =>
    invoke<void>("write_file_content", { path, content }),
  selectFolder: () =>
    invoke<string | null>("select_folder"),
  selectFile: () =>
    invoke<string | null>("select_file"),
  deletePath: (path: string) =>
    invoke<void>("delete_path", { path }),
  renamePath: (oldPath: string, newName: string) =>
    invoke<string>("rename_path", { oldPath, newName }),
  copyPath: (source: string, targetDir: string) =>
    invoke<string>("copy_path", { source, targetDir }),
  movePath: (source: string, targetDir: string) =>
    invoke<string>("move_path", { source, targetDir }),
  createPath: (parentDir: string, name: string, isDir: boolean) =>
    invoke<string>("create_path", { parentDir, name, isDir }),
  watchDirectory: (path: string) =>
    invoke<void>("watch_directory", { path }),
  watchGit: (cwd: string) =>
    invoke<void>("watch_git", { cwd }),
  readShellHistory: () =>
    invoke<string[]>("read_shell_history"),
  agentPlanStep: (taskId: string, sessionId: string | null, goal: string | null, lastOutput: string | null, exitCode: number | null) =>
    invoke<AgentStepResult>("agent_plan_step", { taskId, sessionId, goal, lastOutput, exitCode }),
  revealInExplorer: (path: string) =>
    invoke<void>("reveal_in_explorer", { path }),
  getCwdInfo: (cwd: string) =>
    invoke<{ git_branch: string | null }>("get_cwd_info", { cwd }),
  getGitBranch: (cwd: string) =>
    invoke<string | null>("get_git_branch", { cwd }),
  getGitLog: (cwd: string, maxCount?: number, skip?: number) =>
    invoke<GitLogResult>("get_git_log", { cwd, maxCount, skip }),
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
  gitStatus: (cwd: string) =>
    invoke<GitStatusEntry[]>("git_status", { cwd }),
  gitAdd: (cwd: string, paths: string[]) =>
    invoke<void>("git_add", { cwd, paths }),
  gitReset: (cwd: string, paths: string[]) =>
    invoke<void>("git_reset", { cwd, paths }),
  gitRestore: (cwd: string, paths: string[]) =>
    invoke<void>("git_restore", { cwd, paths }),
  gitCommit: (cwd: string, message: string) =>
    invoke<string>("git_commit", { cwd, message }),
  gitPush: (cwd: string, remote: string, branch: string) =>
    invoke<string>("git_push", { cwd, remote, branch }),
  gitPull: (cwd: string, remote: string, branch: string) =>
    invoke<string>("git_pull", { cwd, remote, branch }),
  gitFetch: (cwd: string, remote: string) =>
    invoke<string>("git_fetch", { cwd, remote }),
  gitCheckout: (cwd: string, branch: string, createNew?: boolean) =>
    invoke<void>("git_checkout", { cwd, branch, createNew }),
  gitBranchCreate: (cwd: string, name: string, startPoint?: string) =>
    invoke<void>("git_branch_create", { cwd, name, startPoint }),
  gitBranchDelete: (cwd: string, branch: string, force?: boolean) =>
    invoke<void>("git_branch_delete", { cwd, branch, force }),
  gitBranchList: (cwd: string) =>
    invoke<GitBranchInfo[]>("git_branch_list", { cwd }),
  gitDiffUnstaged: (cwd: string, path?: string) =>
    invoke<string>("git_diff_unstaged", { cwd, path }),
  gitDiffStaged: (cwd: string, path?: string) =>
    invoke<string>("git_diff_staged", { cwd, path }),
  gitLogOneline: (cwd: string, count?: number) =>
    invoke<string>("git_log_oneline", { cwd, count }),
  gitClone: (url: string, targetDir: string) =>
    invoke<void>("git_clone", { url, targetDir }),
  gitRemoteList: (cwd: string) =>
    invoke<string[]>("git_remote_list", { cwd }),
  gitExec: (cwd: string, args: string[]) =>
    invoke<string>("git_exec", { cwd, args }),
};
