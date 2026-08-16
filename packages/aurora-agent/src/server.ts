import fastify from 'fastify';
import { mastra, memoryLogs } from './mastra';
import { auraMemory, getModelProvider } from './agents/aura';
import { listSkills, listMcps, parseFileContext, formatFileContexts, formatSelectionContext, FileContext } from './slash';
import { reviewSettings } from './tools';
import {
  readFileTool,
  grepSearchTool,
  listDirTool,
  searchFilesTool,
  globTool,
  webFetchTool,
} from './tools';
import { rootLogger } from './logger';
import {
  resetThinking,
  beginStep,
  getPhase,
  commitStep,
  discardStep,
  getThinking,
  getPlanning,
  getConclusion,
  appendThinking,
} from './thinking';

const server = fastify({ logger: false });
const log = rootLogger.child({ service: 'server' });

// ── Live streaming helper ──────────────────────────────────────────────────
// Runs an agent generation (stream or plain result) and appends every text
// delta into the per-thread thinking buffer so the UI can render the Planning /
// Conclusion chain-of-thought nodes live, chunk by chunk, as the model emits
// them. Falls back to a no-stream await if the run isn't a stream.
async function runStreaming(threadId: string, start: () => Promise<any>): Promise<any> {
  const gen = await start();
  const stream = gen && gen.textStream;
  if (stream && typeof stream[Symbol.asyncIterator] === "function") {
    try {
      for await (const chunk of stream) {
        if (typeof chunk === "string") appendThinking(threadId, chunk);
      }
    } catch (streamErr) {
      log.warn("thinking stream drain failed", { error: (streamErr as any)?.message });
    }
  }
  // `agent.stream` / `resumeStream` return a MastraModelOutput whose analysis
  // fields (text, toolCalls, finishReason, ...) are Promise getters. Resolve
  // the ones the agent loop consumes into a plain object shaped like the
  // generate() result so downstream code can read `response.text` as a string.
  const [textR, toolCallsR, finishR, toolResultsR, suspendR, usageR] = await Promise.allSettled([
    gen.text,
    gen.toolCalls,
    gen.finishReason,
    gen.toolResults,
    gen.suspendPayload,
    gen.usage,
  ]);
  return {
    text: textR.status === "fulfilled" ? (textR.value as string) : "",
    toolCalls: toolCallsR.status === "fulfilled" ? (toolCallsR.value as any[]) : [],
    finishReason: finishR.status === "fulfilled" ? (finishR.value as string | undefined) : undefined,
    toolResults: toolResultsR.status === "fulfilled" ? (toolResultsR.value as any[]) : [],
    suspendPayload: suspendR.status === "fulfilled" ? (suspendR.value as any) : undefined,
    usage: usageR.status === "fulfilled" ? (usageR.value as any) : undefined,
    runId: gen.runId,
    error: gen.error,
    tripwire: gen.tripwire,
  };
}

// ── Constants ─────────────────────────────────────────────────────────────
const RESOURCE_ID = 'aurora-user';

// ── Per-thread execution lock ─────────────────────────────────────────────
// Mastra stores thread history in a shared InMemoryStore. Two concurrent
// `generate`/`resumeGenerate` calls on the same thread (e.g. the normal step
// loop plus an out-of-band `/api/btw` question) can race and corrupt the
// thread. We serialize all LLM work per thread.
const threadLocks = new Map<string, Promise<unknown>>();

function withThreadLock<T>(threadId: string, fn: () => Promise<T>): Promise<T> {
  const prev = threadLocks.get(threadId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  // Keep the chain alive even if `fn` rejects; callers still observe `next`.
  threadLocks.set(
    threadId,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

// ── Per-thread run-abort registry ─────────────────────────────────────────
// Lets the frontend interrupt a generation (LLM step or tool resume) that is
// still in flight — e.g. when the user hits "stop" while a tool call (a shell
// command or a server-side read-only tool) is executing. Each run registers an
// AbortController keyed by thread; `/api/run/stop` aborts it.
const runAborts = new Map<string, AbortController>();

function registerRunAbort(threadId: string): AbortController {
  const ac = new AbortController();
  runAborts.set(threadId, ac);
  return ac;
}

function clearRunAbort(threadId: string): void {
  runAborts.delete(threadId);
}

// ── Helpers ───────────────────────────────────────────────────────────────

function selectAgent(agentType?: string, mode?: string) {
  const agentId =
    agentType === 'terminal' ? 'terminalAgent'
    : agentType === 'developer' && mode === 'plan' ? 'developerPlanAgent'
    : agentType === 'developer' ? 'developerBuildAgent'
    : 'aura' as const;
  log.info(`Selected agent: ${agentId}`, { agentType, mode });
  return mastra.getAgent(agentId);
}

function logFullResponse(l: typeof log, response: any) {
  l.debug('Full LLM response dump', {
    finishReason: response.finishReason,
    textLength: response.text?.length,
    text: response.text,
    error: response.error ? { message: response.error.message, stack: response.error.stack } : undefined,
    usage: response.usage,
    totalUsage: response.totalUsage,
    toolCalls: response.toolCalls?.map((tc: any) => ({
      toolName: tc.toolName,
      args: tc.args,
      id: tc.toolCallId || tc.id,
    })),
    toolResults: response.toolResults?.map((tr: any) => ({
      toolName: tr.toolName,
      isError: tr.isError,
      error: tr.error,
      result: typeof tr.result === 'string' ? tr.result.slice(0, 500) : tr.result,
    })),
    steps: response.steps?.map((s: any, i: number) => ({
      step: i,
      finishReason: s.finishReason,
      textLength: s.text?.length,
      toolCalls: s.toolCalls?.length,
      toolResults: s.toolResults?.length,
    })),
    suspendPayload: response.suspendPayload,
    warnings: response.warnings,
    tripwire: response.tripwire,
    runId: response.runId,
    traceId: response.traceId,
  });
  if (response.error) {
    l.error('Response contains error', {
      errorMessage: response.error.message,
      errorStack: response.error.stack,
    });
  }
  const failedToolResults = response.toolResults?.filter((tr: any) => tr.isError);
  if (failedToolResults?.length > 0) {
    l.warn('Failed tool calls', {
      failedTools: failedToolResults.map((tr: any) => ({
        toolName: tr.toolName,
        error: tr.error,
        args: tr.args,
      })),
    });
  }
  if (response.tripwire) {
    l.warn('Tripwire triggered', {
      reason: response.tripwire.reason,
      retry: response.tripwire.retry,
      metadata: response.tripwire.metadata,
    });
  }
}

// ── Global error handler — prevents unhandled route exceptions from crashing server ──────
server.setErrorHandler((error, _request, reply) => {
  log.error('Unhandled route error', {
    error: error.message,
    stack: error.stack,
    statusCode: error.statusCode || 500,
  });
  reply.status(error.statusCode || 500).send({
    status: 'error',
    message: `Internal server error: ${error.message}`,
  });
});

// ── Context Compaction Helper ──────────────────────────────────────────────
async function compactThreadIfNeeded(threadId: string, agent: any, stepLog: any) {
  try {
    const recalled = await auraMemory.recall({ threadId });
    if (recalled && recalled.messages && recalled.messages.length > 0) {
      let totalLength = 0;
      for (const msg of recalled.messages) {
        if (msg.content) {
          if (msg.content.parts && Array.isArray(msg.content.parts)) {
            for (const part of msg.content.parts) {
              if (part.type === 'text') {
                totalLength += part.text?.length || 0;
              } else if (part.type === 'tool-invocation') {
                totalLength += JSON.stringify(part.toolInvocation).length;
              } else {
                totalLength += JSON.stringify(part).length;
              }
            }
          } else {
            totalLength += JSON.stringify(msg.content).length;
          }
        }
      }
      const totalTokens = Math.ceil(totalLength / 4);

      if (totalTokens > 16000) {
        stepLog.info('History token size exceeds threshold, compacting...', { totalTokens, threadId });
        
        // Format transcript
        const transcript = recalled.messages
          .map(m => {
            let textContent = '';
            if (m.content) {
              if (m.content.parts && Array.isArray(m.content.parts)) {
                textContent = m.content.parts
                  .map((p: any) => (p.type === 'text' ? p.text : JSON.stringify(p)))
                  .join('\n');
              } else {
                textContent = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
              }
            }
            return `${m.role.toUpperCase()}: ${textContent}`;
          })
          .join('\n\n');
        
        const compactionPrompt = `You are a context compaction agent. Summarize the following terminal and developer session transcript. Preserve all key details: current working directory (CWD), previous actions, outcomes, file paths modified, errors encountered, and any pending checklist items. Be extremely concise but precise. Do not lose context.
        
        Transcript:
        ${transcript}`;
        
        // Generate summary using the current agent
        const summaryResponse = await agent.generate(compactionPrompt);
        const summaryText = summaryResponse.text || 'Compacted history.';
        
        // Delete thread and recreate with summary
        await auraMemory.deleteThread(threadId);
        await auraMemory.saveMessages({
          messages: [
            {
              role: 'system',
              content: {
                format: 2,
                parts: [
                  {
                    type: 'text',
                    text: `[SESSION CONTEXT COMPACTED]\nBelow is a summary of the session history so far. Use it to guide your actions:\n\n${summaryText}`
                  }
                ]
              },
              createdAt: new Date(),
              id: `compacted-${Date.now()}`,
              threadId,
            } as any
          ]
        });
        stepLog.info('History compacted successfully.', { threadId });
      }
    }
  } catch (err: any) {
    stepLog.error('Compaction failed', { error: err.message, stack: err.stack });
  }
}

// ── onRequest hook — log every incoming request ──────────────────────────
server.addHook('onRequest', async (request) => {
  log.debug('Incoming request', {
    method: request.method,
    url: request.url,
    ip: request.ip,
  });
});

// ── Health routes ─────────────────────────────────────────────────────────
server.get('/health', async () => ({ status: 'ok' }));
server.get('/global/health', async () => ({ status: 'ok' }));
server.get('/api/logs', async () => {
  return { status: 'ok', logs: memoryLogs };
});

// ── /api/thinking — live streaming "thinking" text for a thread ───────────
// Returns whatever the agent has streamed so far (text/reasoning deltas +
// tool-call announcements) for the given thread. Polled by the frontend while
// a task is running; empty string means "no thinking captured yet".
server.get('/api/thinking', async (request, _reply) => {
  const { thread } = (request.query as any) || {};
  if (!thread || typeof thread !== 'string') {
    return { status: 'error', message: 'thread query param is required' };
  }
  return {
    status: 'ok',
    thinking: getThinking(thread),
    planning: getPlanning(thread),
    conclusion: getConclusion(thread),
  };
});

// ── /api/step — single planning step in the agentic feedback loop ─────────
server.post('/api/step', async (request, _reply) => {
  const {
    task_id,
    session_id,
    goal,
    last_output,
    exit_code,
    agent_type,
    mode,
    require_review_for_commands,
    require_review_for_writes,
    model,
  } = request.body as any;

  const stepLog = log.child({
    taskId: task_id,
    sessionId: session_id,
    agentType: agent_type,
    mode,
  });

  stepLog.info('Step request received', {
    hasGoal: !!goal,
    hasLastOutput: !!last_output,
    exitCode: exit_code,
    requireReviewCommands: require_review_for_commands,
    requireReviewWrites: require_review_for_writes,
    model,
  });

  if (last_output) {
    stepLog.debug('Previous command output', { outputPreview: last_output.slice(0, 1000) });
  }
  if (goal) {
    stepLog.debug('Goal', { goal });
  }

  // Dynamically update gating review settings from frontend preferences
  if (require_review_for_commands !== undefined) {
    reviewSettings.requireReviewForCommands = require_review_for_commands;
    stepLog.debug('Updated review settings', { requireReviewForCommands: require_review_for_commands });
  }
  if (require_review_for_writes !== undefined) {
    reviewSettings.requireReviewForWrites = require_review_for_writes;
    stepLog.debug('Updated review settings', { requireReviewForWrites: require_review_for_writes });
  }

  // Select the specialized agent based on request
  const agent = selectAgent(agent_type, mode);

  const threadId = session_id || task_id;
  // Clear the previous run's thinking buffer immediately for a fresh goal so a
  // concurrent /api/thinking poll can't repaint the prior turn's planning while
  // the new run is queued behind the per-thread lock.
  if (goal) resetThinking(threadId);
  const cleanOutput = (last_output ?? '(no output)');
  const prompt = goal
    ? `Goal: ${goal}`
    : `Previous command exit code: ${exit_code ?? 0}\nOutput:\n${cleanOutput}`;

  stepLog.info('Calling LLM', {
    threadId,
    promptLength: prompt.length,
    promptPreview: prompt.slice(0, 300) + (prompt.length > 300 ? '...' : ''),
  });

  const startTime = Date.now();
  const runAbort = registerRunAbort(threadId);
  const runTimeout = setTimeout(() => runAbort.abort(), 120_000);

  try {
    // Serialize per-thread so an out-of-band /api/btw question never runs
    // concurrently with the task's own generation loop on the same thread.
    const stepResult = await withThreadLock(threadId, async () => {
      // A fresh goal's thinking buffer is cleared at handler entry (above) so a
      // concurrent poll can't repaint the previous turn. Begin the planning step.
      if (goal) {
        beginStep(threadId, 'planning');
      } else {
        beginStep(threadId, 'execution');
      }

      const generateOptions: any = {
        memory: {
          thread: threadId,
          resource: RESOURCE_ID,
        },
        requireToolApproval: true,
        maxSteps: 25,
        abortSignal: runAbort.signal,
      };

      if (model) {
        const activeProvider = process.env.ACTIVE_AI_PROVIDER || 'groq';
        generateOptions.model = getModelProvider(activeProvider, model);
        stepLog.info('Using model override', { provider: activeProvider, model });
      }

      if (threadId) {
        await compactThreadIfNeeded(threadId, agent, stepLog);
      }

      // Stream the run so the thinking buffer fills chunk-by-chunk: the Planning
      // and Conclusion chain-of-thought nodes render live as the model generates.
      const response = await runStreaming(threadId, () => agent.stream(prompt, generateOptions));

      const elapsed = Date.now() - startTime;
      stepLog.info('LLM response received', {
        elapsedMs: elapsed,
        finishReason: response.finishReason,
        textLength: response.text?.length,
        textPreview: response.text?.slice(0, 500) + (response.text?.length > 500 ? '...' : ''),
        usage: response.usage,
      });

      // Log full response details at debug level for troubleshooting
      logFullResponse(stepLog, response);

      // Handle generation errors (tool call failures, LLM errors, etc.)
      if (response.finishReason === 'error' || response.error) {
        discardStep(threadId);
        // Never surface the raw streamed text (which can be a partial `executing`
        // envelope) as the error message — derive a readable message instead.
        const parsed = parseAuraResponse(response.text);
        const errMsg = response.error?.message || parsed.message || 'Generation failed';
        stepLog.error('LLM generation error', {
          finishReason: response.finishReason,
          error: response.error?.message,
          errorStack: response.error?.stack,
        });
        return {
          status: 'error',
          message: `Agent error: ${errMsg}. Please try rephrasing your request.`,
        };
      }

      // Handle tripwire (content filter triggers)
      if (response.tripwire) {
        discardStep(threadId);
        stepLog.warn('Content tripwire triggered', {
          reason: response.tripwire.reason,
          retry: response.tripwire.retry,
        });
        if (response.tripwire.retry) {
          stepLog.info('Tripwire requested retry — will retry');
        }
        return {
          status: 'error',
          message: `Generation was blocked: ${response.tripwire.reason || 'Content policy violation'}. Please adjust your request.`,
        };
      }

      // Handle suspended tool calls
      if (response.finishReason === 'suspended') {
        // A suspended planning step still produced planning text worth keeping.
        if (getPhase(threadId) === 'planning') {
          commitStep(threadId);
        } else {
          discardStep(threadId);
        }
        const toolName = response.suspendPayload?.toolName;
        const toolArgs = response.suspendPayload?.args;
        stepLog.info('Tool call suspended — awaiting user approval', {
          toolName,
          toolArgs,
          runId: response.runId,
          toolCallId: response.suspendPayload?.toolCallId,
          toolCallsInResponse: response.toolCalls?.map((tc: any) => ({ name: tc.toolName, args: tc.args })),
        });

        return {
          status: 'requires_approval',
          runId: response.runId,
          toolCallId: response.suspendPayload?.toolCallId,
          toolName,
          args: toolArgs,
        };
      }

      // Check for tool-level errors (tools that executed but failed)
      const failedToolResults = response.toolResults?.filter((tr: any) => tr.isError);
      if (failedToolResults?.length > 0) {
        const failedNames = failedToolResults.map((tr: any) => tr.toolName).join(', ');
        stepLog.warn('Tool execution errors in response', {
          failedTools: failedToolResults.map((tr: any) => ({
            toolName: tr.toolName,
            error: tr.error,
          })),
        });
        // Don't return error here — the LLM may have handled it in-text
      }

      stepLog.info('Parsing LLM response for step result', {
        rawTextLength: response.text?.length,
      });

      const result = parseAuraResponse(response.text);
      stepLog.info('Step result parsed', { status: result.status, messageLength: result.message?.length, messagePreview: result.message?.slice(0, 200) });

      // Commit the streamed text into the planning bucket (goal step) or, when
      // the agent concludes, into the conclusion bucket. commitStep is
      // phase-aware: a completing planning step commits BOTH the planning
      // narrative and its `conclusion` field; a completing execution step
      // commits only the conclusion.
      if (result.status === 'completed' || goal) {
        commitStep(threadId);
      } else {
        discardStep(threadId);
      }
      return result;
    });
    return stepResult;
  } catch (error: any) {
    const elapsed = Date.now() - startTime;
    stepLog.error('Agent step threw exception', {
      error: error.message,
      stack: error.stack,
      elapsedMs: elapsed,
    });
    return {
      status: 'error',
      message: `Agent error: ${error.message || 'Unknown error'}`,
    };
  } finally {
    clearTimeout(runTimeout);
    clearRunAbort(threadId);
  }
});

// ── Tool approval endpoints ──────────────────────────────────────────────

// Read-only tools that execute entirely inside the sidecar. When the agent
// suspends on one of these and the frontend auto-approves, the frontend can
// only send `{ approved: true }` as resumeData — it cannot run the tool itself.
// If we resumed with that, the model would receive an empty result and re-issue
// the same tool call forever (e.g. re-reading the same file 10×). So we execute
// the tool here and feed its real output back as the resume payload.
const SIDECAR_READONLY_TOOLS: Record<string, any> = {
  read_file: readFileTool,
  grep_search: grepSearchTool,
  list_directory: listDirTool,
  search_files: searchFilesTool,
  glob: globTool,
  web_fetch: webFetchTool,
};

async function executeSidecarTool(toolName?: string, toolArgs?: any): Promise<any | undefined> {
  const tool = toolName ? SIDECAR_READONLY_TOOLS[toolName] : undefined;
  if (!tool?.execute || !toolArgs) return undefined;
  try {
    return await tool.execute(toolArgs);
  } catch (err: any) {
    rootLogger.error('Sidecar tool execution on resume failed', { toolName, error: err?.message });
    return { success: false, error: `Tool failed: ${err?.message || 'unknown'}` };
  }
}

server.post('/api/tool/approve', async (request, _reply) => {
  const body = request.body as any;
  const { agent_type, mode, runId, toolCallId, session_id } = body;
  const toolName = body.toolName ?? body.tool_name;
  const toolArgs = body.toolArgs ?? body.args;
  const providedResumeData = body.resumeData ?? body.resume_data;
  const isSidecarTool = !!(toolName && SIDECAR_READONLY_TOOLS[toolName]);
  const resumeData = isSidecarTool
    ? (await executeSidecarTool(toolName, toolArgs) ?? { success: false, error: 'tool produced no output' })
    : { approved: true, ...(providedResumeData ?? {}) };

  const toolLog = log.child({
    endpoint: 'tool/approve',
    agentType: agent_type,
    mode,
    runId,
    toolCallId,
    sessionId: session_id,
  });

  toolLog.info('Tool approval request', { resumeDataKeys: resumeData ? Object.keys(resumeData) : undefined, resumeData });

  const agent = selectAgent(agent_type, mode);
  const startTime = Date.now();
  const threadKey = session_id || runId || 'agent-view';
  const runAbort = registerRunAbort(threadKey);
  const runTimeout = setTimeout(() => runAbort.abort(), 120_000);

  try {
    // Serialize with other work on the same thread (e.g. /api/btw).
    beginStep(threadKey, 'execution');
    const response = await withThreadLock(threadKey, async () =>
      runStreaming(threadKey, () =>
        agent.resumeStream(
          resumeData,
          {
            runId,
            toolCallId,
            maxSteps: 25,
            abortSignal: runAbort.signal,
          }
        )
      )
    );

    const elapsed = Date.now() - startTime;
    toolLog.info('Tool approval LLM response', {
      elapsedMs: elapsed,
      finishReason: response.finishReason,
      textLength: response.text?.length,
      textPreview: response.text?.slice(0, 300) + (response.text?.length > 300 ? '...' : ''),
    });

    logFullResponse(toolLog, response);

    if (response.finishReason === 'error' || response.error) {
      discardStep(threadKey);
      const errMsg = response.error?.message || response.text || 'Generation failed';
      toolLog.error('Tool approval generation error', {
        error: response.error?.message,
        errorStack: response.error?.stack,
      });
      return {
        status: 'error',
        message: `Agent error: ${errMsg}. Please try again.`,
      };
    }

    if (response.tripwire) {
      discardStep(threadKey);
      toolLog.warn('Content tripwire triggered on approval', { reason: response.tripwire.reason });
      return {
        status: 'error',
        message: `Generation blocked: ${response.tripwire.reason || 'Content policy violation'}.`,
      };
    }

    if (response.finishReason === 'suspended') {
      discardStep(threadKey);
      const toolName = response.suspendPayload?.toolName;
      toolLog.info('Tool call re-suspended after approval', { toolName, toolArgs: response.suspendPayload?.args });
      return {
        status: 'requires_approval',
        runId: response.runId,
        toolCallId: response.suspendPayload?.toolCallId,
        toolName,
        args: response.suspendPayload?.args,
      };
    }

    toolLog.info('Tool approval completed');
    commitStep(threadKey);
    const parsed = parseAuraResponse(response.text);
    return {
      status: 'completed',
      message: parsed.message || response.text,
      conclusion: parsed.conclusion,
      planning: parsed.planning,
    };
  } catch (error: any) {
    toolLog.error('Tool approval threw exception', { error: error.message, stack: error.stack });
    return {
      status: 'error',
      message: `Failed to approve and resume tool call: ${error.message || 'Unknown error'}`,
    };
  } finally {
    clearTimeout(runTimeout);
    clearRunAbort(threadKey);
  }
});

server.post('/api/tool/decline', async (request, _reply) => {
  const { agent_type, mode, runId, toolCallId, session_id } = request.body as any;

  const toolLog = log.child({
    endpoint: 'tool/decline',
    agentType: agent_type,
    mode,
    runId,
    toolCallId,
    sessionId: session_id,
  });

  toolLog.info('Tool decline request');

  const agent = selectAgent(agent_type, mode);
  const startTime = Date.now();
  const threadKey = session_id || runId || 'agent-view';
  const runAbort = registerRunAbort(threadKey);
  const runTimeout = setTimeout(() => runAbort.abort(), 120_000);

  try {
    // Serialize with other work on the same thread (e.g. /api/btw).
    beginStep(threadKey, 'execution');
    const response = await withThreadLock(threadKey, async () =>
      runStreaming(threadKey, () =>
        agent.resumeStream(
          { approved: false },
          {
            runId,
            toolCallId,
            maxSteps: 25,
            abortSignal: runAbort.signal,
          }
        )
      )
    );

    const elapsed = Date.now() - startTime;
    toolLog.info('Tool decline LLM response', {
      elapsedMs: elapsed,
      finishReason: response.finishReason,
      textLength: response.text?.length,
    });

    logFullResponse(toolLog, response);

    if (response.finishReason === 'error' || response.error) {
      discardStep(threadKey);
      const errMsg = response.error?.message || response.text || 'Generation failed';
      toolLog.error('Tool decline generation error', { error: response.error?.message });
      return { status: 'error', message: `Agent error: ${errMsg}.` };
    }

    if (response.finishReason === 'suspended') {
      discardStep(threadKey);
      const toolName = response.suspendPayload?.toolName;
      toolLog.info('Tool call re-suspended after decline', { toolName, toolArgs: response.suspendPayload?.args });
      return {
        status: 'requires_approval',
        runId: response.runId,
        toolCallId: response.suspendPayload?.toolCallId,
        toolName,
        args: response.suspendPayload?.args,
      };
    }

    toolLog.info('Tool decline completed');
    commitStep(threadKey);
    const parsed = parseAuraResponse(response.text);
    return {
      status: 'completed',
      message: parsed.message || response.text,
      conclusion: parsed.conclusion,
      planning: parsed.planning,
    };
  } catch (error: any) {
    toolLog.error('Tool decline threw exception', { error: error.message, stack: error.stack });
    return {
      status: 'error',
      message: `Failed to decline and resume tool call: ${error.message || 'Unknown error'}`,
    };
  } finally {
    clearTimeout(runTimeout);
    clearRunAbort(threadKey);
  }
});

// ── /api/run/stop — interrupt an in-flight generation (LLM step or tool
// resume) for a thread. Used by the frontend "stop AI run" action so a running
// tool call (shell command or server-side read-only tool) and the agent's
// generation halt immediately instead of running to completion. This never
// touches any terminal session — it only aborts the agent's own work. ──────
server.post('/api/run/stop', async (request, _reply) => {
  const { thread_id } = (request.body as any) || {};
  if (thread_id && runAborts.has(thread_id)) {
    runAborts.get(thread_id)!.abort();
    clearRunAbort(thread_id);
    log.info('Run stop requested', { threadId: thread_id });
    return { status: 'ok', stopped: thread_id };
  }
  return { status: 'ok', stopped: null };
});

// ── /api/inline-complete — fast ghost text completion, no tools, no memory ─
server.post('/api/inline-complete', async (request, _reply) => {
  const { context_before, language } = request.body as any;
  const compLog = log.child({ endpoint: 'inline-complete' });

  if (!context_before?.trim()) {
    return { status: 'completed', completion: '' };
  }

  compLog.info('Inline completion request', {
    contextLength: context_before.length,
    language,
  });

  const agent = mastra.getAgent('codeCompletionAgent');
  const startTime = Date.now();

  const prompt = `You are a code completion engine. Complete the code at the cursor position (marked by █).
Respond with ONLY the completion text — no explanations, no markdown, no backticks, no surrounding code.

Language: ${language || 'unknown'}

Context:
${context_before}█

Completion:`;

  try {
    const response = await agent.generate(prompt);
    const elapsed = Date.now() - startTime;
    compLog.info('Completion done', { elapsedMs: elapsed, textLength: response.text?.length });

    if (response.finishReason === 'error' || response.error) {
      return { status: 'error', completion: '' };
    }

    const completion = (response.text || '').trim();
    return { status: 'completed', completion };
  } catch (error: any) {
    compLog.warn('Completion failed', { error: error.message });
    return { status: 'error', completion: '' };
  }
});

// ── /api/chat — conversational, no command planning ───────────────────────
server.post('/api/chat', async (request, _reply) => {
  const { session_id, task_id, message, agent_type, mode } = request.body as any;
  const chatLog = log.child({ endpoint: 'chat', sessionId: session_id, taskId: task_id, agentType: agent_type, mode });

  if (!message?.trim()) {
    chatLog.warn('Chat request with empty message');
    return { status: 'error', message: 'No message provided' };
  }

  chatLog.info('Chat request', { messageLength: message.length, messagePreview: message.slice(0, 100) });

  const agent = selectAgent(agent_type, mode);
  const threadId = session_id || task_id || 'chat-default';
  const startTime = Date.now();

  try {
    if (threadId) {
      await compactThreadIfNeeded(threadId, agent, chatLog);
    }

    const response = await runStreaming(threadId, () => agent.stream(
      `Chat message (respond conversationally, NOT as a command): ${message}`,
      {
        memory: { thread: threadId, resource: RESOURCE_ID },
      }
    ));
    const elapsed = Date.now() - startTime;

    chatLog.info('Chat response', {
      elapsedMs: elapsed,
      textLength: response.text?.length,
      textPreview: response.text?.slice(0, 200),
    });

    logFullResponse(chatLog, response);

    if (response.finishReason === 'error' || response.error) {
      const errMsg = response.error?.message || response.text || 'Chat generation failed';
      chatLog.error('Chat generation error', { error: response.error?.message });
      return { status: 'error', message: `Chat error: ${errMsg}` };
    }

    const parsed = parseAuraResponse(response.text);
    const chatMessage =
      parsed.message && parsed.message.trim()
        ? parsed.message
        : (parsed.planning && parsed.planning.trim()) || parsed.conclusion || "";
    return { status: parsed.status || "completed", message: chatMessage };
  } catch (error: any) {
    chatLog.error('Chat threw exception', { error: error.message, stack: error.stack });
    return { status: 'error', message: error.message || 'Chat error' };
  }
});

// ── /api/btw — out-of-band question while a task runs in the background ───
// Uses the chatAgent, which has NO tools. It can never suspend, never queue a
// command, and never write into the task's thread (no `memory` is passed), so
// asking "btw, how does X work?" never corrupts or interrupts the running task.
server.post('/api/btw', async (request, _reply) => {
  const { session_id, message, model } = request.body as any;
  const btwLog = log.child({ endpoint: 'btw', sessionId: session_id });

  if (!message?.trim()) {
    btwLog.warn('btw request with empty message');
    return { status: 'error', message: 'No message provided' };
  }

  btwLog.info('btw request', { messageLength: message.length, messagePreview: message.slice(0, 100) });

  const startTime = Date.now();

  try {
    const agent = mastra.getAgent('chatAgent');
    const generateOptions: any = {
      maxSteps: 1,
      abortSignal: AbortSignal.timeout(45_000),
    };
    if (model) {
      const activeProvider = process.env.ACTIVE_AI_PROVIDER || 'groq';
      generateOptions.model = getModelProvider(activeProvider, model);
    }
    const response = await agent.generate(message, generateOptions);
    const elapsed = Date.now() - startTime;

    btwLog.info('btw response', {
      elapsedMs: elapsed,
      textLength: response.text?.length,
      textPreview: response.text?.slice(0, 200),
    });

    if (response.finishReason === 'error' || response.error) {
      const errMsg = response.error?.message || response.text || 'Generation failed';
      btwLog.error('btw generation error', { error: response.error?.message });
      return { status: 'error', message: `btw error: ${errMsg}` };
    }

    const parsed = parseAuraResponse(response.text);
    const btwMessage =
      parsed.message && parsed.message.trim()
        ? parsed.message
        : (parsed.planning && parsed.planning.trim()) || parsed.conclusion || "";
    return { status: parsed.status || "completed", message: btwMessage };
  } catch (error: any) {
    btwLog.error('btw threw exception', { error: error.message, stack: error.stack });
    return { status: 'error', message: error.message || 'btw error' };
  }
});

// ── /api/file/context — build FILE CONTEXT block for open files ───────────
// Accepts a list of absolute paths and returns a prompt-ready `[FILE CONTEXT]`
// block (metadata + preview only — never the full file contents). Used by the
// `/file` slash command and by the step loop to keep open editor files in scope.
server.post('/api/file/context', async (request, _reply) => {
  const { paths, cwd, preview_chars, selection } = request.body as any;
  const fcLog = log.child({ endpoint: 'file/context' });

  const filePaths: string[] = Array.isArray(paths) ? paths.filter((p) => typeof p === 'string') : [];
  if (!filePaths.length) {
    return { status: 'completed', context: '' };
  }

  fcLog.info('Building file context', { fileCount: filePaths.length, cwd, hasSelection: Boolean(selection) });

  const root = typeof cwd === 'string' && cwd.trim() ? cwd : process.cwd();
  const prevCwd = process.cwd();
  if (root !== prevCwd) {
    try {
      process.chdir(root);
    } catch {
      // Keep current cwd if the requested one is invalid
    }
  }
  try {
    const contexts = filePaths
      .map((p) => parseFileContext(p, preview_chars ? { previewChars: Number(preview_chars) } : undefined))
      .filter((ctx): ctx is FileContext => ctx !== null);
    const block = formatFileContexts(contexts);
    const parts = [block];
    if (
      selection &&
      typeof selection === 'object' &&
      typeof selection.text === 'string' &&
      selection.text.trim()
    ) {
      parts.push(formatSelectionContext({
        path: typeof selection.path === 'string' ? selection.path : filePaths[0],
        startLine: Number(selection.startLine) || 1,
        endLine: Number(selection.endLine) || Number(selection.startLine) || 1,
        text: selection.text,
      }));
    }
    const context = parts.filter(Boolean).join('\n\n');
    fcLog.info('File context built', { included: contexts.length, chars: context.length });
    return { status: 'completed', context, files: contexts };
  } catch (error: any) {
    fcLog.error('File context failed', { error: error.message });
    return { status: 'error', message: error.message || 'Failed to build file context' };
  } finally {
    if (root !== prevCwd) {
      try {
        process.chdir(prevCwd);
      } catch {
        // ignore
      }
    }
  }
});

// ── /api/skills — enumerate discoverable agent skills ─────────────────────
server.get('/api/skills', async (request, _reply) => {
  const { cwd } = (request.query as any) || {};
  const skillsLog = log.child({ endpoint: 'skills' });
  try {
    const result = listSkills(cwd || undefined);
    const projectCount = result.project.length;
    const globalCount = result.global.length;
    skillsLog.info('Skills listed', { projectCount, globalCount });
    return { status: 'ok', ...result, total: projectCount + globalCount };
  } catch (error: any) {
    skillsLog.error('Skills listing failed', { error: error.message });
    return { status: 'error', message: error.message || 'Failed to list skills' };
  }
});

// ── /api/mcp — enumerate configured MCP servers ───────────────────────────
server.get('/api/mcp', async (request, _reply) => {
  const { cwd } = (request.query as any) || {};
  const mcpLog = log.child({ endpoint: 'mcp' });
  try {
    const result = listMcps(cwd || undefined);
    const projectCount = result.project.length;
    const globalCount = result.global.length;
    mcpLog.info('MCP servers listed', { projectCount, globalCount });
    return { status: 'ok', ...result, total: projectCount + globalCount };
  } catch (error: any) {
    mcpLog.error('MCP listing failed', { error: error.message });
    return { status: 'error', message: error.message || 'Failed to list MCP servers' };
  }
});

// ── /api/memory/threads — list all threads for the global resource ─────────
server.get('/api/memory/threads', async (_request, _reply) => {
  try {
    const result = await auraMemory.listThreads({
      filter: { resourceId: RESOURCE_ID },
      perPage: false,
    });
    return { status: 'ok', threads: result.threads };
  } catch (error: any) {
    return { status: 'error', message: error.message || 'Failed to list threads' };
  }
});

// ── /api/memory/thread/:threadId — delete a thread's history ─────────────
server.delete('/api/memory/thread/:threadId', async (request, _reply) => {
  const { threadId } = request.params as { threadId: string };
  try {
    await auraMemory.deleteThread(threadId);
    return { status: 'ok', deleted: threadId };
  } catch (error: any) {
    return { status: 'error', message: error.message || 'Failed to delete thread' };
  }
});

// ── /api/memory/working — get current working memory (user profile) ────────
server.get('/api/memory/working', async (request, _reply) => {
  const { threadId } = (request.query as any) || {};
  if (!threadId) {
    return { status: 'error', message: 'threadId query param is required' };
  }
  try {
    const workingMemory = await auraMemory.getWorkingMemory({
      threadId,
      resourceId: RESOURCE_ID,
    });
    return { status: 'ok', workingMemory };
  } catch (error: any) {
    return { status: 'error', message: error.message || 'Failed to get working memory' };
  }
});

// ── Response parser ───────────────────────────────────────────────────────
// Pull a single string field out of streamed (possibly malformed) JSON using a
// regex tolerant of unescaped newlines and pretty-printing inside string values.
function extractStringField(src: string, field: string): string | undefined {
  const re = new RegExp('"' + field + '"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"', 'g');
  let m: RegExpExecArray | null;
  let last: string | undefined;
  while ((m = re.exec(src))) {
    const v = m[1].trim();
    if (v) last = v;
  }
  return last;
}

function parseAuraResponse(text: string) {
  let src = text.trim();

  // Strip a ```json (or plain ```) fenced block if present, even when it is
  // preceded by a reasoning preamble — the model sometimes fences the response.
  const fenced = src.match(/```[a-zA-Z]*\n([\s\S]*?)\n```/);
  if (fenced) src = fenced[1].trim();

  // 1) Strict: brace-match + JSON.parse each candidate object (string-aware so
  //    braces inside string values are ignored). Picks the LAST object carrying
  //    a `status` field.
  const candidates: any[] = [];
  let i = 0;
  while (i < src.length) {
    const start = src.indexOf('{', i);
    if (start === -1) break;
    let depth = 0;
    let j = start;
    let inStr = false;
    let esc = false;
    while (j < src.length) {
      const c = src[j];
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = !inStr;
      else if (!inStr) {
        if (c === '{') depth++;
        else if (c === '}') {
          depth--;
          if (depth === 0) break;
        }
      }
      j++;
    }
    const slice = src.substring(start, j + 1);
    try {
      const parsed = JSON.parse(slice);
      if (parsed && typeof parsed.status === 'string') candidates.push(parsed);
    } catch { /* skip malformed */ }
    i = j + 1;
  }

  const result = candidates[candidates.length - 1];
  if (result) {
    if (!['executing', 'completed', 'error'].includes(result.status)) {
      result.status = 'completed';
    }
    if (typeof result.message === 'object') {
      result.message = JSON.stringify(result.message);
    }
    return result;
  }

  // 2) Lenient fallback: regex field extraction. This is what saves us when the
  //    model emits pretty-printed JSON with unescaped newlines inside the
  //    `message` string (which makes JSON.parse throw). The raw JSON never leaks
  //    into the UI because we only hand back the individual field values.
  const status = extractStringField(src, 'status');
  const message = extractStringField(src, 'message');
  const planning = extractStringField(src, 'planning');
  const conclusion = extractStringField(src, 'conclusion');
  const command = extractStringField(src, 'command');
  const explanation = extractStringField(src, 'explanation');
  if (status || message || command) {
    const clean: any = { status: status || 'completed' };
    if (message) clean.message = message;
    if (planning) clean.planning = planning;
    if (conclusion) clean.conclusion = conclusion;
    if (command) clean.command = command;
    if (explanation) clean.explanation = explanation;
    return clean;
  }

  return {
    status: 'completed',
    message: src || text,
  };
}

// ── Server bootstrap ──────────────────────────────────────────────────────
export function startServer(port: number) {
  log.info('=== Aurora Agent Server Starting ===', { port, cwd: process.cwd(), nodeVersion: process.version });
  log.info('Registered routes', { routes: server.printRoutes() });
  server.listen({ port, host: '127.0.0.1' }, (err, address) => {
    if (err) {
      log.error('Failed to start server', { error: err.message, stack: err.stack });
      process.exit(1);
    }
    log.info(`Server listening on ${address}`);
  });
}
