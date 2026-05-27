import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { v4 as uuidv4 } from "uuid";
import { pty } from "../lib/ipc";
import { useSessionStore } from "../stores/useSessionStore";
import { useBlockStore } from "../stores/useBlockStore";
import { Tab } from "../types/session";

// Strip ANSI/VT100 escape sequences — keeps block output_summary clean for AI
const stripAnsi = (s: string) =>
  s.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, "")
   .replace(/__AURORA_(?:CWD|BRANCH)__=[^\r\n]*/g, "") // strip sentinel lines
   .replace(/\r/g, ""); // normalise carriage returns

export function usePTY() {
  const store = useSessionStore();
  const { tabs, activeTabId, addTab, removeTab, setActiveTabId, updateTab } = store;

  useEffect(() => {
    // ── Single global pty_data listener ──────────────────────────────────────
    // This is the ONLY place we call listen("pty_data"). It dispatches a
    // per-session synchronous DOM CustomEvent so that each TerminalPane can
    // subscribe with a regular addEventListener (no async, no cleanup races).
    const unsubscribeData = getCurrentWindow().listen<{ session_id: string; data: string }>(
      "pty_data",
      (event) => {
        const { session_id, data } = event.payload;

        // Update block store for the running block in this session.
        // Strip ANSI escape codes before storing so output_summary is
        // clean plain text (used by AI features and copy operations).
        const state = useBlockStore.getState();
        const blockId = state.runningBlockId[session_id];
        state.setCommandOutputReceived(session_id, true);
        if (blockId) {
          state.appendBlockOutput(session_id, blockId, stripAnsi(data));
        }

        // Dispatch a synchronous per-session DOM event. OutputRenderer
        // subscribes to this and processes the raw ANSI stream for display.
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
          state.finalizeBlock(session_id, blockId, exit_code);
          state.setCommandOutputReceived(session_id, false);
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
    cwd?: string,
    existingSessionId?: string
  ) => {
    try {
      const sessionId = await pty.spawn(shell, args, env, cwd, existingSessionId);

      const tab = tabs.find(t => t.id === sessionId);
      if (!tab) {
        const newTab: Tab = {
          id: sessionId,
          name: `Terminal (${shell.split(".")[0]})`,
          type: "terminal",
          shell,
          cwd: cwd || "~",
          created_at: Date.now(),
        };

        addTab(newTab);
        setActiveTabId(sessionId);
      }

      return sessionId;
    } catch (err) {
      console.error("Failed to spawn PTY session:", err);
      throw err;
    }
  };

  const killSession = async (sessionId: string) => {
    const tab = tabs.find(t => t.id === sessionId);
    if (tab?.type === "file") {
      removeTab(sessionId);
      return;
    }
    try {
      await pty.kill(sessionId);
      removeTab(sessionId);
    } catch (err) {
      console.error("Failed to kill PTY session:", err);
    }
  };

  const openFile = (filePath: string, cwd?: string) => {
    const existing = tabs.find(t => t.type === "file" && t.filePath === filePath);
    if (existing) {
      setActiveTabId(existing.id);
      return existing.id;
    }

    const fileId = uuidv4();
    const fileName = filePath.split(/[/\\]/).pop() || filePath;

    const newTab: Tab = {
      id: fileId,
      name: fileName,
      type: "file",
      filePath,
      cwd,
      created_at: Date.now(),
    };

    addTab(newTab);
    setActiveTabId(fileId);

    return fileId;
  };

  return {
    tabs,
    activeTabId,
    spawnSession,
    killSession,
    openFile,
    setActiveTabId,
  };
}
