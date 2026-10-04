import { useCallback } from "react";

import { useAgentStore, type TurnFileChange } from "../stores/useAgentStore";
import { useNotificationStore } from "../stores/useToastStore";
import { system } from "../lib/ipc";
import { resolveAgentPath } from "../lib/agentPaths";

export interface RevertTurnResult {
  restoredFiles: number;
  /** Files left alone because they changed after the agent wrote them. */
  conflicts: string[];
  /** Files restored that could not be verified against the agent's output. */
  unverified: string[];
}

async function readIfPresent(path: string): Promise<string | null> {
  const exists = await system.pathExists(path);
  return exists ? await system.readFileContent(path) : null;
}

export type RestoreAction =
  /** Put the pre-turn content back. */
  | "restore"
  /** The agent created the file, so undo removes it. */
  | "delete"
  /** Changed after the agent wrote it — leave it alone. */
  | "conflict"
  /** Recorded before written-content capture existed; restore unverified. */
  | "unverified";

/**
 * Decides what to do with one file when a turn is undone.
 *
 * The comparison is against `writtenContent` — what the agent's write actually
 * produced — not `previousContent`. Comparing against `previousContent` can
 * never succeed for a real write, because the file legitimately differs from
 * its prior contents; an earlier version did that and so refused every undo,
 * reporting "modified afterwards" for files the agent had just written.
 */
export function decideRestore(current: string | null, change: TurnFileChange): RestoreAction {
  if (change.writtenContent === undefined) {
    if (change.previousContent === null && current === null) return "restore";
    return "unverified";
  }
  if (current !== change.writtenContent) return "conflict";
  return change.previousContent === null ? "delete" : "restore";
}

/**
 * Undoes one chat turn: restores every file that turn wrote to its pre-turn
 * content, then drops the user's message and the agent's reply.
 *
 * Restoration only happens when the file still holds exactly what the agent
 * wrote (`writtenContent`). Comparing against `previousContent` instead — which
 * is what an earlier version did — can never succeed, because for any real
 * write the file legitimately differs from its prior contents; every revert was
 * refused as "modified afterwards". Comparing against the written output instead
 * means only a genuine later edit blocks the undo.
 *
 * Writes recorded before `writtenContent` existed cannot be verified. Those are
 * restored anyway, and reported, so undo is useful for existing history rather
 * than permanently refusing it.
 */
export function useRevertTurn() {
  const notify = useNotificationStore((s) => s.addNotification);

  return useCallback(
    async (sessionId: string, userMessageId: string): Promise<RevertTurnResult> => {
      const store = useAgentStore.getState();
      const session = store.sessions[sessionId];
      const result: RevertTurnResult = { restoredFiles: 0, conflicts: [], unverified: [] };
      if (!session) return result;

      const messages = session.chatHistory;
      const userIndex = messages.findIndex((m) => m.id === userMessageId);
      if (userIndex === -1) return result;

      const reply = messages[userIndex + 1]?.role === "assistant" ? messages[userIndex + 1] : null;
      const writes = [...(reply?.fileChanges ?? [])].reverse();

      for (const write of writes) {
        const path = resolveAgentPath(write.path);
        try {
          const current = await readIfPresent(path);
          const action = decideRestore(current, write);

          if (action === "conflict") {
            result.conflicts.push(path);
            continue;
          }
          if (action === "unverified") {
            result.unverified.push(path);
          }

          if (action === "delete") {
            if (current !== null) await system.deletePath(path);
          } else {
            await system.writeFileContent(path, write.previousContent ?? "");
          }

          result.restoredFiles++;
          window.dispatchEvent(
            new CustomEvent("aurora-refresh-file", { detail: { path } }),
          );
        } catch (error) {
          console.warn(`Failed to revert ${path}:`, error);
          result.conflicts.push(path);
        }
      }

      store.removeTurn(sessionId, userMessageId);

      if (result.conflicts.length > 0) {
        notify(
          `Reverted the message, but ${result.conflicts.length} file(s) were edited after the agent wrote them and were left untouched: ${result.conflicts.join(", ")}`,
          "error",
        );
      } else if (result.unverified.length > 0) {
        notify(
          `Reverted the message and restored ${result.restoredFiles} file(s). ${result.unverified.length} could not be verified against the agent's output: ${result.unverified.join(", ")}`,
          "info",
        );
      }

      return result;
    },
    [notify],
  );
}
