import { useCallback, useRef } from "react";
import { v4 as uuidv4 } from "uuid";
import { useAgentStore, AgentCommand, defaultSessionState, CONST_DEFAULT_SESSION_STATE } from "../stores/useAgentStore";
import { useBlockStore } from "../stores/useBlockStore";
import { pty, system } from "../lib/ipc";
import { Block } from "@aurora/types";

// ── Sensitive command detection ───────────────────────────────────────────
function isSensitiveCommand(cmd: string): boolean {
  const lower = cmd.toLowerCase().trim();
  const sensitivePatterns = [
    /\brm\b/, /\bmv\b/, /\bcp\b/, /\bdel\b/, /\berase\b/,
    /\bwrite-content\b/, /\bout-file\b/, />/, />>/,
    /\bgit\s+push\b/, /\bgit\s+commit\b/,
    /\bpnpm\b/, /\bnpm\b/, /\byarn\b/, /\bbun\b/,
    /\bset-item\b/, /\bremove-item\b/, /\bcopy-item\b/, /\bmove-item\b/,
    /\bssh\b/, /\brsync\b/, /\bcurl\b/, /\bwget\b/, /\bftp\b/,
    /\bformat\b/, /\brd\b/, /\brmdir\b/,
  ];
  return sensitivePatterns.some((pattern) => pattern.test(lower));
}

// ── Block completion waiter ───────────────────────────────────────────────
function waitForBlockCompletion(
  sessionId: string,
  blockId: string,
  timeoutMs = 30_000
): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve) => {
    let unsubscribe: (() => void) | null = null;

    const settled = (exitCode: number, output: string) => {
      clearTimeout(timeoutId);
      if (unsubscribe) { unsubscribe(); unsubscribe = null; }
      resolve({ exitCode, output });
    };

    // Timeout fallback
    const timeoutId = setTimeout(() => {
      const state = useBlockStore.getState();
      const block = (state.blocks[sessionId] || []).find((b) => b.id === blockId);
      if (block && block.status === "running") {
        useBlockStore.getState().updateBlock(sessionId, blockId, {
          status: "success",
          finished_at: Date.now(),
          exit_code: 0,
        });
        useBlockStore.getState().setRunningBlockId(sessionId, null);
      }
      settled(block?.exit_code ?? 0, block?.output_summary || "");
    }, timeoutMs);

    // Subscribe to store changes
    unsubscribe = useBlockStore.subscribe((state) => {
      const block = (state.blocks[sessionId] || []).find((b) => b.id === blockId);

      // Block was never set to running (e.g. write failed instantly) — bail out
      if (!block) {
        settled(0, "");
        return;
      }

      if (block.status !== "running") {
        settled(block.exit_code ?? 0, block.output_summary || "");
      }
    });

    // Check immediately in case the block is already done
    const immediate = (useBlockStore.getState().blocks[sessionId] || []).find(
      (b) => b.id === blockId
    );
    if (immediate && immediate.status !== "running") {
      settled(immediate.exit_code ?? 0, immediate.output_summary || "");
    }
  });
}

// ── Hook ──────────────────────────────────────────────────────────────────
export function useAgentExecution(sessionId: string | null) {
  const sessionState = useAgentStore(
    (state) => state.sessions[sessionId || ""] || CONST_DEFAULT_SESSION_STATE
  );
  const sessionRef = useRef<string | null>(null);
  sessionRef.current = sessionId;

  // ── executeNextStep ──────────────────────────────────────────────────────
  const executeNextStep = useCallback(async (
    taskId: string,
    lastOutput?: string,
    exitCode?: number
  ) => {
    const targetSessionId = sessionRef.current;
    if (!targetSessionId) {
      return;
    }

    // ── Max steps guard ──────────────────────────────────────────────────
    const state = useAgentStore.getState();
    const currentSession = state.sessions[targetSessionId] || defaultSessionState();
    const { stepCount, maxSteps, originalGoal } = currentSession;
    if (stepCount >= maxSteps) {
      state.completeTask(
        targetSessionId,
        `Reached maximum steps (${maxSteps}). Task may require manual completion.`
      );
      return;
    }

    state.incrementStep(targetSessionId);

    try {
      const step = await system.agentPlanStep(
        taskId,
        targetSessionId,
        lastOutput === undefined ? originalGoal : null,
        lastOutput || null,
        exitCode !== undefined ? exitCode : null,
      );

      // ── Completed ──────────────────────────────────────────────────────
      if (step.status === "completed") {
        const msg = step.message || "Task completed successfully";
        state.completeTask(targetSessionId, msg);
        const totalMs = useAgentStore.getState().sessions[targetSessionId]?.queue
          .reduce((acc, cmd) => acc + (cmd.durationMs || 0), 0) || 0;
        const snap = useAgentStore.getState().sessions[targetSessionId] || defaultSessionState();
        state.addChatMessage(targetSessionId, {
          role: "assistant", content: msg, durationMs: totalMs,
          chainNodes: snap.chainNodes, agentLogs: snap.agentLogs, subagent: snap.activeSubagent,
        });
        return;
      }

      // ── Error ──────────────────────────────────────────────────────────
      if (step.status === "error") {
        const errMsg = step.message || "An error occurred during agent planning";
        state.failTask(targetSessionId, errMsg);
        const snap = useAgentStore.getState().sessions[targetSessionId] || defaultSessionState();
        state.addChatMessage(targetSessionId, {
          role: "assistant", content: errMsg, isError: true,
          chainNodes: snap.chainNodes, agentLogs: snap.agentLogs, subagent: snap.activeSubagent,
        });
        return;
      }

      // ── Executing ─────────────────────────────────────────────────────
      if (step.status === "executing" && step.command) {
        const cmd = step.command;
        const explanation = step.explanation || "Executing planned command";
        const subagent = (step.subagent as AgentCommand["subagent"]) || "none";
        const isSensitive = isSensitiveCommand(cmd);

        // Update active subagent indicator
        if (subagent && subagent !== "none") {
          state.setActiveSubagent(targetSessionId, subagent);
          state.addAgentLog(targetSessionId, "subagent", `Routing to ${subagent} agent`, subagent);
        }

        const freshSession = useAgentStore.getState().sessions[targetSessionId] || defaultSessionState();
        const currentQueue = freshSession.queue;
        const newIndex = currentQueue.length;

        // Add command to the queue with subagent info
        state.addCommandToQueue(
          targetSessionId,
          cmd,
          explanation,
          isSensitive ? "requires_action" : "pending",
          subagent
        );

        // Add chain node for this command
        const nodeId = state.addChainNode(targetSessionId, {
          type: "command",
          label: cmd.length > 35 ? cmd.slice(0, 35) + "…" : cmd,
          subLabel: explanation,
          status: "pending",
          command: cmd,
          subagent: subagent !== "none" ? subagent : undefined,
        });

        state.addLog(targetSessionId, `Agent planned step ${newIndex + 1}: ${cmd}`);
        state.addAgentLog(targetSessionId, "execute", `Planned: ${cmd}`, subagent !== "none" ? subagent : undefined);

        if (isSensitive) {
          state.pauseTask(targetSessionId);
          state.addLog(targetSessionId, "Command execution paused. Awaiting user approval...");
          state.updateChainNode(targetSessionId, nodeId, { status: "pending" });
        } else {
          state.updateChainNode(targetSessionId, nodeId, { status: "active" });
          await runCommandIndex(taskId, newIndex, nodeId);
        }
      }
    } catch (err: any) {
      console.error("Agent plan step failed:", err);
      const errMsg = typeof err === "string" ? err : err?.message || err?.toString?.() || JSON.stringify(err);
      const friendlyMsg = errMsg.includes("API key") || errMsg.includes("provider")
        ? "No AI provider configured. Please go to Settings → AI and add an API key."
        : errMsg.includes("timeout") || errMsg.includes("network")
          ? "Network error contacting AI provider. Check your connection."
          : errMsg.includes("parse") || errMsg.includes("JSON")
            ? "AI returned an unexpected response format. Try again."
            : errMsg;
      state.failTask(targetSessionId, friendlyMsg);
      const snap = useAgentStore.getState().sessions[targetSessionId] || defaultSessionState();
      state.addChatMessage(targetSessionId, {
        role: "assistant", content: friendlyMsg, isError: true,
        chainNodes: snap.chainNodes, agentLogs: snap.agentLogs, subagent: snap.activeSubagent,
      });
    }
  }, []);

  // ── runCommandIndex ──────────────────────────────────────────────────────
  const runCommandIndex = useCallback(async (taskId: string, index: number, chainNodeId?: string) => {
    const targetSessionId = sessionRef.current;
    if (!targetSessionId) return;

    const state = useAgentStore.getState();
    const freshSession = state.sessions[targetSessionId] || defaultSessionState();
    const commandItem = freshSession.queue[index];
    if (!commandItem) return;

    const startedAt = Date.now();

    state.setCurrentCommandIndex(targetSessionId, index);
    state.updateCommandStatus(targetSessionId, index, "running");
    state.addLog(targetSessionId, `Running command: ${commandItem.command}`);
    state.resumeTask(targetSessionId);

    if (chainNodeId) {
      state.updateChainNode(targetSessionId, chainNodeId, { status: "active" });
    }

    const blockId = uuidv4();
    const newBlock: Block = {
      id: blockId,
      session_id: targetSessionId,
      command: commandItem.command,
      started_at: startedAt,
      status: "running",
      output_type: "plain",
      collapsed: false,
      bookmarked: false,
      output_summary: "",
      anchor_row: 0,
      output_row_end: 0,
      anchor_y: 0,
    };

    useBlockStore.getState().setRunningBlockId(targetSessionId, blockId);
    useBlockStore.getState().setCommandOutputReceived(targetSessionId, false);
    useBlockStore.getState().addBlock(targetSessionId, newBlock);

    try {
      window.dispatchEvent(
        new CustomEvent(`pty-command-run:${targetSessionId}`, {
          detail: { cmd: commandItem.command },
        })
      );
      await pty.write(targetSessionId, `${commandItem.command}\r`);

      const result = await waitForBlockCompletion(targetSessionId, blockId);
      const durationMs = Date.now() - startedAt;
      const cmdStatus = result.exitCode === 0 ? "success" : "error";

      state.updateCommandStatus(targetSessionId, index, cmdStatus, durationMs);
      state.addLog(targetSessionId, `Command finished with exit code ${result.exitCode} in ${durationMs}ms`);
      state.addAgentLog(
        targetSessionId,
        result.exitCode === 0 ? "execute" : "error",
        `${commandItem.command} → exit ${result.exitCode} (${durationMs}ms)`
      );

      if (chainNodeId) {
        state.updateChainNode(targetSessionId, chainNodeId, {
          status: cmdStatus === "success" ? "done" : "failed",
          durationMs,
        });
      }

      state.setActiveSubagent(targetSessionId, null);

      const postRunSession = useAgentStore.getState().sessions[targetSessionId] || defaultSessionState();
      if (postRunSession.status !== "paused") {
        await executeNextStep(taskId, result.output, result.exitCode);
      }
    } catch (err: any) {
      console.error("Command execution failed:", err);
      state.updateCommandStatus(targetSessionId, index, "error");

      if (chainNodeId) {
        state.updateChainNode(targetSessionId, chainNodeId, { status: "failed" });
      }

      const errMsg = typeof err === "string" ? err : err?.message || err?.toString?.() || JSON.stringify(err);
      state.failTask(targetSessionId, errMsg);
    }
  }, [executeNextStep]);

  // ── startTask ────────────────────────────────────────────────────────────
  const startTask = useCallback((goal: string) => {
    const targetSessionId = sessionRef.current;
    if (!targetSessionId) return;

    const taskId = uuidv4();
    const state = useAgentStore.getState();
    // Add user message to chat history BEFORE starting
    state.addChatMessage(targetSessionId, { role: "user", content: goal });
    state.startTask(targetSessionId, taskId, goal);
    state.resumeTask(targetSessionId);
    executeNextStep(taskId);
  }, [executeNextStep]);

  // ── approveAndRunPending ─────────────────────────────────────────────────
  const approveAndRunPending = useCallback(async () => {
    const targetSessionId = sessionRef.current;
    if (!targetSessionId) return;

    const state = useAgentStore.getState();
    const freshSession = state.sessions[targetSessionId] || defaultSessionState();
    const currentIndex = freshSession.queue.findIndex((cmd) => cmd.status === "requires_action");
    if (currentIndex === -1 || !freshSession.taskId) return;

    const cmd = freshSession.queue[currentIndex];
    const chainNode = freshSession.chainNodes.find(
      (n) => n.type === "command" && n.command === cmd.command && n.status === "pending"
    );

    await runCommandIndex(freshSession.taskId, currentIndex, chainNode?.id);
  }, [runCommandIndex]);

  // ── retryTask ────────────────────────────────────────────────────────────
  const retryTask = useCallback(() => {
    const targetSessionId = sessionRef.current;
    if (!targetSessionId) return;

    const freshSession = useAgentStore.getState().sessions[targetSessionId] || defaultSessionState();
    if (freshSession.originalGoal) startTask(freshSession.originalGoal);
  }, [startTask]);

  const clearTask = useCallback(() => {
    const targetSessionId = sessionRef.current;
    if (!targetSessionId) return;
    useAgentStore.getState().clearTask(targetSessionId);
  }, []);

  return {
    startTask,
    retryTask,
    approveAndRunPending,
    clearTask,
    status: sessionState.status,
    queue: sessionState.queue,
    originalGoal: sessionState.originalGoal,
    lastMessage: sessionState.lastMessage,
    currentCommandIndex: sessionState.currentCommandIndex,
    stepCount: sessionState.stepCount,
    maxSteps: sessionState.maxSteps,
    chainNodes: sessionState.chainNodes,
    agentLogs: sessionState.agentLogs,
    activeSubagent: sessionState.activeSubagent,
    chatHistory: sessionState.chatHistory,
  };
}
