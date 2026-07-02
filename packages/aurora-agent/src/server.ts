import fastify from 'fastify';
import { mastra, memoryLogs } from './mastra';
import { auraMemory } from './agents/aura';
import { reviewSettings } from './tools';

const server = fastify();

// ── Constants ─────────────────────────────────────────────────────────────
const RESOURCE_ID = 'aurora-user';

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
  } = request.body as any;

  // Dynamically update gating review settings from frontend preferences
  if (require_review_for_commands !== undefined) {
    reviewSettings.requireReviewForCommands = require_review_for_commands;
  }
  if (require_review_for_writes !== undefined) {
    reviewSettings.requireReviewForWrites = require_review_for_writes;
  }

  // Select the specialized agent based on request
  let agent: any = mastra.getAgent('aura');
  if (agent_type === 'terminal') {
    agent = mastra.getAgent('terminalAgent');
  } else if (agent_type === 'developer') {
    agent = mode === 'plan' ? mastra.getAgent('developerPlanAgent') : mastra.getAgent('developerBuildAgent');
  }

  const threadId = session_id || task_id;
  const cleanOutput = (last_output ?? '(no output)').replace(/\\\\/g, '\\');
  const prompt = goal
    ? `Goal: ${goal}`
    : `Previous command exit code: ${exit_code ?? 0}\nOutput:\n${cleanOutput}`;

  try {
    const response = await agent.generate(prompt, {
      memory: {
        thread: threadId,
        resource: RESOURCE_ID,
      },
      requireToolApproval: true,
    });

    if (response.finishReason === 'suspended') {
      return {
        status: 'requires_approval',
        runId: response.runId,
        toolCallId: response.suspendPayload?.toolCallId,
        toolName: response.suspendPayload?.toolName,
        args: response.suspendPayload?.args,
      };
    }

    // For backwards compatibility or direct completions, parse response
    return parseAuraResponse(response.text);
  } catch (error: any) {
    return {
      status: 'error',
      message: `Agent error: ${error.message || 'Unknown error'}`,
    };
  }
});

// ── Tool approval endpoints ──────────────────────────────────────────────

server.post('/api/tool/approve', async (request, _reply) => {
  const { agent_type, mode, runId, toolCallId, resumeData } = request.body as any;

  let agent: any = mastra.getAgent('aura');
  if (agent_type === 'terminal') {
    agent = mastra.getAgent('terminalAgent');
  } else if (agent_type === 'developer') {
    agent = mode === 'plan' ? mastra.getAgent('developerPlanAgent') : mastra.getAgent('developerBuildAgent');
  }

  try {
    const response = await agent.resumeGenerate(
      { approved: true, ...resumeData },
      { runId, toolCallId }
    );

    if (response.finishReason === 'suspended') {
      return {
        status: 'requires_approval',
        runId: response.runId,
        toolCallId: response.suspendPayload?.toolCallId,
        toolName: response.suspendPayload?.toolName,
        args: response.suspendPayload?.args,
      };
    }

    return {
      status: 'completed',
      message: response.text,
    };
  } catch (error: any) {
    return {
      status: 'error',
      message: `Failed to approve and resume tool call: ${error.message || 'Unknown error'}`,
    };
  }
});

server.post('/api/tool/decline', async (request, _reply) => {
  const { agent_type, mode, runId, toolCallId } = request.body as any;

  let agent: any = mastra.getAgent('aura');
  if (agent_type === 'terminal') {
    agent = mastra.getAgent('terminalAgent');
  } else if (agent_type === 'developer') {
    agent = mode === 'plan' ? mastra.getAgent('developerPlanAgent') : mastra.getAgent('developerBuildAgent');
  }

  try {
    const response = await agent.resumeGenerate(
      { approved: false },
      { runId, toolCallId }
    );

    if (response.finishReason === 'suspended') {
      return {
        status: 'requires_approval',
        runId: response.runId,
        toolCallId: response.suspendPayload?.toolCallId,
        toolName: response.suspendPayload?.toolName,
        args: response.suspendPayload?.args,
      };
    }

    return {
      status: 'completed',
      message: response.text,
    };
  } catch (error: any) {
    return {
      status: 'error',
      message: `Failed to decline and resume tool call: ${error.message || 'Unknown error'}`,
    };
  }
});

// ── /api/chat — conversational, no command planning ───────────────────────
server.post('/api/chat', async (request, _reply) => {
  const { session_id, task_id, message, agent_type, mode } = request.body as any;
  if (!message?.trim()) {
    return { status: 'error', message: 'No message provided' };
  }

  let agent: any = mastra.getAgent('aura');
  if (agent_type === 'terminal') {
    agent = mastra.getAgent('terminalAgent');
  } else if (agent_type === 'developer') {
    agent = mode === 'plan' ? mastra.getAgent('developerPlanAgent') : mastra.getAgent('developerBuildAgent');
  }

  const threadId = session_id || task_id || 'chat-default';

  try {
    const response = await agent.generate(
      `Chat message (respond conversationally, NOT as a command): ${message}`,
      {
        memory: { thread: threadId, resource: RESOURCE_ID },
      }
    );
    return { status: 'completed', message: response.text };
  } catch (error: any) {
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
  server.listen({ port, host: '127.0.0.1' }, (err, address) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
    console.log(`Aura agent server listening on ${address}`);
  });
}
