import { auraMemory } from './memory';
import { getModelProvider } from './model-provider';
import { rootLogger } from '../../logger';

const log = rootLogger.child({ module: 'session-title' });

const MAX_TITLE_LENGTH = 60;
const MAX_TITLE_WORDS = 6;
const MIN_TITLE_WORDS = 3;
const MAX_GOAL_CHARS = 1500;
const RESOURCE_ID = 'aurora-user';

const SYSTEM_PROMPT = [
  'You name software engineering sessions.',
  `Reply with a single short sentence of ${MIN_TITLE_WORDS} to ${MAX_TITLE_WORDS} words that names the WORK, not the request.`,
  'Use title case. No trailing punctuation, no quotes, no markdown, no explanation, no preamble.',
  'Good: "Fix auth token refresh", "Migrate billing to Stripe".',
  'Bad: "User asked for help with authentication", "Sure! Here is a title:".',
].join(' ');

export interface TitleRequest {
  sessionId: string;
  projectId: string;
  goal: string;
  model?: string;
}

export interface TitleResult {
  status: 'ok' | 'skipped' | 'error';
  title?: string;
}

const PREAMBLE =
  /^(?:sure|certainly|of course|okay|ok|here(?:'s| is)|title|session)\b[^:\n]*:\s*/i;

/** Strips decoration the model adds despite the instructions. */
export function cleanTitle(raw: string): string | null {
  let text = raw.trim();
  const fenced = text.match(/```[a-zA-Z]*\n?([\s\S]*?)```/);
  if (fenced) text = fenced[1].trim();
  text = text
    .replace(/^["'`*\s]+/, '')
    .replace(/["'`*.\s]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  // Models often prefix the answer with an acknowledgement; keep only what
  // follows the first colon.
  text = text.replace(PREAMBLE, '').replace(/^["'`*\s]+/, '').trim();
  if (!text) return null;

  const words = text.split(' ').slice(0, MAX_TITLE_WORDS).join(' ');
  const clipped = words.length > MAX_TITLE_LENGTH ? words.slice(0, MAX_TITLE_LENGTH).trim() : words;
  if (clipped.length < 2) return null;

  return clipped
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Tags a thread with its owning project. Threads are created implicitly by
 * `agent.stream(...)`, so the record is created first when missing —
 * `updateThread` throws on an unknown id.
 */
export async function attachThreadToProject(
  sessionId: string,
  projectId: string,
  title?: string,
): Promise<void> {
  if (!sessionId || !projectId) return;

  const existing = await auraMemory.getThreadById({ threadId: sessionId });
  const now = new Date();

  if (!existing) {
    await auraMemory.saveThread({
      thread: {
        id: sessionId,
        title: title ?? '',
        resourceId: RESOURCE_ID,
        metadata: { projectId },
        createdAt: now,
        updatedAt: now,
      } as any,
    });
    return;
  }

  await auraMemory.updateThread({
    id: sessionId,
    title: title ?? existing.title ?? '',
    metadata: { ...(existing.metadata ?? {}), projectId },
  });
}

/**
 * Turns a session's opening goal into a short title and stores it on the thread.
 *
 * Runs on the zero-tool chat agent with memory explicitly disabled, so it can
 * never touch a session's conversation or compete with an in-flight step. Every
 * failure is swallowed: the caller already holds a locally derived title.
 */
export async function generateSessionTitle(
  titleAgent: { generate: (message: string, options?: any) => Promise<any> },
  request: TitleRequest,
): Promise<TitleResult> {
  const goal = request.goal?.trim();
  if (!request.sessionId || !goal) return { status: 'skipped' };

  try {
    const response = await titleAgent.generate(
      `${SYSTEM_PROMPT}\n\nSession goal:\n${goal.slice(0, MAX_GOAL_CHARS)}\n\nTitle:`,
      {
        maxSteps: 1,
        memory: null,
        modelSettings: { temperature: 0.2 },
        ...(request.model ? { model: await getModelProvider(undefined, request.model) } : {}),
        abortSignal: AbortSignal.timeout(20_000),
      },
    );

    const title = cleanTitle(response?.text ?? '');
    if (!title) return { status: 'skipped' };

    await attachThreadToProject(request.sessionId, request.projectId, title);
    log.info('Generated session title', { sessionId: request.sessionId, title });
    return { status: 'ok', title };
  } catch (error: any) {
    log.warn('Session title generation failed', {
      sessionId: request.sessionId,
      error: error?.message,
    });
    return { status: 'error' };
  }
}
