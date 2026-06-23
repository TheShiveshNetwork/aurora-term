import { useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { v4 as uuidv4 } from "uuid";
import { useAgentStore, AgentCommand } from "../stores/useAgentStore";
import { useBlockStore } from "../stores/useBlockStore";
import { pty } from "../lib/ipc";
import { Block } from "@aurora/types";

// Helper to determine if a command needs explicit manual confirmation
function isSensitiveCommand(cmd: string): boolean {
  const lower = cmd.toLowerCase().trim();
  
  // Destructive command flags and modification operations
  const sensitivePatterns = [
    /\brm\b/, /\bmv\b/, /\bcp\b/, /\bdel\b/, /\berase\b/,
    /\bwrite-content\b/, /\bout-file\b/, />/, />>/,
    /\bgit\s+push\b/, /\bgit\s+commit\b/,
    /\bpnpm\b/, /\bnpm\b/, /\byarn\b/, /\bbun\b/,
    /\bset-item\b/, /\bremove-item\b/, /\bcopy-item\b/, /\bmove-item\b/,
    /\bssh\b/, /\brsync\b/, /\bcurl\b/, /\bwget\b/, /\bftp\b/
  ];
  return sensitivePatterns.some(pattern => pattern.test(lower));
}

// Utility to wait for PTY command block execution to finalize in Zustand
// Resolves when block status changes from "running", with a 30s timeout fallback
function waitForBlockCompletion(sessionId: string, blockId: string): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve) => {
    let unsubscribe: (() => void) | null = null;

    // Timeout fallback: if the block never finalizes, resolve with partial output
    const timeoutId = setTimeout(() => {
      if (unsubscribe) unsubscribe();
      const state = useBlockStore.getState();
      const sessionBlocks = state.blocks[sessionId] || [];
      const block = sessionBlocks.find(b => b.id === blockId);
      // Force-finalize the block so state is consistent
      if (block && block.status === "running") {
        useBlockStore.getState().updateBlock(sessionId, blockId, {
          status: "success",
          finished_at: Date.now(),
          exit_code: 0,
        });
        useBlockStore.getState().setRunningBlockId(sessionId, null);
      }
      resolve({
        exitCode: block?.exit_code ?? 0,
        output: block?.output_summary || "",
      });
    }, 30000); // 30s timeout

    unsubscribe = useBlockStore.subscribe((state) => {
      const sessionBlocks = state.blocks[sessionId] || [];
      const block = sessionBlocks.find(b => b.id === blockId);
      if (block && block.status !== "running") {
        clearTimeout(timeoutId);
        if (unsubscribe) unsubscribe();
        resolve({
          exitCode: block.exit_code ?? 0,
          output: block.output_summary || "",
        });
      }
    });
  });
}

export function useAgentExecution(sessionId: string | null) {
  const agentStore = useAgentStore();
  const sessionRef = useRef<string | null>(null);
  sessionRef.current = sessionId;

  const executeNextStep = useCallback(async (
    taskId: string,
    lastOutput?: string,
    exitCode?: number
  ) => {
    const targetSessionId = sessionRef.current;
    if (!targetSessionId) {
      useAgentStore.getState().failTask("No active terminal session available");
      return;
    }

    try {
      // Call the AI provider directly to plan the next step (no sidecar required)
      const step = await invoke<{
        status: string;
        command?: string;
        explanation?: string;
        message?: string;
      }>("agent_plan_step", {
        taskId,
        goal: lastOutput === undefined ? useAgentStore.getState().originalGoal : null,
        lastOutput: lastOutput || null,
        exitCode: exitCode !== undefined ? exitCode : null,
      });

      if (step.status === "completed") {
        useAgentStore.getState().completeTask(step.message || "Task completed successfully");
        return;
      }

      if (step.status === "error") {
        useAgentStore.getState().failTask(step.message || "An error occurred during agent planning");
        return;
      }

      if (step.status === "executing" && step.command) {
        const cmd = step.command;
        const explanation = step.explanation || "Executing planned command";
        const isSensitive = isSensitiveCommand(cmd);

        const currentQueue = useAgentStore.getState().queue;
        const newIndex = currentQueue.length;

        // Add command to the queue
        useAgentStore.getState().addCommandToQueue(
          cmd,
          explanation,
          isSensitive ? "requires_action" : "pending"
        );

        useAgentStore.getState().addLog(`Agent planned step ${newIndex + 1}: ${cmd}`);

        if (isSensitive) {
          useAgentStore.getState().pauseTask();
          useAgentStore.getState().addLog("Command execution paused. Awaiting user approval...");
        } else {
          // Auto-execute safe commands
          await runCommandIndex(taskId, newIndex);
        }
      }
    } catch (err: any) {
      console.error("Agent plan step failed:", err);
      const errMsg = String(err);
      // Provide helpful error messages for common failures
      const friendlyMsg = errMsg.includes("API key") || errMsg.includes("provider")
        ? "No AI provider configured. Please go to Settings → AI and add an API key."
        : errMsg.includes("timeout") || errMsg.includes("network")
        ? "Network error contacting AI provider. Check your connection."
        : errMsg.includes("parse") || errMsg.includes("JSON")
        ? "AI returned an unexpected response format. Try again."
        : errMsg;
      useAgentStore.getState().failTask(friendlyMsg);
    }
  }, []);

  const runCommandIndex = useCallback(async (taskId: string, index: number) => {
    const targetSessionId = sessionRef.current;
    if (!targetSessionId) return;

    const commandItem = useAgentStore.getState().queue[index];
    if (!commandItem) return;

    useAgentStore.getState().setCurrentCommandIndex(index);
    useAgentStore.getState().updateCommandStatus(index, "running");
    useAgentStore.getState().addLog(`Running command: ${commandItem.command}`);
    useAgentStore.getState().resumeTask(); // ensure state matches executing

    const blockId = uuidv4();
    const newBlock: Block = {
      id: blockId,
      session_id: targetSessionId,
      command: commandItem.command,
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

    // Register running block state and execute PTY write
    useBlockStore.getState().setRunningBlockId(targetSessionId, blockId);
    useBlockStore.getState().setCommandOutputReceived(targetSessionId, false);
    useBlockStore.getState().addBlock(targetSessionId, newBlock);

    try {
      window.dispatchEvent(new CustomEvent(`pty-command-run:${targetSessionId}`, { detail: { cmd: commandItem.command } }));
      await pty.write(targetSessionId, `${commandItem.command}\r\n`);

      // Wait for block completion
      const result = await waitForBlockCompletion(targetSessionId, blockId);
      
      const cmdStatus = result.exitCode === 0 ? "success" : "error";
      useAgentStore.getState().updateCommandStatus(index, cmdStatus);
      useAgentStore.getState().addLog(`Command finished with exit code ${result.exitCode}`);

      // Continue feedback loop
      if (useAgentStore.getState().status !== "paused") {
        await executeNextStep(taskId, result.output, result.exitCode);
      }
    } catch (err: any) {
      console.error("Command execution failed:", err);
      useAgentStore.getState().updateCommandStatus(index, "error");
      useAgentStore.getState().failTask(err.toString());
    }
  }, [executeNextStep]);

  const startTask = useCallback((goal: string) => {
    const taskId = uuidv4();
    useAgentStore.getState().startTask(taskId, goal);
    useAgentStore.getState().resumeTask();
    executeNextStep(taskId);
  }, [executeNextStep]);

  const approveAndRunPending = useCallback(async () => {
    const state = useAgentStore.getState();
    const currentIndex = state.queue.findIndex(cmd => cmd.status === "requires_action");
    if (currentIndex === -1 || !state.taskId) return;

    await runCommandIndex(state.taskId, currentIndex);
  }, [runCommandIndex]);

  return {
    startTask,
    approveAndRunPending,
    status: agentStore.status,
    queue: agentStore.queue,
    logs: agentStore.logs,
    lastMessage: agentStore.lastMessage,
    currentCommandIndex: agentStore.currentCommandIndex,
    clearTask: agentStore.clearTask,
  };
}
