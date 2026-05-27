import { invoke } from "@tauri-apps/api/core";
import { ProviderName } from "../types/ai";
import { ProcessInfo } from "../types/ipc";

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
  get: () => invoke<any>("config_get"),
  set: (appConfig: any) => invoke<void>("config_set", { config: appConfig }),
};

export const process = {
  list: () => invoke<ProcessInfo[]>("process_list"),
  kill: (pid: number) => invoke<void>("process_kill", { pid }),
};

export const system = {
  getCurrentPwd: () =>
    invoke<string>("get_current_pwd"),
  revealInExplorer: (path: string) =>
    invoke<void>("reveal_in_explorer", { path }),
  getGitBranch: (cwd: string) =>
    invoke<string | null>("get_git_branch", { cwd }),
};
