import fastify from 'fastify';
import { mastra, memoryLogs } from './mastra';
import { auraMemory, getModelProvider } from './agents/aura';
import { reviewSettings } from './tools';
import { rootLogger } from './logger';

const server = fastify({ logger: false });
const log = rootLogger.child({ service: 'server' });

// ── Constants ─────────────────────────────────────────────────────────────
const RESOURCE_ID = 'aurora-user';

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
    const generateOptions: any = {
      memory: {
        thread: threadId,
        resource: RESOURCE_ID,
      },
      requireToolApproval: true,
      maxSteps: 25,
      abortSignal: AbortSignal.timeout(120_000),
    };

    if (model) {
      const activeProvider = process.env.ACTIVE_AI_PROVIDER || 'groq';
      generateOptions.model = getModelProvider(activeProvider, model);
      stepLog.info('Using model override', { provider: activeProvider, model });
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
  const { agent_type, mode, runId, toolCallId } = body;
  const resumeData = body.resumeData ?? body.resume_data;

  const toolLog = log.child({
    endpoint: 'tool/approve',
    agentType: agent_type,
    mode,
    runId,
    toolCallId,
  });

  toolLog.info('Tool approval request', { resumeDataKeys: resumeData ? Object.keys(resumeData) : undefined, resumeData });

  const agent = selectAgent(agent_type, mode);
  const startTime = Date.now();

  try {
    const response = await agent.resumeGenerate(
      { approved: true, ...resumeData },
      { runId, toolCallId, maxSteps: 25 }
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
  const { agent_type, mode, runId, toolCallId } = request.body as any;

  const toolLog = log.child({
    endpoint: 'tool/decline',
    agentType: agent_type,
    mode,
    runId,
    toolCallId,
  });

  toolLog.info('Tool decline request');

  const agent = selectAgent(agent_type, mode);
  const startTime = Date.now();

  try {
    const response = await agent.resumeGenerate(
      { approved: false },
      { runId, toolCallId, maxSteps: 25 }
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
    const response = await agent.generate(
      `Chat message (respond conversationally, NOT as a command): ${message}`,
      {
        memory: { thread: threadId, resource: RESOURCE_ID },
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
