import { emit } from "@tauri-apps/api/event";

export const GIT_DIFF_TAB_EVENT = "git-open-diff-tab";

export interface GitDiffTabPayload {
  id: string;
  name: string;
  type: "diff";
  filePath?: string;
  diffContent?: string;
  diffOldContent?: string;
  diffNewContent?: string;
  diffCommitHash?: string;
  created_at: number;
}

export function isGitViewWindow(): boolean {
  return typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("gitview");
}

export async function openDiffTabInMainWindow(payload: GitDiffTabPayload): Promise<void> {
  await emit(GIT_DIFF_TAB_EVENT, payload);
}
