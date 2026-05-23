import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { pty } from "../lib/ipc";
import { useSessionStore } from "../stores/useSessionStore";
import { useBlockStore } from "../stores/useBlockStore";
import { Tab } from "../types/session";

export function usePTY() {
  const { tabs, activeTabId, addTab, removeTab, setActiveTabId } = useSessionStore();

  useEffect(() => {
    // ── Single global pty_data listener ──────────────────────────────────────
    // This is the ONLY place we call listen("pty_data"). It dispatches a
    // per-session synchronous DOM CustomEvent so that each TerminalPane can
    // subscribe with a regular addEventListener (no async, no cleanup races).
    const unsubscribeData = getCurrentWindow().listen<{ session_id: string; data: string }>(
      "pty_data",
      (event) => {
        const { session_id, data } = event.payload;

        // Update block store for the running block in this session
        const state = useBlockStore.getState();
        const blockId = state.runningBlockId[session_id];
        if (blockId) {
          state.appendBlockOutput(session_id, blockId, data);
        }

        // Dispatch a synchronous per-session DOM event so TerminalPane
        // can receive it without any async subscription setup.
        window.dispatchEvent(
          new CustomEvent(`pty-session-data:${session_id}`, { detail: data })
        );
      }
    );

    // ── Single global pty_exit listener ──────────────────────────────────────
    const unsubscribeExit = getCurrentWindow().listen<{ session_id: string; exit_code: number }>(
      "pty_exit",
      (event) => {
        const { session_id, exit_code } = event.payload;

        const state = useBlockStore.getState();
        const blockId = state.runningBlockId[session_id];
        if (blockId) {
          state.updateBlock(session_id, blockId, {
            status: exit_code === 0 ? "success" : "error",
            exit_code,
            finished_at: Date.now(),
          });
          state.setRunningBlockId(session_id, null);
        }

        // Notify the TerminalPane for this session
        window.dispatchEvent(
          new CustomEvent(`pty-session-exit:${session_id}`, { detail: exit_code })
        );
      }
    );

    return () => {
      unsubscribeData.then((unsub) => unsub());
      unsubscribeExit.then((unsub) => unsub());
    };
  }, []);

  const spawnSession = async (
    shell: string = "powershell.exe",
    args: string[] = [],
    env: Record<string, string> = {},
    cwd?: string
  ) => {
    try {
      const sessionId = await pty.spawn(shell, args, env, cwd);

      const newTab: Tab = {
        id: sessionId,
        name: `Terminal (${shell.split(".")[0]})`,
        shell,
        cwd: cwd || "~",
        created_at: Date.now(),
      };

      addTab(newTab);
      setActiveTabId(sessionId);

      return sessionId;
    } catch (err) {
      console.error("Failed to spawn PTY session:", err);
      throw err;
    }
  };

  const killSession = async (sessionId: string) => {
    try {
      await pty.kill(sessionId);
      removeTab(sessionId);
    } catch (err) {
      console.error("Failed to kill PTY session:", err);
    }
  };

  return {
    tabs,
    activeTabId,
    spawnSession,
    killSession,
    setActiveTabId,
  };
}
