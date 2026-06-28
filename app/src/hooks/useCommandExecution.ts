import { useCallback, useEffect, useMemo, type FormEvent } from "react";
import { v4 as uuidv4 } from "uuid";

import { pty } from "../lib/ipc";
import { useAppShellStore } from "../stores/useAppShellStore";
import { useBlockStore } from "../stores/useBlockStore";
import { useSessionStore } from "../stores/useSessionStore";
import { Tab } from "@aurora/types";
import { Block } from "@aurora/types";

export function useCommandExecution(tabs: Tab[], activeTabId: string | null) {
  const commandInputs = useAppShellStore((state) => state.commandInputs);
  const shellHistory = useAppShellStore((state) => state.shellHistory);
  const cwd = useAppShellStore((state) => state.cwd);
  const cwdAbsolute = useAppShellStore((state) => state.cwdAbsolute);
  const isCwdLoading = useAppShellStore((state) => state.isCwdLoading);
  const setCommandInput = useAppShellStore((state) => state.setCommandInput);
  const clearCommandInput = useAppShellStore((state) => state.clearCommandInput);
  const setIsCwdLoading = useAppShellStore((state) => state.setIsCwdLoading);
  const markSessionInteracted = useAppShellStore((state) => state.markSessionInteracted);
  const clearSessionInteracted = useAppShellStore((state) => state.clearSessionInteracted);

  const activeTab = useMemo(() => tabs.find((tab) => tab.id === activeTabId) || null, [activeTabId, tabs]);
  const targetSessionId = activeTab?.type === "file"
    ? (tabs.find((tab) => tab.type === "terminal")?.id ?? activeTabId)
    : activeTabId;

  const activeRunningBlockId = useBlockStore((state) => targetSessionId ? state.runningBlockId[targetSessionId] : null);
  const addBlock = useBlockStore((state) => state.addBlock);
  const updateBlock = useBlockStore((state) => state.updateBlock);
  const alternateBufferActive = useSessionStore((state) => state.alternateBufferActive);

  const activeCommandInput = activeTabId ? commandInputs[activeTabId] ?? "" : "";
  
  const activeTabBlocks = useMemo(() => {
    if (!targetSessionId) return [];
    return useBlockStore.getState().blocks[targetSessionId] || [];
  }, [targetSessionId]);

  const activeRunningBlock = useMemo(() => {
    if (!activeRunningBlockId) return null;
    return activeTabBlocks.find((block) => block.id === activeRunningBlockId) || null;
  }, [activeRunningBlockId, activeTabBlocks]);

  const isCommandRunning = activeRunningBlock?.status === "running";
  const isAlternateActive = activeTabId ? alternateBufferActive[activeTabId] || false : false;

  const setInput = useCallback((value: string | ((previous: string) => string)) => {
    if (!activeTabId) return;
    const current = commandInputs[activeTabId] ?? "";
    const next = typeof value === "function" ? value(current) : value;
    if (next === "" && !(activeTabId in commandInputs)) return;
    setCommandInput(activeTabId, next);
  }, [activeTabId, commandInputs, setCommandInput]);

  useEffect(() => {
    if (!activeTabId || !activeRunningBlockId) return;
    if (activeRunningBlock?.status === "running") return;

    useBlockStore.getState().setRunningBlockId(activeTabId, null);
    useBlockStore.getState().setCommandOutputReceived(activeTabId, false);
  }, [activeRunningBlock?.status, activeRunningBlockId, activeTabId]);

  useEffect(() => {
    if (!isCommandRunning && activeTab?.type === "terminal") {
      const timer = setTimeout(() => {
        window.dispatchEvent(new CustomEvent("aurora-focus-terminal-input", { detail: { sessionId: activeTabId } }));
      }, 50);

      return () => clearTimeout(timer);
    }
  }, [activeTabId, activeTab?.type, isCommandRunning]);

  const handleExecuteCommand = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    if (!activeCommandInput.trim() || !activeTabId) return;

    const currentTab = tabs.find((tab) => tab.id === activeTabId);
    const targetId = currentTab?.type === "file"
      ? tabs.find((tab) => tab.type === "terminal")?.id
      : activeTabId;

    if (!targetId) return;

    const cmd = activeCommandInput;
    clearCommandInput(activeTabId);

    const cmdLower = cmd.trim().toLowerCase();
    if (cmdLower === "clear" || cmdLower === "cls" || cmdLower === "clear-host") {
      useBlockStore.getState().clearBlocks(targetId);
      clearSessionInteracted(targetId);

      window.dispatchEvent(new CustomEvent("terminal-clear", { detail: { sessionId: targetId } }));

      const isWindows = window.navigator.userAgent.toLowerCase().includes("windows");
      const clearCommand = isWindows ? "cls\r\n" : "clear\r\n";
      await pty.write(targetId, clearCommand);
      return;
    }

    const blockId = uuidv4();
    const newBlock: Block = {
      id: blockId,
      session_id: targetId,
      command: cmd,
      started_at: Date.now(),
      status: "running",
      output_type: "plain",
      collapsed: false,
      bookmarked: false,
      output_summary: "",
      anchor_row: 0,
      output_row_end: 0,
      anchor_y: 0,
    };

    useBlockStore.getState().setRunningBlockId(targetId, blockId);
    useBlockStore.getState().setCommandOutputReceived(targetId, false);
    addBlock(targetId, newBlock);

    try {
      markSessionInteracted(targetId);
      window.dispatchEvent(new CustomEvent(`pty-command-run:${targetId}`, { detail: { cmd } }));

      // Write user command
      await pty.write(targetId, `${cmd}\r`);
    } catch (error) {
      console.error("Failed to write command to shell:", error);
      updateBlock(targetId, blockId, {
        status: "error",
        finished_at: Date.now(),
        output_summary: `Error writing command to shell: ${error}`,
      });
      useBlockStore.getState().setRunningBlockId(targetId, null);
    }
  }, [activeCommandInput, activeTabId, addBlock, clearCommandInput, clearSessionInteracted, markSessionInteracted, setIsCwdLoading, tabs, updateBlock]);

  const handleStopCurrentCommand = useCallback(() => {
    if (!targetSessionId || !activeRunningBlockId || !isCommandRunning) return;

    pty.write(targetSessionId, "\u0003").catch(console.error);
    useBlockStore.getState().updateBlock(targetSessionId, activeRunningBlockId, {
      status: "cancelled",
      finished_at: Date.now(),
    });
    useBlockStore.getState().setRunningBlockId(targetSessionId, null);
    useBlockStore.getState().setCommandOutputReceived(targetSessionId, false);
  }, [activeRunningBlockId, isCommandRunning, targetSessionId]);

  return {
    activeCommandInput,
    setCommandInput: setInput,
    handleExecuteCommand,
    handleStopCurrentCommand,
    shellHistory,
    cwd,
    cwdAbsolute,
    isCwdLoading,
    isCommandRunning,
    isAlternateActive,
    activeTab,
    activeTabBlocks,
    activeRunningBlockId,
    targetSessionId,
  };
}