import fastify from 'fastify';
import { mastra, memoryLogs } from './mastra';
import { auraMemory, getModelProvider } from './agents/aura';
import { listSkills, listMcps, parseFileContext, formatFileContexts, formatSelectionContext, FileContext } from './slash';
import { reviewSettings } from './tools';
import { rootLogger } from './logger';
import { resetThinking, getThinking, onChunkCapture } from './thinking';

const server = fastify({ logger: false });
const log = rootLogger.child({ service: 'server' });

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
  return { status: 'ok', thinking: getThinking(thread) };
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

  try {
    // Serialize per-thread so an out-of-band /api/btw question never runs
    // concurrently with the task's own generation loop on the same thread.
    const stepResult = await withThreadLock(threadId, async () => {
      // A fresh goal starts a new task — clear the previous thinking stream.
      if (goal) {
        resetThinking(threadId);
      }

      const generateOptions: any = {
        memory: {
          thread: threadId,
          resource: RESOURCE_ID,
        },
        requireToolApproval: true,
        maxSteps: 25,
        abortSignal: AbortSignal.timeout(120_000),
        onChunk: onChunkCapture(threadId),
      };

      if (model) {
        const activeProvider = process.env.ACTIVE_AI_PROVIDER || 'groq';
        generateOptions.model = getModelProvider(activeProvider, model);
        stepLog.info('Using model override', { provider: activeProvider, model });
      }

      if (threadId) {
        await compactThreadIfNeeded(threadId, agent, stepLog);
      }

      const response = await agent.generate(prompt, generateOptions);

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
        const errMsg = response.error?.message || response.text || 'Generation failed';
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
  }
});

// ── Tool approval endpoints ──────────────────────────────────────────────

server.post('/api/tool/approve', async (request, _reply) => {
  const body = request.body as any;
  const { agent_type, mode, runId, toolCallId, session_id } = body;
  const resumeData = body.resumeData ?? body.resume_data;

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

  try {
    // Serialize with other work on the same thread (e.g. /api/btw).
    const threadKey = session_id || runId || 'agent-view';
    const response = await withThreadLock(threadKey, async () =>
      agent.resumeGenerate(
        { approved: true, ...resumeData },
        {
          runId,
          toolCallId,
          maxSteps: 25,
          abortSignal: AbortSignal.timeout(120_000),
          onChunk: onChunkCapture(threadKey),
        }
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
      toolLog.warn('Content tripwire triggered on approval', { reason: response.tripwire.reason });
      return {
        status: 'error',
        message: `Generation blocked: ${response.tripwire.reason || 'Content policy violation'}.`,
      };
    }

    if (response.finishReason === 'suspended') {
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
    return {
      status: 'completed',
      message: response.text,
    };
  } catch (error: any) {
    toolLog.error('Tool approval threw exception', { error: error.message, stack: error.stack });
    return {
      status: 'error',
      message: `Failed to approve and resume tool call: ${error.message || 'Unknown error'}`,
    };
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

  try {
    // Serialize with other work on the same thread (e.g. /api/btw).
    const threadKey = session_id || runId || 'agent-view';
    const response = await withThreadLock(threadKey, async () =>
      agent.resumeGenerate(
        { approved: false },
        {
          runId,
          toolCallId,
          maxSteps: 25,
          abortSignal: AbortSignal.timeout(120_000),
          onChunk: onChunkCapture(threadKey),
        }
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
      const errMsg = response.error?.message || response.text || 'Generation failed';
      toolLog.error('Tool decline generation error', { error: response.error?.message });
      return { status: 'error', message: `Agent error: ${errMsg}.` };
    }

    if (response.finishReason === 'suspended') {
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
    return {
      status: 'completed',
      message: response.text,
    };
  } catch (error: any) {
    toolLog.error('Tool decline threw exception', { error: error.message, stack: error.stack });
    return {
      status: 'error',
      message: `Failed to decline and resume tool call: ${error.message || 'Unknown error'}`,
    };
  }
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

// ── /api/edit-code — AI inline code editing, no tools, no memory ───────────
server.post('/api/edit-code', async (request, _reply) => {
  const { prompt, code_before, code_after, selection } = request.body as any;
  const editLog = log.child({ endpoint: 'edit-code' });

  if (!prompt?.trim()) {
    editLog.warn('Edit request with empty prompt');
    return { status: 'error', message: 'No prompt provided' };
  }

  editLog.info('Edit request', { promptLength: prompt.length, hasSelection: !!selection });

  const agent = mastra.getAgent('codeCompletionAgent');
  const startTime = Date.now();

  const content = `You are an AI code editor. Your ONLY job is to modify the code based on the user's instruction.
Respond with ONLY the final modified code. No explanations. No markdown wrappers. No backticks.

Code before cursor:
\`\`\`
${code_before}
\`\`\`

Selected code${selection ? `:\n\`\`\`\n${selection}\n\`\`\`` : ': (no selection, edit based on cursor context)'}

${code_after ? `Code after cursor:\n\`\`\`\n${code_after}\n\`\`\`` : ''}

User instruction: ${prompt}`;

  try {
    const response = await agent.generate(content);
    const elapsed = Date.now() - startTime;
    editLog.info('Edit response', { elapsedMs: elapsed });

    if (response.finishReason === 'error' || response.error) {
      const errMsg = response.error?.message || response.text || 'Edit generation failed';
      editLog.error('Edit generation error', { error: response.error?.message });
      return { status: 'error', message: `Edit error: ${errMsg}` };
    }

    return { status: 'completed', code: response.text };
  } catch (error: any) {
    editLog.error('Edit threw exception', { error: error.message, stack: error.stack });
    return { status: 'error', message: error.message || 'Edit error' };
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

    const response = await agent.generate(
      `Chat message (respond conversationally, NOT as a command): ${message}`,
      {
        memory: { thread: threadId, resource: RESOURCE_ID },
        onChunk: onChunkCapture(threadId),
      }
    );
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

    return { status: 'completed', message: response.text };
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

    return { status: 'completed', message: response.text || '' };
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
function parseAuraResponse(text: string) {
  let src = text.trim();
  if (src.startsWith('```')) {
    const lines = src.split('\n');
    const start = lines.findIndex((l) => l.startsWith('```')) + 1;
    const end = lines.lastIndexOf('```');
    if (end > start) src = lines.slice(start, end).join('\n');
  }

  const candidates: any[] = [];
  let i = 0;
  while (i < src.length) {
    const start = src.indexOf('{', i);
    if (start === -1) break;
    let depth = 0;
    let j = start;
    while (j < src.length) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') {
        depth--;
        if (depth === 0) break;
      }
      j++;
    }
    const slice = src.substring(start, j + 1);
    try {
      const parsed = JSON.parse(slice);
      if (parsed && typeof parsed.status === 'string') {
        candidates.push(parsed);
      }
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
