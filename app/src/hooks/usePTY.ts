import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { v4 as uuidv4 } from "uuid";
import { preloadFileContent, pty } from "../lib/ipc";
import { useSessionStore } from "../stores/useSessionStore";
import { useBlockStore } from "../stores/useBlockStore";
import { Tab } from "@aurora/types";
import { cleanPtyData, stripAnsi } from "../lib/terminal/cleanup";

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
          const { cleanData } = cleanPtyData(data);
          state.appendBlockOutput(session_id, blockId, stripAnsi(cleanData));
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
      const isWin = window.navigator.userAgent.includes("Windows");
      const mergedEnv = { ...env };
      if (!isWin && shell.includes("bash")) {
        mergedEnv["PROMPT_COMMAND"] = 'echo "__AURORA_CWD__=$(pwd);EXIT_CODE=$?"';
      }
      const sessionId = await pty.spawn(shell, args, mergedEnv, cwd, existingSessionId);

      const tab = useSessionStore.getState().tabs.find(t => t.id === sessionId);
      if (!tab) {
        const currentTabs = useSessionStore.getState().tabs;
        let maxNum = 0;
        currentTabs.forEach((t) => {
          if (t.type === "terminal") {
            const match = t.name.match(/^Terminal\s+(\d+)$/i);
            if (match) {
              const num = parseInt(match[1], 10);
              if (num > maxNum) {
                maxNum = num;
              }
            }
          }
        });
        const terminalNumber = maxNum + 1;

        const newTab: Tab = {
          id: sessionId,
          name: `Terminal ${terminalNumber}`,
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
    if (tab?.type === "file" || tab?.type === "diff" || tab?.type === "git") {
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

    const fileName = filePath.split(/[/\\]/).pop() || filePath;

    // Look for an unchanged, unpinned file tab to reuse
    const reuseTab = tabs.find(t => t.type === "file" && t.everChanged === false && !t.pinned);
    if (reuseTab) {
      updateTab(reuseTab.id, {
        name: fileName,
        filePath,
        cwd,
        dirty: false,
        everChanged: false,
        fileContent: undefined,
      });
      setActiveTabId(reuseTab.id);
      preloadFileContent(filePath);
      return reuseTab.id;
    }

    const fileId = uuidv4();
    const newTab: Tab = {
      id: fileId,
      name: fileName,
      type: "file",
      filePath,
      cwd,
      created_at: Date.now(),
      everChanged: false,
    };

    addTab(newTab);
    setActiveTabId(fileId);

    // Start reading file content immediately, in parallel with React rendering.
    // The FileViewer will pick up the in-flight or cached result.
    preloadFileContent(filePath);

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
