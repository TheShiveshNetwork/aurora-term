import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { v4 as uuidv4 } from "uuid";
import { preloadFileContent, pty } from "../lib/ipc";
import { useSessionStore } from "../stores/useSessionStore";
import { useBlockStore } from "../stores/useBlockStore";
import { Tab } from "@aurora/types";
import { cleanPtyData, stripAnsi } from "../lib/terminal/cleanup";

let listenersRegistered = false;
let unregisterData: (() => void) | null = null;
let unregisterExit: (() => void) | null = null;

function registerPtyListeners() {
  if (listenersRegistered) return;
  listenersRegistered = true;

  getCurrentWindow().listen<{ session_id: string; data: string }>(
    "pty_data",
    (event) => {
      const { session_id, data } = event.payload;

      const state = useBlockStore.getState();
      const blockId = state.runningBlockId[session_id];
      state.setCommandOutputReceived(session_id, true);
      if (blockId) {
        const { cleanData } = cleanPtyData(data);
        state.appendBlockOutput(session_id, blockId, stripAnsi(cleanData));
      }

      window.dispatchEvent(
        new CustomEvent(`pty-session-data:${session_id}`, { detail: data })
      );
    }
  ).then((unsub) => { unregisterData = unsub; });

  getCurrentWindow().listen<{ session_id: string; exit_code: number }>(
    "pty_exit",
    (event) => {
      const { session_id, exit_code } = event.payload;

      const state = useBlockStore.getState();
      const blockId = state.runningBlockId[session_id];
      if (blockId) {
        state.finalizeBlock(session_id, blockId, exit_code);
        state.setCommandOutputReceived(session_id, false);
      }

      window.dispatchEvent(
        new CustomEvent(`pty-session-exit:${session_id}`, { detail: exit_code })
      );
    }
  ).then((unsub) => { unregisterExit = unsub; });
}

export function usePTY() {
  const store = useSessionStore();
  const { tabs, activeTabId, addTab, removeTab, setActiveTabId, updateTab } = store;

  useEffect(() => {
    registerPtyListeners();
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
