import { useCallback, useRef, useEffect } from "react";
import { v4 as uuidv4 } from "uuid";
import { useAgentStore, AgentCommand, defaultSessionState, CONST_DEFAULT_SESSION_STATE } from "../stores/useAgentStore";
import { useBlockStore } from "../stores/useBlockStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import { useSessionStore } from "../stores/useSessionStore";
import { useAppShellStore } from "../stores/useAppShellStore";
import { pty, system, config } from "../lib/ipc";
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

  // ── handleStepResult ─────────────────────────────────────────────────────
  const handleStepResult = useCallback(async (
    targetSessionId: string,
    taskId: string,
    step: any
  ) => {
    const state = useAgentStore.getState();

    // 1. Gated Tool Approval Suspension
    if (step.status === "requires_approval") {
      state.setPendingToolCall(targetSessionId, {
        runId: step.run_id,
        toolCallId: step.tool_call_id,
        name: step.tool_name,
        args: step.args,
      });
      state.pauseTask(targetSessionId);

      if (step.tool_name === "exec_command") {
        const cmd = step.args.command;
        const explanation = step.args.explanation || "Executing planned command";
        state.addCommandToQueue(targetSessionId, cmd, explanation, "requires_action");
        state.setActiveDrawerTab(targetSessionId, "terminals");

        // Add chain node
        state.addChainNode(targetSessionId, {
          type: "command",
          label: cmd.length > 35 ? cmd.slice(0, 35) + "…" : cmd,
          subLabel: explanation,
          status: "pending",
          command: cmd,
        });
      } else if (step.tool_name === "write_file" || step.tool_name === "patch_file") {
        state.addFileChange(targetSessionId, {
          path: step.args.path,
          newContent: step.args.content || step.args.replace || "",
          oldContent: step.args.search || undefined,
          type: step.tool_name === "write_file" ? "write" : "patch",
          search: step.args.search,
          replace: step.args.replace,
        });
      } else if (step.tool_name === "ask_user") {
        state.setActiveDrawerTab(targetSessionId, "questions");
      }
      return;
    }

    // 2. Completed
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

    // 3. Error
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

    // 4. Executing (legacy or direct command path)
    if (step.status === "executing" && step.command) {
      const cmd = step.command;
      const explanation = step.explanation || "Executing planned command";
      const subagent = (step.subagent as AgentCommand["subagent"]) || "none";
      const isSensitive = isSensitiveCommand(cmd);

      if (subagent && subagent !== "none") {
        state.setActiveSubagent(targetSessionId, subagent);
        state.addAgentLog(targetSessionId, "subagent", `Routing to ${subagent} agent`, subagent);
      }

      const freshSession = useAgentStore.getState().sessions[targetSessionId] || defaultSessionState();
      const currentQueue = freshSession.queue;
      const newIndex = currentQueue.length;

      state.addCommandToQueue(
        targetSessionId,
        cmd,
        explanation,
        isSensitive ? "requires_action" : "pending",
        subagent
      );

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
  }, []);

  // ── executeNextStep ──────────────────────────────────────────────────────
  const executeNextStep = useCallback(async (
    taskId: string,
    lastOutput?: string,
    exitCode?: number
  ) => {
    const targetSessionId = sessionRef.current;
    if (!targetSessionId) return;

    const state = useAgentStore.getState();
    const currentSession = state.sessions[targetSessionId] || defaultSessionState();
    const { stepCount, maxSteps, originalGoal, agentType, agentMode } = currentSession;

    if (stepCount >= maxSteps) {
      state.completeTask(
        targetSessionId,
        `Reached maximum steps (${maxSteps}). Task may require manual completion.`
      );
      return;
    }

    state.incrementStep(targetSessionId);

    // Fetch gating review settings from the config IPC
    const cfg = await config.get();
    const requireReviewForCommands = cfg.ai.require_review_for_commands;
    const requireReviewForWrites = cfg.ai.require_review_for_writes;

    try {
      const step = await system.agentPlanStep(
        taskId,
        targetSessionId,
        lastOutput === undefined ? originalGoal : null,
        lastOutput || null,
        exitCode !== undefined ? exitCode : null,
        agentType,
        agentMode,
        requireReviewForCommands,
        requireReviewForWrites
      );

      await handleStepResult(targetSessionId, taskId, step);
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
  }, [handleStepResult]);

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

      return result; // return output and exitCode
    } catch (err: any) {
      console.error("Command execution failed:", err);
      state.updateCommandStatus(targetSessionId, index, "error");

      if (chainNodeId) {
        state.updateChainNode(targetSessionId, chainNodeId, { status: "failed" });
      }

      const errMsg = typeof err === "string" ? err : err?.message || err?.toString?.() || JSON.stringify(err);
      state.failTask(targetSessionId, errMsg);
      throw err;
    }
  }, []);

  // ── startTask ────────────────────────────────────────────────────────────
  const startTask = useCallback((goal: string) => {
    const targetSessionId = sessionRef.current;
    if (!targetSessionId) return;

    const taskId = uuidv4();
    const state = useAgentStore.getState();
    
    // Determine agent type based on active tab type or viewMode
    const tab = useSessionStore.getState().tabs.find((t) => t.id === targetSessionId);
    const isTerminal = tab?.type === "terminal";
    const viewMode = useAppShellStore.getState().viewMode;
    const type = (viewMode === "agent" || !isTerminal) ? "developer" : "terminal";
    const mode = type === "terminal" ? "build" : (state.sessions[targetSessionId]?.agentMode || "build");

    state.addChatMessage(targetSessionId, { role: "user", content: goal });
    state.startTask(targetSessionId, taskId, goal);
    state.setAgentType(targetSessionId, type);
    state.setAgentMode(targetSessionId, mode);
    state.resumeTask(targetSessionId);
    
    executeNextStep(taskId);
  }, [executeNextStep]);

  // ── approveAndRunPending ─────────────────────────────────────────────────
  const approveAndRunPending = useCallback(async () => {
    const targetSessionId = sessionRef.current;
    if (!targetSessionId) return;

    const state = useAgentStore.getState();
    const freshSession = state.sessions[targetSessionId] || defaultSessionState();
    
    // 1. Handle tool approval resume
    if (freshSession.pendingToolCall) {
      const { runId, toolCallId, name } = freshSession.pendingToolCall;
      state.resumeTask(targetSessionId);
      
      try {
        let stepResult: any;
        if (name === "exec_command") {
          // Find the queued command matching
          const currentIndex = freshSession.queue.findIndex((cmd) => cmd.status === "requires_action");
          if (currentIndex === -1) return;
          
          const cmd = freshSession.queue[currentIndex];
          const chainNode = freshSession.chainNodes.find(
            (n) => n.type === "command" && n.command === cmd.command && n.status === "pending"
          );

          // Run it in the PTY first!
          const result = await runCommandIndex(freshSession.taskId!, currentIndex, chainNode?.id);
          
          // Submit PTY outputs back to resume tool execution
          stepResult = await system.agentApproveTool(
            freshSession.agentType,
            freshSession.agentMode,
            runId,
            toolCallId,
            { approved: true, stdout: result?.output || "", stderr: "", exitCode: result?.exitCode ?? 0 }
          );
        } else {
          // File write / patch approved
          stepResult = await system.agentApproveTool(
            freshSession.agentType,
            freshSession.agentMode,
            runId,
            toolCallId,
            { approved: true }
          );
          
          // Approve file changes status
          if (freshSession.filesChanged.length > 0) {
            const lastFile = freshSession.filesChanged[freshSession.filesChanged.length - 1];
            state.updateFileChangeStatus(targetSessionId, lastFile.path, "approved");
          }
        }
        
        state.setPendingToolCall(targetSessionId, null);
        await handleStepResult(targetSessionId, freshSession.taskId!, stepResult);
      } catch (e) {
        console.error("Failed tool approval resume:", e);
        state.failTask(targetSessionId, e);
      }
      return;
    }

    // 2. Legacy pending command queue path
    const currentIndex = freshSession.queue.findIndex((cmd) => cmd.status === "requires_action");
    if (currentIndex === -1 || !freshSession.taskId) return;

    const cmd = freshSession.queue[currentIndex];
    const chainNode = freshSession.chainNodes.find(
      (n) => n.type === "command" && n.command === cmd.command && n.status === "pending"
    );

    const result = await runCommandIndex(freshSession.taskId, currentIndex, chainNode?.id);
    await executeNextStep(freshSession.taskId, result?.output, result?.exitCode);
  }, [runCommandIndex, handleStepResult, executeNextStep]);

  // ── declinePending ───────────────────────────────────────────────────────
  const declinePending = useCallback(async () => {
    const targetSessionId = sessionRef.current;
    if (!targetSessionId) return;

    const state = useAgentStore.getState();
    const freshSession = state.sessions[targetSessionId] || defaultSessionState();

    if (freshSession.pendingToolCall) {
      const { runId, toolCallId, name } = freshSession.pendingToolCall;
      
      try {
        state.resumeTask(targetSessionId);
        if (name !== "exec_command" && freshSession.filesChanged.length > 0) {
          const lastFile = freshSession.filesChanged[freshSession.filesChanged.length - 1];
          state.updateFileChangeStatus(targetSessionId, lastFile.path, "rejected");
        }
        
        const stepResult = await system.agentDeclineTool(
          freshSession.agentType,
          freshSession.agentMode,
          runId,
          toolCallId
        );
        state.setPendingToolCall(targetSessionId, null);
        await handleStepResult(targetSessionId, freshSession.taskId!, stepResult);
      } catch (e) {
        console.error("Failed tool decline resume:", e);
        state.failTask(targetSessionId, e);
      }
      return;
    }

    // Legacy reject path
    const currentIndex = freshSession.queue.findIndex((cmd) => cmd.status === "requires_action");
    if (currentIndex !== -1) {
      state.updateCommandStatus(targetSessionId, currentIndex, "cancelled");
      state.completeTask(targetSessionId, "Task cancelled by user.");
    }
  }, [handleStepResult]);

  // ── skipPending ──────────────────────────────────────────────────────────
  const skipPending = useCallback(() => {
    const targetSessionId = sessionRef.current;
    if (!targetSessionId) return;
    
    // Skip clears the tool call/changes state and resumes execution loop
    const state = useAgentStore.getState();
    state.clearFileChanges(targetSessionId);
    state.resumeTask(targetSessionId);
  }, []);

  // ── submitAnswer ─────────────────────────────────────────────────────────
  const submitAnswer = useCallback(async (answer: string) => {
    const targetSessionId = sessionRef.current;
    if (!targetSessionId) return;

    const state = useAgentStore.getState();
    const freshSession = state.sessions[targetSessionId] || defaultSessionState();
    if (!freshSession.pendingToolCall) return;

    const { runId, toolCallId } = freshSession.pendingToolCall;
    state.resumeTask(targetSessionId);
    state.setPendingToolCall(targetSessionId, null);

    try {
      const stepResult = await system.agentApproveTool(
        freshSession.agentType,
        freshSession.agentMode,
        runId,
        toolCallId,
        { approved: true, answer }
      );
      await handleStepResult(targetSessionId, freshSession.taskId!, stepResult);
    } catch (e) {
      console.error("Failed to submit question answer:", e);
      state.failTask(targetSessionId, e);
    }
  }, [handleStepResult]);

  useEffect(() => {
    if (!sessionId) return;
    const isThinking = sessionState.status === "planning" || sessionState.status === "executing";
    if (!isThinking) return;

    // Immediately fetch once
    system.agentGetLogs().then((res) => {
      if (res && res.status === "ok" && Array.isArray(res.logs)) {
        const mapped = res.logs.map((log: any) => ({
          timestamp: log.timestamp,
          type: log.type as any || "info",
          content: log.content,
        }));
        useAgentStore.getState().setAgentLogs(sessionId, mapped);
      }
    }).catch(() => {});

    const intervalId = setInterval(() => {
      system.agentGetLogs().then((res) => {
        if (res && res.status === "ok" && Array.isArray(res.logs)) {
          const mapped = res.logs.map((log: any) => ({
            timestamp: log.timestamp,
            type: log.type as any || "info",
            content: log.content,
          }));
          useAgentStore.getState().setAgentLogs(sessionId, mapped);
        }
      }).catch(() => {});
    }, 1500);

    return () => clearInterval(intervalId);
  }, [sessionId, sessionState.status]);

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
    declinePending,
    skipPending,
    clearTask,
    submitAnswer,
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
    pendingToolCall: sessionState.pendingToolCall,
    filesChanged: sessionState.filesChanged,
    activeDrawerTab: sessionState.activeDrawerTab,
  };
}
