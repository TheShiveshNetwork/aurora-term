import { v4 as uuidv4 } from "uuid";
import { system } from "./ipc";
import { useSessionStore } from "../stores/useSessionStore";

export async function getFileDiffAtCommit(
  cwd: string,
  filePath: string,
  hash: string
): Promise<[string, string]> {
  const [oldContent, newContent] = await Promise.all([
    system.getGitFileContentAtCommit(cwd, filePath, `${hash}~1`),
    system.getGitFileContentAtCommit(cwd, filePath, hash),
  ]);
  return [oldContent, newContent];
}

export function openDiffTab(
  addTab: (tab: any) => void,
  setActiveTabId: (id: string) => void,
  filePath: string,
  hash: string,
  oldContent: string,
  newContent: string
): void {
  const existing = useSessionStore.getState().tabs.find(
    t => t.type === "diff" && t.filePath === filePath && t.diffCommitHash === hash
  );
  if (existing) { setActiveTabId(existing.id); return; }

  const fileName = filePath.split(/[\\/]/).pop() || filePath;
  const id = uuidv4();
  addTab({
    id,
    name: `Diff: ${fileName} @ ${hash.slice(0, 7)}`,
    type: "diff",
    filePath,
    diffOldContent: oldContent,
    diffNewContent: newContent,
    diffCommitHash: hash,
    created_at: Date.now(),
  });
  setActiveTabId(id);
}
