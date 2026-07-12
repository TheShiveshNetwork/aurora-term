import { useCallback, useRef, useEffect } from "react";
import { v4 as uuidv4 } from "uuid";
import { formatTauriError } from "../lib/utils";

import { useAgentStore, AgentCommand, defaultSessionState, CONST_DEFAULT_SESSION_STATE } from "../stores/useAgentStore";
import { useAppShellStore } from "../stores/useAppShellStore";
import { useBlockStore } from "../stores/useBlockStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import { useSessionStore } from "../stores/useSessionStore";
import { pty, system, config } from "../lib/ipc";
import { Block } from "@aurora/types";

// ── Constants ──────────────────────────────────────────────────────────────
const AGENT_VIEW_SESSION_ID = "agent-view";
const HEAD_TAIL_CHARS = 200;

function truncateOutput(output: string): string {
  if (output.length <= HEAD_TAIL_CHARS * 2 + 100) return output;
  return `[Output truncated: ${output.length} characters total]\n\nFirst ${HEAD_TAIL_CHARS} characters:\n${output.slice(0, HEAD_TAIL_CHARS)}\n\nLast ${HEAD_TAIL_CHARS} characters:\n${output.slice(-HEAD_TAIL_CHARS)}`;
}

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
      resolve({ exitCode, output: truncateOutput(output) });
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

  const executeNextStepRef = useRef<((taskId: string, lastOutput?: string, exitCode?: number) => Promise<void>) | null>(null);

  const lastCommandResultRef = useRef<{ command: string; exitCode: number; output: string; stderr: string }>({ command: "", exitCode: 0, output: "", stderr: "" });

  // ── Helper to cache command result after execution ─────────────────────────
  const cacheCommandResult = useCallback((cmd: string, result: { exitCode?: number; output?: string; stderr?: string } | undefined) => {
    lastCommandResultRef.current = {
      command: cmd,
      exitCode: result?.exitCode ?? 0,
      output: result?.output || "",
      stderr: result?.stderr || "",
    };
  }, []);

  // ── handleStepResult ─────────────────────────────────────────────────────
  const handleStepResult = useCallback(async (
    targetSessionId: string,
    taskId: string,
    step: any
  ) => {
    const state = useAgentStore.getState();

    // Don't process steps after task was stopped or completed
    const currentTask = state.sessions[targetSessionId] || defaultSessionState();
    if (currentTask.status === "error" || currentTask.status === "completed") {
      return;
    }

    // 1. Gated Tool Approval Suspension
    if (step.status === "requires_approval") {
      if (step.tool_name === "exec_command" || step.tool_name === "shell_terminal" || step.tool_name === "shell_developer") {
        const cmd = step.args.command;
        // If this command was the last one executed successfully, auto-approve
        // with cached output instead of showing the approval UI again.
        const lastResult = lastCommandResultRef.current;
        if (lastResult.command === cmd && lastResult.exitCode === 0) {
          state.resumeTask(targetSessionId);
          const stepResult = await system.agentApproveTool(
            useAgentStore.getState().sessions[targetSessionId]?.agentType || "terminal",
            useAgentStore.getState().sessions[targetSessionId]?.agentMode || "build",
            step.run_id,
            step.tool_call_id,
            { approved: true, stdout: lastResult.output, stderr: lastResult.stderr, exitCode: 0 }
          );
          state.setPendingToolCall(targetSessionId, null);
          await handleStepResult(targetSessionId, taskId, stepResult);
          return;
        }

        const explanation = step.args.explanation || `Executing: ${cmd}`;

        // Auto-approve if require_review_for_commands is disabled
        const cfg = await config.get();
        if (!cfg.ai.require_review_for_commands) {
          const freshSession = useAgentStore.getState().sessions[targetSessionId] || defaultSessionState();
          const newIndex = freshSession.queue.length;
          state.addCommandToQueue(targetSessionId, cmd, explanation, "pending");
          state.setActiveDrawerTab(targetSessionId, "terminals");
          state.resumeTask(targetSessionId);
          const nodeId = state.addChainNode(targetSessionId, {
            type: "command",
            label: cmd.length > 35 ? cmd.slice(0, 35) + "…" : cmd,
            subLabel: explanation,
            status: "pending",
            command: cmd,
          });
          state.updateChainNode(targetSessionId, nodeId, { status: "active" });

          const result = await runCommandIndex(taskId, newIndex, nodeId);
          cacheCommandResult(cmd, result);
          state.updateChainNode(targetSessionId, nodeId, { status: "done" });

          const stepResult = await system.agentApproveTool(
            useAgentStore.getState().sessions[targetSessionId]?.agentType || "terminal",
            useAgentStore.getState().sessions[targetSessionId]?.agentMode || "build",
            step.run_id,
            step.tool_call_id,
            { approved: true, stdout: result?.output || "", stderr: "", exitCode: result?.exitCode ?? 0 }
          );
          state.setPendingToolCall(targetSessionId, null);
          await handleStepResult(targetSessionId, taskId, stepResult);
          return;
        }

        state.addCommandToQueue(targetSessionId, cmd, explanation, "requires_action");
        state.setActiveDrawerTab(targetSessionId, "terminals");
        state.setPendingToolCall(targetSessionId, {
          runId: step.run_id,
          toolCallId: step.tool_call_id,
          name: step.tool_name,
          args: step.args,
        });
        state.pauseTask(targetSessionId);

        state.addChainNode(targetSessionId, {
          type: "command",
          label: cmd.length > 35 ? cmd.slice(0, 35) + "…" : cmd,
          subLabel: explanation,
          status: "pending",
          command: cmd,
        });
      } else if (step.tool_name === "write_file" || step.tool_name === "patch_file") {
        // Auto-approve if require_review_for_writes is disabled
        const cfg = await config.get();
        if (!cfg.ai.require_review_for_writes) {
          state.resumeTask(targetSessionId);
          const stepResult = await system.agentApproveTool(
            useAgentStore.getState().sessions[targetSessionId]?.agentType || "terminal",
            useAgentStore.getState().sessions[targetSessionId]?.agentMode || "build",
            step.run_id,
            step.tool_call_id,
            { approved: true }
          );
          state.setPendingToolCall(targetSessionId, null);
          await handleStepResult(targetSessionId, taskId, stepResult);
          return;
        }

        state.setPendingToolCall(targetSessionId, {
          runId: step.run_id,
          toolCallId: step.tool_call_id,
          name: step.tool_name,
          args: step.args,
        });
        state.pauseTask(targetSessionId);
        state.addFileChange(targetSessionId, {
          path: step.args.path,
          newContent: step.args.content || step.args.replace || "",
          oldContent: step.args.search || undefined,
          type: step.tool_name === "write_file" ? "write" : "patch",
          search: step.args.search,
          replace: step.args.replace,
        });
      } else if (step.tool_name === "ask_user") {
        state.setPendingToolCall(targetSessionId, {
          runId: step.run_id,
          toolCallId: step.tool_call_id,
          name: step.tool_name,
          args: step.args,
        });
        state.pauseTask(targetSessionId);
        state.addChatMessage(targetSessionId, {
          role: "assistant",
          content: step.args.question || step.message || "A clarifying question has been asked",
        });
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
        agentType: snap.agentType,
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
        agentType: snap.agentType,
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
        const result = await runCommandIndex(taskId, newIndex, nodeId);
        if (result) {
          lastCommandResultRef.current = { command: cmd, exitCode: result.exitCode ?? 0, output: result.output || "", stderr: "" };
        }
        if (executeNextStepRef.current) {
          await executeNextStepRef.current(taskId, result?.output, result?.exitCode);
        }
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
    const { stepCount, maxSteps, originalGoal, agentType, agentMode, model } = currentSession;

    // Don't plan new steps after task was stopped or completed
    if (currentSession.status === "error" || currentSession.status === "completed") {
      return;
    }

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
        requireReviewForWrites,
        model
      );

      await handleStepResult(targetSessionId, taskId, step);
    } catch (err: any) {
      console.error("Agent plan step failed:", err);
      const errMsg = formatTauriError(err);
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
        agentType: snap.agentType,
      });
    }
  }, [handleStepResult]);

  executeNextStepRef.current = executeNextStep;

  // ── runCommandIndex ──────────────────────────────────────────────────────
  const runCommandIndex = useCallback(async (taskId: string, index: number, chainNodeId?: string) => {
    const targetSessionId = sessionRef.current;
    if (!targetSessionId) return;

    // AgentView uses a dedicated session ID — redirect PTY operations to the
    // real terminal session so output appears in the user's terminal.
    const isAgentView = targetSessionId === AGENT_VIEW_SESSION_ID;
    const ptySessionId = isAgentView
      ? useAppShellStore.getState().lastActiveTerminalId || targetSessionId
      : targetSessionId;

    if (isAgentView && ptySessionId === targetSessionId) {
      console.warn("AgentView: no terminal session available for PTY command");
      useAgentStore.getState().addLog(targetSessionId, "Cannot run shell command: no terminal session open.");
      return { exitCode: -1, output: "No terminal session available. Open a terminal tab first." };
    }

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
      session_id: ptySessionId,
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

    useBlockStore.getState().setRunningBlockId(ptySessionId, blockId);
    useBlockStore.getState().setCommandOutputReceived(ptySessionId, false);
    useBlockStore.getState().addBlock(ptySessionId, newBlock);

    try {
      useAppShellStore.getState().markSessionInteracted(ptySessionId);
      window.dispatchEvent(
        new CustomEvent(`pty-command-run:${ptySessionId}`, {
          detail: { cmd: commandItem.command },
        })
      );
      await pty.write(ptySessionId, `${commandItem.command}\r`);

      const result = await waitForBlockCompletion(ptySessionId, blockId);
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

      const errMsg = formatTauriError(err);
      state.failTask(targetSessionId, errMsg);
      throw err;
    }
  }, []);

  // ── startTask ────────────────────────────────────────────────────────────
  const startTask = useCallback((goal: string, forceType?: "terminal" | "developer", customModel?: string) => {
    const targetSessionId = sessionRef.current;
    if (!targetSessionId) return;

    lastCommandResultRef.current = { command: "", exitCode: 0, output: "", stderr: "" };

    const taskId = uuidv4();
    const state = useAgentStore.getState();
    
    let type: "terminal" | "developer";
    if (forceType) {
      // Caller knows exactly which agent to use — trust it unconditionally.
      type = forceType;
    } else {
      // Derive from context: terminal tab without the agent view open → terminal agent.
      const tab = useSessionStore.getState().tabs.find((t) => t.id === targetSessionId);
      const isTerminalTab = tab?.type === "terminal";
      type = isTerminalTab ? "terminal" : "developer";
    }
    const mode = type === "terminal" ? "build" : (state.sessions[targetSessionId]?.agentMode || "build");

    state.addChatMessage(targetSessionId, { role: "user", content: goal, agentType: type });
    state.startTask(targetSessionId, taskId, goal);
    state.setAgentType(targetSessionId, type);
    state.setAgentMode(targetSessionId, mode);
    if (customModel) {
      state.setAgentModel(targetSessionId, customModel);
    } else {
      state.setAgentModel(targetSessionId, undefined);
    }
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
        if (name === "exec_command" || name === "shell_terminal" || name === "shell_developer") {
          // Find the queued command matching
          const currentIndex = freshSession.queue.findIndex((cmd) => cmd.status === "requires_action");
          if (currentIndex === -1) return;
          
          const cmd = freshSession.queue[currentIndex];
          const chainNode = freshSession.chainNodes.find(
            (n) => n.type === "command" && n.command === cmd.command && n.status === "pending"
          );

          // Run it in the PTY first!
          const result = await runCommandIndex(freshSession.taskId!, currentIndex, chainNode?.id);
          cacheCommandResult(cmd.command, result);
          
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
    cacheCommandResult(cmd.command, result);
    await executeNextStep(freshSession.taskId, result?.output, result?.exitCode);
  }, [cacheCommandResult, runCommandIndex, handleStepResult, executeNextStep]);

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
        if (name !== "exec_command" && name !== "shell_terminal" && name !== "shell_developer" && freshSession.filesChanged.length > 0) {
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

    state.addChatMessage(targetSessionId, {
      role: "user",
      content: answer,
    });

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
    if (freshSession.originalGoal) startTask(freshSession.originalGoal, freshSession.agentType as "terminal" | "developer" | undefined);
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
    model: sessionState.model,
  };
}
