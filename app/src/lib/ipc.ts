import { invoke } from "@tauri-apps/api/core";
import { ProviderName, UiState, SavedTab, ModelInfo, SearchResult } from "@aurora/types";

// ─── Config types mirrored from Rust side ────────────────────────────────
export interface TerminalConfig {
  shell: string;
  font_family: string;
  font_size: number;
  scrollback: number;
  theme: string;
  cursor_style: string;
  cursor_blink: boolean;
  restore_tabs: boolean;
}

export interface AiConfig {
  active_provider: string;
  auto_explain: boolean;
  context_lines: number;
  require_review_for_commands: boolean;
  require_review_for_writes: boolean;
  anthropic: ProviderConfig;
  openai: ProviderConfig;
  gemini: ProviderConfig;
  nvidia: ProviderConfig;
  ollama: ProviderConfig;
  groq: ProviderConfig;
}

export interface ProviderConfig {
  enabled: boolean;
  fast_model: string;
  balanced_model: string;
  powerful_model: string;
  selected_model: string | null;
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
  overrides: Record<string, string>;
}

export interface AppearanceConfig {
  compact_ui: boolean;
  show_statusbar: boolean;
  blur_sidebar: boolean;
}

export interface EditorConfig {
  theme: string;
  show_minimap: boolean;
  git_gui_mode: string;
  word_wrap: boolean;
  ai_code_completion: boolean;
  ai_suggestions: boolean;
  indent_markers: boolean;
}

export interface CloudConfig {
  auto_sync: boolean;
  api_base_url: string;
}

export interface UpdatesConfig {
  enabled: boolean;
  check_interval_hours: number;
}

export interface AppConfig {
  terminal: TerminalConfig;
  ai: AiConfig;
  keybindings: KeybindingsConfig;
  appearance: AppearanceConfig;
  editor: EditorConfig;
  cloud: CloudConfig;
  updates: UpdatesConfig;
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

  getApiKey: (provider: ProviderName) =>
    invoke<string>("ai_get_api_key", { provider }),

  deleteApiKey: (provider: ProviderName) =>
    invoke<void>("ai_delete_api_key", { provider }),

  testProvider: (provider: ProviderName) =>
    invoke<boolean>("ai_test_provider", { provider }),

  getProviderStatus: () =>
    invoke<Record<ProviderName, boolean>>("ai_provider_status"),

  fetchModels: (provider: ProviderName) =>
    invoke<ModelInfo[]>("ai_fetch_models", { provider }),

  editCode: (prompt: string, codeBefore: string, codeAfter: string, selection: string) =>
    invoke<{ status: string; code?: string; message?: string }>("ai_edit_code", {
      prompt,
      codeBefore,
      codeAfter,
      selection,
    }),

  inlineComplete: (contextBefore: string, language: string) =>
    invoke<{ status: string; completion?: string }>("ai_inline_complete", {
      contextBefore,
      language,
    }),
};

export const config = {
  get: () => invoke<AppConfig>("config_get"),
  getGlobal: () => invoke<AppConfig>("config_get_global"),
  getProject: () => invoke<AppConfig | null>("config_get_project"),
  saveGlobal: (appConfig: AppConfig) => invoke<void>("config_save_global", { config: appConfig }),
  saveProject: (appConfig: AppConfig) => invoke<void>("config_save_project", { config: appConfig }),
  hasProject: () => invoke<boolean>("config_has_project"),
};

export const state = {
  get: () => invoke<UiState>("state_get"),
  updateSidebar: (collapsed: boolean, visible: boolean, showAiBar: boolean, chatInputOpen: boolean, fileChatInputOpen?: boolean) =>
    invoke<void>("state_update_sidebar", { collapsed, visible, showAiBar, chatInputOpen, fileChatInputOpen }),
  updatePinnedTabs: (pinned: string[]) =>
    invoke<void>("state_update_pinned_tabs", { pinned }),
  updateSectionVisibility: (sections: Record<string, boolean>) =>
    invoke<void>("state_update_section_visibility", { sections }),
  updateTabs: (tabs: SavedTab[], activeId: string | null) =>
    invoke<void>("state_update_tabs", { tabs, activeId }),
  setProjectDir: (path: string | null) =>
    invoke<void>("state_set_project_dir", { path }),
  setWorkspaceCwd: (path: string | null) =>
    invoke<void>("state_set_workspace_cwd", { path }),
  updateCheckedBranches: (projectDir: string, branches: string[]) =>
    invoke<void>("state_update_checked_branches", { projectDir, branches }),
};

// ─── Cloud sync types mirrored from Rust side ───────────────────────────
export type SyncStatus =
  | "synced"
  | "pushed"
  | "pulled"
  | "conflict"
  | "signed_out"
  | "disabled";

export interface SyncResult {
  status: SyncStatus;
  remote_payload: AppConfig | null;
  remote_version: string | null;
  remote_updated_at: string | null;
}

export type SyncAction = "keep_local" | "keep_cloud" | "merge";

export interface AuthStatus {
  signed_in: boolean;
  email: string | null;
}

export type UpdateStatus = "available" | "up_to_date" | "disabled" | "failed";

export interface UpdateInfo {
  status: UpdateStatus;
  available: boolean;
  current_version: string;
  latest_version: string;
  url: string | null;
  notes: string | null;
  published_at: string | null;
  dismissed: boolean;
}

export const cloud = {
  authStatus: () => invoke<AuthStatus>("cloud_auth_status"),
  signInPassword: (email: string, password: string) =>
    invoke<AuthStatus>("cloud_sign_in_password", { email, password }),
  signInOAuth: (provider: string) =>
    invoke<AuthStatus>("cloud_sign_in_oauth", { provider }),
  signOut: () => invoke<void>("cloud_sign_out"),
  syncNow: (config: AppConfig) => invoke<SyncResult>("cloud_sync_now", { config }),
  resolveConflict: (action: SyncAction, config: AppConfig, remoteVersion: string) =>
    invoke<SyncResult>("cloud_resolve_conflict", { action, config, remoteVersion }),
};

export const update = {
  check: () => invoke<UpdateInfo>("update_check"),
  dismiss: (version: string) => invoke<void>("update_dismiss", { version }),
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
  run_id?: string;
  tool_call_id?: string;
  tool_name?: string;
  args?: any;
}

export interface AgentChatResult {
  status: string;
  message?: string;
}

export interface AgentBtwResult {
  status: string;
  message?: string;
}

export interface AgentSkillInfo {
  name: string;
  path: string;
  source: "project" | "global";
  description?: string;
}

export interface AgentMcpInfo {
  name: string;
  type: string;
  command?: string;
  args?: string[];
  url?: string;
  description?: string;
  source: "project" | "global";
}

export interface AgentSkillsResult {
  status: string;
  project: AgentSkillInfo[];
  global: AgentSkillInfo[];
  total: number;
}

export interface AgentMcpResult {
  status: string;
  project: AgentMcpInfo[];
  global: AgentMcpInfo[];
  total: number;
}

export interface AgentFileContextResult {
  status: string;
  context?: string;
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
  searchInFiles: (
    root: string,
    query: string,
    includePatterns: string[],
    excludePatterns: string[],
    caseSensitive: boolean,
    maxResults?: number,
  ) => invoke<SearchResult[]>("search_in_files", { root, query, includePatterns, excludePatterns, caseSensitive, maxResults: maxResults ?? 2000 }),
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
  pathExists: (path: string) =>
    invoke<boolean>("path_exists", { path }),
  watchDirectory: (path: string) =>
    invoke<void>("watch_directory", { path }),
  watchFiles: (paths: string[]) =>
    invoke<void>("watch_files", { paths }),
  watchGit: (cwd: string) =>
    invoke<void>("watch_git", { cwd }),
  readShellHistory: () =>
    invoke<string[]>("read_shell_history"),
  agentPlanStep: (
    taskId: string,
    sessionId: string | null,
    goal: string | null,
    lastOutput: string | null,
    exitCode: number | null,
    agentType?: string,
    mode?: string,
    requireReviewForCommands?: boolean,
    requireReviewForWrites?: boolean,
    model?: string
  ) =>
    invoke<AgentStepResult>("agent_plan_step", {
      taskId,
      sessionId,
      goal,
      lastOutput,
      exitCode,
      agentType,
      mode,
      requireReviewForCommands,
      requireReviewForWrites,
      model,
    }),
  agentApproveTool: (
    agentType: string | undefined,
    mode: string | undefined,
    runId: string,
    toolCallId: string | undefined,
    resumeData?: any,
    sessionId?: string
  ) =>
    invoke<AgentStepResult>("agent_approve_tool", {
      agentType,
      mode,
      runId,
      toolCallId,
      resumeData,
      sessionId,
    }),
  agentDeclineTool: (
    agentType: string | undefined,
    mode: string | undefined,
    runId: string,
    toolCallId: string | undefined,
    sessionId?: string
  ) =>
    invoke<AgentStepResult>("agent_decline_tool", {
      agentType,
      mode,
      runId,
      toolCallId,
      sessionId,
    }),
  agentGetLogs: () =>
    invoke<{ status: string; logs: Array<{ timestamp: number; type: string; content: string }> }>("agent_get_logs"),
  agentGetThinking: (thread: string) =>
    invoke<{ status: string; thinking: string }>("agent_get_thinking", { thread }),
  agentChat: (
    message: string,
    sessionId?: string,
    taskId?: string,
    agentType?: string,
    mode?: string,
  ) =>
    invoke<AgentChatResult>("agent_chat", {
      sessionId,
      taskId,
      message,
      agentType,
      mode,
    }),
  agentBtw: (
    message: string,
    sessionId?: string,
    model?: string
  ) =>
    invoke<AgentBtwResult>("agent_btw", {
      sessionId,
      message,
      model,
    }),
  agentSkills: (cwd?: string) =>
    invoke<AgentSkillsResult>("agent_skills", { cwd }),
  agentMcp: (cwd?: string) =>
    invoke<AgentMcpResult>("agent_mcp", { cwd }),
  agentFileContext: (
    paths: string[],
    cwd?: string,
    previewChars?: number,
    selection?: { path: string; startLine: number; endLine: number; text: string } | null
  ) =>
    invoke<AgentFileContextResult>("agent_file_context", {
      paths,
      cwd,
      previewChars,
      selection,
    }),
  revealInExplorer: (path: string) =>
    invoke<void>("reveal_in_explorer", { path }),
  getCwdInfo: (cwd: string) =>
    invoke<{ git_branch: string | null }>("get_cwd_info", { cwd }),
  getGitBranch: (cwd: string) =>
    invoke<string | null>("get_git_branch", { cwd }),
  getGitLog: (cwd: string, maxCount?: number, skip?: number, branchNames?: string[]) =>
    invoke<GitLogResult>("get_git_log", { cwd, maxCount, skip, branches: branchNames ?? [] }),
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
  gitClean: (cwd: string, paths: string[]) =>
    invoke<void>("git_clean", { cwd, paths }),
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
  gitBranchListAll: (cwd: string) =>
    invoke<GitBranchInfo[]>("git_branch_list_all", { cwd }),
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
  gitIsRepo: (cwd: string) =>
    invoke<boolean>("git_is_repo", { cwd }),
};
