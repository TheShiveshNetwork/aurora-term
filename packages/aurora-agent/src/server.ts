import fastify from 'fastify';
import { mastra } from './mastra';
import { auraMemory } from './agents/aura';

const server = fastify();

// ── Constants ─────────────────────────────────────────────────────────────
// All sessions share the same resource ID so working memory (user profile,
// preferences) persists globally across all terminal tabs.
const RESOURCE_ID = 'aurora-user';


// ── Health routes ─────────────────────────────────────────────────────────
server.get('/health', async () => ({ status: 'ok' }));
server.get('/global/health', async () => ({ status: 'ok' }));

// ── /api/step — single planning step in the agentic feedback loop ─────────
// `session_id`: the terminal tab's UUID — used as the memory thread ID so all
// tasks within the same tab share conversation history.
// `task_id`: a per-task UUID for internal bookkeeping (not used for memory).
server.post('/api/step', async (request, _reply) => {
  const { task_id, session_id, goal, last_output, exit_code } = request.body as any;

  const agent = mastra.getAgent('aura');

  // Use session_id as thread when available; fall back to task_id for backwards
  // compatibility with older frontend versions that don't send session_id yet.
  const threadId = session_id || task_id;

  // Build the prompt — first call uses the goal; subsequent calls use command output feedback.
  // Unescape any double-backslashes in last_output (they arise from Tauri IPC JSON serialization
  // of Windows paths like D:\builds\aurora, which become D:\\builds\\aurora in the raw string).
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
    });

    return parseAuraResponse(response.text);
  } catch (error: any) {
    const keyInfo = process.env.GROQ_API_KEY
      ? `(key prefix: ${process.env.GROQ_API_KEY.substring(0, 5)}...)`
      : '(no GROQ_API_KEY set)';
    return {
      status: 'error',
      message: `Agent error ${keyInfo}: ${error.message || 'Unknown error'}`,
    };
  }
});

// ── /api/chat — conversational, no command planning ───────────────────────
server.post('/api/chat', async (request, _reply) => {
  const { session_id, task_id, message } = request.body as any;
  if (!message?.trim()) {
    return { status: 'error', message: 'No message provided' };
  }

  const agent = mastra.getAgent('aura');
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
      perPage: false, // return all threads
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
// Query: ?threadId=<session-id>  (required — working memory is tied to a thread)
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
// When working memory tools are active, Mastra may concatenate the tool-call
// exchange with the final response, producing multiple JSON objects in the text.
// We find ALL balanced JSON objects and pick the last valid one (the final answer).
function parseAuraResponse(text: string) {
  // Strip markdown code fences if present
  let src = text.trim();
  if (src.startsWith('```')) {
    const lines = src.split('\n');
    const start = lines.findIndex((l) => l.startsWith('```')) + 1;
    const end = lines.lastIndexOf('```');
    if (end > start) src = lines.slice(start, end).join('\n');
  }

  // Collect all balanced JSON objects from the text
  const candidates: any[] = [];
  let i = 0;
  while (i < src.length) {
    const start = src.indexOf('{', i);
    if (start === -1) break;
    // Walk forward tracking brace depth to find the matching '}'
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

  // Use the LAST valid candidate — it's the agent's final answer after any tool calls
  const result = candidates[candidates.length - 1];
  if (result) {
    if (!['executing', 'completed', 'error'].includes(result.status)) {
      result.status = 'completed';
    }
    // Ensure message is plain text, not another JSON blob
    if (typeof result.message === 'object') {
      result.message = JSON.stringify(result.message);
    }
    return result;
  }

  // No valid JSON found — treat the whole text as a completion message
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
