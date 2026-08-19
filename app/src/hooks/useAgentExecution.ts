import { useCallback, useRef, useEffect } from "react";
import { v4 as uuidv4 } from "uuid";
import { formatTauriError } from "../lib/utils";

import { useAgentStore, AgentCommand, defaultSessionState, CONST_DEFAULT_SESSION_STATE, sanitizeMessage } from "../stores/useAgentStore";
import { useAppShellStore } from "../stores/useAppShellStore";
import { useBlockStore } from "../stores/useBlockStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import { useSessionStore } from "../stores/useSessionStore";
import { pty, system, config } from "../lib/ipc";
import { Block } from "@aurora/types";

// ── Constants ──────────────────────────────────────────────────────────────
const HEAD_TAIL_CHARS = 200;

function truncateOutput(output: string): string {
  if (output.length <= HEAD_TAIL_CHARS * 2 + 100) return output;
  return `[Output truncated: ${output.length} characters total]\n\nFirst ${HEAD_TAIL_CHARS} characters:\n${output.slice(0, HEAD_TAIL_CHARS)}\n\nLast ${HEAD_TAIL_CHARS} characters:\n${output.slice(-HEAD_TAIL_CHARS)}`;
}

// Guarantees the chain-of-thought Planning/Conclusion nodes reflect the agent's
// reasoning even if the live poll missed the tail of a very fast stream.
async function syncFinalThinking(sessionId: string) {
  try {
    const res = await system.agentGetThinking(sessionId);
    if (!res || res.status !== "ok") return;
    const store = useAgentStore.getState();
    if (res.planning) {
      store.setPlanningThinking(sessionId, res.planning);
      const pNode = store.sessions[sessionId]?.chainNodes.find((n) => n.type === "planning");
      if (pNode && pNode.content !== res.planning) {
        store.updateChainNode(sessionId, pNode.id, { content: res.planning });
      }
    }
    if (res.conclusion) store.streamConclusion(sessionId, res.conclusion);
  } catch {
    /* non-fatal */
  }
}

// ── Active file context builder ───────────────────────────────────────────
// Returns context for the SINGLE file open in the active tab only — never
// every open file in the window. The sidecar injects a short preview plus a
// directive to use read_file for full contents, and patch_file/write_file to
// edit. If the user has lines selected in the editor, the selection is sent
// too so the agent knows exactly which lines are being referenced. Returns
// null when the session has no active file tab.
async function buildFileContext(sessionId: string | null): Promise<string | null> {
  if (!sessionId) return null;
  const activeTab = useSessionStore.getState().tabs.find((t) => t.id === sessionId);
  if (!activeTab?.filePath) return null;

  const shell = useAppShellStore.getState();
  const cwd = shell.projectDir || shell.cwdAbsolute;

  try {
    const res = await system.agentFileContext(
      [activeTab.filePath],
      cwd || undefined,
      undefined,
      activeTab.selection && activeTab.selection.text.trim()
        ? {
            path: activeTab.filePath,
            startLine: activeTab.selection.startLine,
            endLine: activeTab.selection.endLine,
            text: activeTab.selection.text,
          }
        : null
    );
    if (res.status === "completed" && res.context) {
      return res.context;
    }
  } catch (err) {
    console.warn("Failed to build file context:", err);
  }
  return null;
}

// ── Duplicate tool-call guard (ADR §19.4) ──────────────────────────────────
// If the model proposes the exact same tool call 3× in a row, auto-decline it so
// a stuck agent can't loop forever (e.g. re-reading the same file). The resume
// flow now returns real tool output, so this is only a secondary safety net.
const recentToolCalls = new Map<string, string[]>();
function toolCallKey(name?: string, args?: any): string {
  return `${name}::${JSON.stringify(args ?? {})}`;
}
function isRepeatedToolCall(sessionId: string, key: string): boolean {
  const arr = recentToolCalls.get(sessionId) ?? [];
  const repeat = arr.length >= 2 && arr[arr.length - 1] === key && arr[arr.length - 2] === key;
  arr.push(key);
  recentToolCalls.set(sessionId, arr.slice(-6));
  return repeat;
}
function resetToolCallGuard(sessionId: string) {
  recentToolCalls.delete(sessionId);
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

  // Tracks the PTY session a currently-running tool-call command is executing
  // in, so a user-initiated stop can interrupt just that command (Ctrl-C) and
  // leave the terminal session itself alive.
  const runningToolPtySessionRef = useRef<string | null>(null);

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

    // When the agent's terminal is occupied by a TUI (alternate screen buffer
    // active), shell commands cannot be executed there. Decline the command and
    // resume the agent with a clear reason so it falls back to tool calls /
    // natural-language responses instead of injecting keystrokes into the TUI.
    const declineCommandForAltScreen = async (sid: string, tid: string, stp: any) => {
      useAgentStore.getState().addLog(sid, "Command skipped: terminal is in alternate screen buffer (TUI active).");
      useAgentStore.getState().addAgentLog(
        sid,
        "execute",
        "Command skipped — terminal is in an alternate screen buffer (a TUI is active); commands cannot be executed there."
      );
      const feedback =
        "The terminal is currently in an alternate screen buffer, so shell commands cannot be executed there. Do NOT attempt to run terminal commands. Respond in natural language, or use your available tool calls (read_file, list_directory, grep_search, glob, web_fetch, history_search) to gather information.";
      const stepResult = await system.agentDeclineTool(
        useAgentStore.getState().sessions[sid]?.agentType || "terminal",
        useAgentStore.getState().sessions[sid]?.agentMode || "build",
        stp.run_id,
        stp.tool_call_id,
        sid,
        feedback
      );
      useAgentStore.getState().setPendingToolCall(sid, null);
      await handleStepResult(sid, tid, stepResult);
    };

    // 1. Gated Tool Approval Suspension
    if (step.status === "requires_approval") {
      // Secondary safety net: auto-decline the 3rd identical tool call in a row
      // so a stuck model can't loop forever (e.g. re-reading the same file).
      const dupKey = toolCallKey(step.tool_name, step.args);
      if (isRepeatedToolCall(targetSessionId, dupKey)) {
        console.warn(`Skipped — already executed: ${step.tool_name}`, step);
        state.addAgentLog(targetSessionId, "tool", `Skipped — already executed: ${step.tool_name}`);
        state.resumeTask(targetSessionId);
        const stepResult = await system.agentDeclineTool(
          useAgentStore.getState().sessions[targetSessionId]?.agentType || "terminal",
          useAgentStore.getState().sessions[targetSessionId]?.agentMode || "build",
          step.run_id,
          step.tool_call_id,
          targetSessionId
        );
        state.setPendingToolCall(targetSessionId, null);
        await handleStepResult(targetSessionId, taskId, stepResult);
        return;
      }

      if (step.tool_name === "exec_command" || step.tool_name === "shell_terminal" || step.tool_name === "shell_developer") {
        // Terminal occupied by a TUI — never inject commands into it. Decline and
        // let the agent fall back to tool calls / natural-language responses.
        if (useSessionStore.getState().alternateBufferActive[targetSessionId]) {
          await declineCommandForAltScreen(targetSessionId, taskId, step);
          return;
        }
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
            { approved: true, stdout: lastResult.output, stderr: lastResult.stderr, exitCode: 0 },
            targetSessionId
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
            { approved: true, stdout: result?.output || "", stderr: "", exitCode: result?.exitCode ?? 0 },
            targetSessionId
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
            { approved: true },
            targetSessionId
          );
          state.setPendingToolCall(targetSessionId, null);
          await handleStepResult(targetSessionId, taskId, stepResult);
          return;
        }

        // Add chain node so file write/patch is visible in chain-of-thought
        const filePath = step.args.path || "";
        const fileShortName = filePath.split(/[\\/]/).pop() || filePath;
        const fileNodeId = state.addChainNode(targetSessionId, {
          type: "command",
          label: step.tool_name === "write_file" ? `Write ${fileShortName}` : `Patch ${fileShortName}`,
          subLabel: filePath,
          status: "pending",
        });
        state.updateChainNode(targetSessionId, fileNodeId, { status: "active" });

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
        // Auto-open the Files tab so the user sees the pending change immediately
        state.setActiveDrawerTab(targetSessionId, "files");
        // Emit event to auto-open diff tab for review
        window.dispatchEvent(new CustomEvent("aurora-agent-file-change", {
          detail: {
            path: step.args.path,
            type: step.tool_name === "write_file" ? "write" : "patch",
            newContent: step.args.content || "",
            search: step.args.search,
            replace: step.args.replace,
          },
        }));
      } else if (step.tool_name === "ask_user") {
        // Add chain node for question
        state.addChainNode(targetSessionId, {
          type: "planning",
          label: "Asking a clarifying question…",
          subLabel: step.args.question || step.message,
          status: "active",
        });
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
      } else {
        // Fallback: auto-approve any unrecognized tool suspension
        // (e.g., read_file, grep_search, list_directory, search_files, glob, web_fetch)
        // These tools execute directly in the sidecar and don't need frontend PTY approval.
        console.warn(`Auto-approving unrecognized tool suspension: ${step.tool_name}`, step);
        state.resumeTask(targetSessionId);
        const stepResult = await system.agentApproveTool(
          useAgentStore.getState().sessions[targetSessionId]?.agentType || "terminal",
          useAgentStore.getState().sessions[targetSessionId]?.agentMode || "build",
          step.run_id,
          step.tool_call_id,
          { approved: true },
          targetSessionId,
          step.tool_name,
          step.args
        );
        state.setPendingToolCall(targetSessionId, null);
        await handleStepResult(targetSessionId, taskId, stepResult);
        return;
      }
      return;
    }

    // 2. Completed
    if (step.status === "completed") {
      const msg = step.message || "Task completed successfully";
      // Pull the final streamed thinking so the chain-of-thought nodes always
      // show the agent's planning + conclusion reasoning, not the user's prompt.
      await syncFinalThinking(targetSessionId);
      state.completeTask(targetSessionId, msg);
      const totalMs = useAgentStore.getState().sessions[targetSessionId]?.queue
        .reduce((acc, cmd) => acc + (cmd.durationMs || 0), 0) || 0;
      const snap = useAgentStore.getState().sessions[targetSessionId] || defaultSessionState();
      // For chat / no-command turns the queue is empty, so fall back to the
      // wall-clock run time so "Worked for" reflects the real elapsed duration.
      const runMs = snap.startedAt ? Date.now() - snap.startedAt : 0;
      const durationMs = totalMs > 0 ? totalMs : runMs;
      state.addChatMessage(targetSessionId, {
        role: "assistant", content: sanitizeMessage(msg), durationMs,
        chainNodes: snap.chainNodes, agentLogs: snap.agentLogs, subagent: snap.activeSubagent,
        agentType: snap.agentType,
      });
      return;
    }

    // 3. Error
    if (step.status === "error") {
      const errMsg = step.message || "An error occurred during agent planning";
      await syncFinalThinking(targetSessionId);
      state.failTask(targetSessionId, errMsg);
      const snap = useAgentStore.getState().sessions[targetSessionId] || defaultSessionState();
      const runMs = snap.startedAt ? Date.now() - snap.startedAt : 0;
      state.addChatMessage(targetSessionId, {
        role: "assistant", content: errMsg, isError: true, durationMs: runMs,
        chainNodes: snap.chainNodes, agentLogs: snap.agentLogs, subagent: snap.activeSubagent,
        agentType: snap.agentType,
      });
      return;
    }

    // 4. Executing (legacy or direct command path)
    if (step.status === "executing" && step.command) {
      // Terminal occupied by a TUI — skip command execution (would corrupt it).
      if (useSessionStore.getState().alternateBufferActive[targetSessionId]) {
        state.addLog(targetSessionId, "Command skipped: terminal is in alternate screen buffer (TUI active).");
        useAgentStore.getState().addAgentLog(targetSessionId, "execute", "Command skipped — terminal is in an alternate screen buffer (TUI active).");
        if (executeNextStepRef.current) await executeNextStepRef.current(taskId);
        return;
      }
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
      let goal: string | null = lastOutput === undefined ? originalGoal : null;
      if (goal) {
        resetToolCallGuard(targetSessionId);
        const fileCtx = await buildFileContext(targetSessionId);
        if (fileCtx) goal = `${goal}\n\n[FILE CONTEXT]\n${fileCtx}`;
        // If the agent's own terminal is occupied by a TUI (alternate screen
        // buffer active), tell the agent up front so it explains the situation
        // to the user instead of silently completing or attempting a command
        // that can't run.
        if (useSessionStore.getState().alternateBufferActive[targetSessionId]) {
          goal = `${goal}\n\n[TERMINAL STATE] The terminal is currently in an ALTERNATE SCREEN BUFFER. Shell commands CANNOT be executed there right now. Do NOT attempt to run terminal commands. Respond using your normal JSON format and put the explanation in the \`message\` field: state that commands cannot be run while the terminal is occupied by a TUI, and offer to use your read-only tool calls (read_file, list_directory, grep_search, glob, web_fetch, history_search) or answer in chat. Do not wrap the message in extra prose outside the JSON object.`;
        }
      }

      const step = await system.agentPlanStep(
        taskId,
        targetSessionId,
        goal,
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
    // If the run was already stopped/cancelled (e.g. the sidecar aborted at the
    // user's request), don't overwrite the "Cancelled by user" status/message.
    const current = useAgentStore.getState().sessions[targetSessionId];
    if (current && (current.status === "error" || current.status === "completed")) {
      return;
    }
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

    // Resolve a real PTY session for command execution. AgentView sessions and
    // non-terminal tabs (file/diff/merge) have no PTY of their own — their
    // commands run in the BACKGROUND on the last-active (or first) terminal tab
    // so output never interrupts the current view.
    const activeTab = useSessionStore.getState().tabs.find((t) => t.id === targetSessionId);
    const hasOwnPty = activeTab?.type === "terminal";
    let ptySessionId = targetSessionId;

    if (!hasOwnPty) {
      ptySessionId =
        useAppShellStore.getState().lastActiveTerminalId ||
        useSessionStore.getState().tabs.find((t) => t.type === "terminal")?.id ||
        targetSessionId;
    }

    if (ptySessionId === targetSessionId && !hasOwnPty) {
      console.warn("No terminal session available for PTY command");
      useAgentStore.getState().addLog(targetSessionId, "Cannot run shell command: no terminal session open.");
      return { exitCode: -1, output: "No terminal session available. Open a terminal tab first." };
    }

    // Remember which PTY session this tool call runs in so a stop can interrupt
    // just this command without killing the terminal session.
    runningToolPtySessionRef.current = ptySessionId;

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

      // If the user hit stop while this command was running, the run is already
      // cancelled — don't resurrect a "done"/"success" state on the chain node
      // or queue item. Keep it terminal-but-cancelled so no spinner/loader lingers.
      const runStatus = useAgentStore.getState().sessions[targetSessionId]?.status;
      const wasStopped = runStatus === "error" || runStatus === "completed";
      const cmdStatus = wasStopped
        ? "cancelled"
        : result.exitCode === 0
          ? "success"
          : "error";

      state.updateCommandStatus(targetSessionId, index, cmdStatus, durationMs);
      state.addLog(targetSessionId, `Command finished with exit code ${result.exitCode} in ${durationMs}ms`);
      state.addAgentLog(
        targetSessionId,
        result.exitCode === 0 ? "execute" : "error",
        `${commandItem.command} → exit ${result.exitCode} (${durationMs}ms)`
      );

      if (chainNodeId) {
        state.updateChainNode(targetSessionId, chainNodeId, {
          status: wasStopped ? "failed" : cmdStatus === "success" ? "done" : "failed",
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
    } finally {
      runningToolPtySessionRef.current = null;
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
    state.setThinking(targetSessionId, "");
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
          // Terminal occupied by a TUI — never inject commands into it, even if the
          // user approved. Decline so the agent falls back to tools / NL instead.
          if (useSessionStore.getState().alternateBufferActive[targetSessionId]) {
            const feedback =
              "The terminal is currently in an alternate screen buffer, so shell commands cannot be executed there. Do NOT attempt to run terminal commands. Respond in natural language, or use your available tool calls (read_file, list_directory, grep_search, glob, web_fetch, history_search) to gather information.";
            const stepResult = await system.agentDeclineTool(
              freshSession.agentType,
              freshSession.agentMode,
              runId,
              toolCallId,
              targetSessionId,
              feedback
            );
            state.setPendingToolCall(targetSessionId, null);
            await handleStepResult(targetSessionId, freshSession.taskId!, stepResult);
            return;
          }
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
            { approved: true, stdout: result?.output || "", stderr: "", exitCode: result?.exitCode ?? 0 },
            targetSessionId
          );
        } else {
          // File write / patch approved
          stepResult = await system.agentApproveTool(
            freshSession.agentType,
            freshSession.agentMode,
            runId,
            toolCallId,
            { approved: true },
            targetSessionId
          );
          
          // Approve file changes status and update chain node
          if (freshSession.filesChanged.length > 0) {
            const lastFile = freshSession.filesChanged[freshSession.filesChanged.length - 1];
            state.updateFileChangeStatus(targetSessionId, lastFile.path, "approved");
            // Mark the chain node for this file as done
            const fileNode = [...freshSession.chainNodes].reverse().find(
              (n) => n.type === "command" && n.status === "active" &&
                (n.label.startsWith("Write ") || n.label.startsWith("Patch "))
            );
            if (fileNode) {
              state.updateChainNode(targetSessionId, fileNode.id, { status: "done" });
            }
            // Close the pending-agent-change diff tab for this file
            window.dispatchEvent(new CustomEvent("aurora-close-agent-diff", {
              detail: { path: lastFile.path },
            }));
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
          // Mark the chain node for this file as failed
          const fileNode = [...freshSession.chainNodes].reverse().find(
            (n) => n.type === "command" && n.status === "active" &&
              (n.label.startsWith("Write ") || n.label.startsWith("Patch "))
          );
          if (fileNode) {
            state.updateChainNode(targetSessionId, fileNode.id, { status: "failed" });
          }
          // Close the pending-agent-change diff tab for this file
          window.dispatchEvent(new CustomEvent("aurora-close-agent-diff", {
            detail: { path: lastFile.path },
          }));
        }
        
        const stepResult = await system.agentDeclineTool(
          freshSession.agentType,
          freshSession.agentMode,
          runId,
          toolCallId,
          targetSessionId
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
        { approved: true, answer },
        targetSessionId
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

    // Poll live "thinking" stream while the agent is working. The planning
    // text is streamed into the active "Planning" chain node so it appears as
    // the planning step of the chain of thought. Once the final step starts
    // emitting its completion JSON, the conclusion text streams into a live
    // "Conclusion" chain node.
    const pollThinking = () => {
      system.agentGetThinking(sessionId).then((res) => {
        if (!res || res.status !== "ok") return;
        const store = useAgentStore.getState();
        if (typeof res.thinking === "string") {
          store.setThinking(sessionId, res.thinking);
        }
        if (typeof res.planning === "string" && res.planning) {
          store.setPlanningThinking(sessionId, res.planning);
          const nodes = store.sessions[sessionId]?.chainNodes || [];
          const planningNode = nodes.find(
            (n) => n.type === "planning" && (n.status === "active" || n.status === "pending")
          );
          if (planningNode && planningNode.content !== res.planning) {
            store.updateChainNode(sessionId, planningNode.id, { content: res.planning });
          }
        }
        if (typeof res.conclusion === "string" && res.conclusion) {
          // Only one chain-of-thought node may load at a time. While Planning is
          // still active, keep the spinner on Planning and do NOT surface the
          // Conclusion node yet — it is created on the next poll, once Planning
          // has closed. This prevents Planning and Conclusion spinning together.
          const nodes = store.sessions[sessionId]?.chainNodes || [];
          const planningNode = nodes.find(
            (n) => n.type === "planning" && n.status === "active"
          );
          if (planningNode) {
            const planningShown =
              (store.sessions[sessionId]?.planningThinking || planningNode.content || "").trim().length > 0;
            if (planningShown) {
              store.updateChainNode(sessionId, planningNode.id, { status: "done" });
            }
            // Defer the Conclusion node until Planning is closed.
            return;
          }
          store.streamConclusion(sessionId, res.conclusion);
        }
      }).catch(() => {});
    };
    pollThinking();
    const thinkingIntervalId = setInterval(pollThinking, 300);

    return () => {
      clearInterval(intervalId);
      clearInterval(thinkingIntervalId);
    };
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

  // ── stopAgentRun ─────────────────────────────────────────────────────────
  // Stops the entire AI run: interrupts any running tool-call command (Ctrl-C on
  // its PTY session — the terminal session itself is left alive) and signals the
  // sidecar to abort the in-flight generation. Mirrors the blue "stop AI" button.
  const stopAgentRun = useCallback(() => {
    const targetSessionId = sessionRef.current;
    if (!targetSessionId) return;
    const state = useAgentStore.getState();

    // 1. Interrupt the running tool-call command (foreground process only).
    const ptySessionId = runningToolPtySessionRef.current;
    if (ptySessionId) {
      pty.write(ptySessionId, "\u0003").catch(console.error);
      const runningBlockId = useBlockStore.getState().runningBlockId[ptySessionId];
      if (runningBlockId) {
        useBlockStore.getState().updateBlock(ptySessionId, runningBlockId, {
          status: "cancelled",
          finished_at: Date.now(),
        });
        useBlockStore.getState().setRunningBlockId(ptySessionId, null);
        useBlockStore.getState().setCommandOutputReceived(ptySessionId, false);
      }
      useSessionStore.getState().setSessionBusy(ptySessionId, false);
      runningToolPtySessionRef.current = null;
    }

    // 2. Abort the in-flight sidecar generation (LLM step / tool resume).
    system.agentStopRun(targetSessionId).catch(() => {});

    // 3. Mark the run cancelled so the step loop halts. Guards in
    //    handleStepResult / executeNextStep make any late result a no-op.
    const snap = state.sessions[targetSessionId];
    if (snap && snap.status !== "completed" && snap.status !== "error") {
      state.failTask(targetSessionId, "Cancelled by user", "info");
    }
    // 4. Finalize any in-flight tool calls / queued commands so their loaders
    //    and spinners are removed from the frontend immediately on stop.
    useAgentStore.getState().finalizeInterruptedRun(targetSessionId);
    state.setPendingToolCall(targetSessionId, null);
    state.setCurrentCommandIndex(targetSessionId, -1);
    const finalSnap = useAgentStore.getState().sessions[targetSessionId];
    if (finalSnap) {
      state.addChatMessage(targetSessionId, {
        role: "assistant",
        content: "Task cancelled by user.",
        chainNodes: finalSnap.chainNodes ?? [],
        agentType: finalSnap.agentType,
      });
    }
  }, []);

  return {
    startTask,
    retryTask,
    approveAndRunPending,
    declinePending,
    skipPending,
    clearTask,
    submitAnswer,
    stopAgentRun,
    status: sessionState.status,
    queue: sessionState.queue,
    originalGoal: sessionState.originalGoal,
    lastMessage: sessionState.lastMessage,
    currentCommandIndex: sessionState.currentCommandIndex,
    stepCount: sessionState.stepCount,
    maxSteps: sessionState.maxSteps,
    chainNodes: sessionState.chainNodes,
    agentLogs: sessionState.agentLogs,
    thinking: sessionState.thinking,
    activeSubagent: sessionState.activeSubagent,
    chatHistory: sessionState.chatHistory,
    pendingToolCall: sessionState.pendingToolCall,
    filesChanged: sessionState.filesChanged,
    activeDrawerTab: sessionState.activeDrawerTab,
    model: sessionState.model,
  };
}
