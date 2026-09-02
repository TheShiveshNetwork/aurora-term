import fastify from 'fastify';
import { mastra, memoryLogs } from './mastra';
import { auraMemory, getModelProvider } from './agents';
import { getRuntimeSettings, updateRuntimeSettingsFromEnv } from './runtime-settings';
import { listSkills, listMcps } from './slash-resources';
import {
  parseFileContext,
  formatFileContexts,
  formatSelectionContext,
  type FileContext,
} from './agents/shared/file-context';
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
  clearCurrentStepRaw,
  getThinking,
  getPlanning,
  getConclusion,
  appendThinking,
} from './thinking';
import { isValidAuraEnvelope } from './processors/auraResponseValidator';
import { auraResponseSchema, AURA_FORMAT_CONTRACT } from './schemas/auraEnvelope';
import { isWorkingMemoryEnabled } from './working-memory-policy';

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
  const [textR, toolCallsR, finishR, toolResultsR, suspendR, usageR, objectR, errorR] = await Promise.allSettled([
    gen.text,
    gen.toolCalls,
    gen.finishReason,
    gen.toolResults,
    gen.suspendPayload,
    gen.usage,
    // Schema-validated structured output — only present when the call passed
    // `structuredOutput`. The framework guarantees this object matches
    // auraResponseSchema (#52).
    gen.object,
    // Capture the generation error (if any) so we can distinguish a
    // structured-output validation failure from a real API/transport error.
    gen.error,
  ]);
  const rawText = textR.status === "fulfilled" ? ((textR.value as string) ?? "") : "";
  let text = rawText;
  let object: unknown = undefined;
  if (objectR.status === "fulfilled" && objectR.value && typeof objectR.value === "object") {
    object = objectR.value;
    // Canonicalize: downstream handlers all parse `text` through
    // parseAuraResponse. Serializing the framework-validated object into text
    // means every consumer receives a guaranteed-well-formed envelope without
    // any per-handler changes.
    text = JSON.stringify(object);
  }

  // A structured-output validation failure (e.g. the model replied with plain
  // prose instead of the JSON envelope) surfaces as `error`/`object`-rejection
  // here. The emitted `text` is still usable, so DON'T mark this as a hard
  // error — let the retry / envelope-parse logic downstream salvage it instead
  // of returning a raw "Structured output validation failed" message to the
  // user. Real API/transport errors (no usable text) are left intact.
  let error: any = errorR.status === "fulfilled" ? errorR.value : undefined;
  let finishReason: string | undefined = finishR.status === "fulfilled" ? (finishR.value as string | undefined) : undefined;
  const validationErrMsg =
    (error && error.message ? String(error.message) : "") ||
    (objectR.status === "rejected" ? String((objectR.reason as any)?.message ?? objectR.reason) : "");
  const isStructuredValidationFailure =
    !!validationErrMsg &&
    /validation|Expected .* received|JSON parsing failed/i.test(validationErrMsg) &&
    rawText.trim().length > 0;
  if (isStructuredValidationFailure) {
    error = undefined;
    if (finishReason === "error") finishReason = undefined;
  }

  return {
    text,
    object,
    toolCalls: toolCallsR.status === "fulfilled" ? (toolCallsR.value as any[]) : [],
    finishReason,
    toolResults: toolResultsR.status === "fulfilled" ? (toolResultsR.value as any[]) : [],
    suspendPayload: suspendR.status === "fulfilled" ? (suspendR.value as any) : undefined,
    usage: usageR.status === "fulfilled" ? (usageR.value as any) : undefined,
    // The workflow snapshot used for resumeStream() is persisted under the
    // *agentic-loop* run id, which is exposed on the suspend payload's
    // `__workflow_meta.runId`. `gen.runId` may instead be the inner execution
    // run id, which would make resumeStream() fail to find the snapshot. Prefer
    // the suspend-payload run id and fall back to gen.runId.
    runId: (suspendR.status === "fulfilled" && (suspendR.value as any)?.__workflow_meta?.runId) || gen.runId,
    error,
    tripwire: gen.tripwire,
  };
}

// ── Transport (connection) error classification + retry ────────────────────
// A connection/network error from the provider (DNS failure, refused socket,
// timeout, proxy, 5xx) is transient and has NOTHING to do with the prompt — so
// it must not be surfaced as "please rephrase your request", and a single blip
// should not kill the whole turn. `isTransportError` recognizes that class so
// `runStreamingWithRetry` can transparently resend, and so the user-facing
// messages can tell the user the real problem (check network / provider URL).
function isTransportError(err: unknown): boolean {
  const raw = err && (err as any).message ? String((err as any).message) : String(err || '');
  const msg = raw.toLowerCase();
  if (!msg) return false;
  // Include upstream 429/5xx rate-limit markers that are transient and benefit from retry,
  // plus common Node/fetch network phrases. Keep this intentionally broad — false
  // positives only cause an extra retry, while false negatives surface a raw
  // "rephrase your request" error for a real network blip.
  return /unable to (connect|reach|access)|econnrefused|econnreset|enotfound|getaddrinfo|fetch failed|failed to fetch|network|timed? ?out|etimedout|socket|aborted|429|502|503|504|529|overloaded|rate.?limit|too many requests|proxy|tunnel|certificate|ssl|tls|dns|could not be reached|no route|connection|upstream|service unavailable|temporarily unavailable/i.test(
    msg,
  );
}

// Resends the generation when the only failure is a transport/connection error,
// with exponential backoff. Schema/validation/content errors are returned
// immediately — re-sending them won't help, and the envelope self-repair loop
// (runAgentStreamValidated) handles those separately. 429/529 rate-limit
// responses are treated as transport errors and use a longer backoff.
async function runStreamingWithRetry(
  threadId: string,
  start: () => Promise<any>,
  log: any = rootLogger,
  op: string = 'stream',
): Promise<any> {
  const MAX_TRANSPORT_RETRIES = 4;
  let lastResponse: any;
  for (let attempt = 0; attempt <= MAX_TRANSPORT_RETRIES; attempt++) {
    const response = await runStreaming(threadId, start);
    lastResponse = response;
    if (!response.error || !isTransportError(response.error)) {
      return response;
    }
    if (attempt < MAX_TRANSPORT_RETRIES) {
      const isRateLimit = /429|rate.?limit|overloaded|529/i.test(String((response.error as any)?.message || ''));
      const base = isRateLimit ? 2500 : 1000;
      const backoff = base * Math.pow(1.6, attempt) + Math.random() * 400;
      log.warn(`Transport/connection error during ${op} (retry ${attempt + 1}/${MAX_TRANSPORT_RETRIES})`, {
        error: response.error?.message,
        isRateLimit,
        backoffMs: Math.round(backoff),
      });
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  return lastResponse;
}

// Builds the user-facing error message. The provider's RAW error text is ALWAYS
// surfaced verbatim first (matching v1.0.0 behavior, so messages like Ollama's
// "this model requires a subscription or extra usage, upgrade for access at
// https://ollama.com/upgrade" render in the chat exactly as the provider sent
// them). Helpful context (base URL, API-key hint, rate-limit note) is appended
// as enrichment only — never in place of the original error, so the user never
// loses the actionable provider message to a generic classification.
function generationErrorMessage(errMsg: string, isTransport: boolean): string {
  const s = getRuntimeSettings();
  const provider = s.activeProvider || 'unknown';
  const baseUrl = s.baseUrls[provider] || s.baseUrls[provider.toLowerCase()] || '';
  const hasApiKey = !!(s.apiKeys[provider] || s.apiKeys[provider.toLowerCase()]);
  const urlHint = baseUrl ? ` (base URL: ${baseUrl})` : '';
  const apiKeyHint = hasApiKey ? '' : ' — NO API KEY CONFIGURED for this provider';
  const cleanErr = (errMsg || '').trim() || 'Unknown error';

  // Rate limit / overload: keep the raw provider message and enrich it.
  const isRateLimit = /429|rate.?limit|overloaded|529|too many requests/i.test(cleanErr);
  if (isRateLimit) {
    return `The AI provider (${provider}) is rate-limited or overloaded: ${cleanErr}${urlHint}${apiKeyHint} Wait a moment and try again, or switch provider/model in Settings → AI.`;
  }

  if (isTransport) {
    return `Connection error: ${cleanErr}${urlHint}${apiKeyHint} The AI provider (${provider}) could not be reached. Check your network connection and the provider / base-URL settings in Settings → AI, then try again. If the error persists, verify the API key for "${provider}" is valid.`;
  }

  return `Agent provider error: ${cleanErr}.`;
}

// ── Envelope-validated agent streaming with bounded self-repair ─────────────
// Layer 1 (primary): Mastra structured output enforces the Aura envelope
// schema at the framework level — `response.object` is guaranteed to match
// `auraResponseSchema`, and runStreaming canonicalizes it into `text`.
//
// Layer 2 (self-repair loop): when the model does NOT emit a schema-valid
// object (e.g. it answers in prose or malformed JSON), we do NOT surface it to
// the user. Instead we loop back and re-prompt the agent with the exact
// validation error and the malformed output it produced, so it can correct
// itself — up to MAX_FORMAT_RETRIES times. This repair loop pushes the success
// rate of obtaining a valid envelope to ~99% for normal prompts.
//
// Layer 3 (final fallback): if every repair attempt still fails, runStreaming
// keeps the raw text (the validation error is downgraded to non-fatal) and the
// existing parseAuraResponse / frontend sanitizer salvage what they can instead
// of returning a raw "FORMAT ERROR".
const MAX_FORMAT_RETRIES = 5;

const AURA_STRUCTURED_OUTPUT = {
  schema: auraResponseSchema,
  instructions: AURA_FORMAT_CONTRACT,
  // Prompt-injection strategy instead of native response_format: provider-level
  // JSON-schema mode suppresses tool calling on several providers, which made
  // tool-capable agents answer in text instead of calling patch_file/shell.
  jsonPromptInjection: true,
} as const;

/**
 * Builds the corrective re-prompt appended to the original message when the
 * model's previous reply failed the envelope schema. Including the precise
 * validation error and the malformed output dramatically raises the chance the
 * next attempt is valid JSON matching the contract.
 */
function buildRepairPrompt(badText: string, errorMsg: string, attempt: number, max: number): string {
  const bad = badText.length > 2000 ? badText.slice(0, 2000) + "\n…(truncated)" : badText;
  return (
    `\n\n[Format repair ${attempt}/${max}] Your previous reply was REJECTED because it did not match the ` +
    `required response schema. Reply with ONLY the JSON object and nothing else — no prose, no markdown ` +
    `code fences.\n` +
    `Validation error:\n${errorMsg}\n\n` +
    `Your previous (invalid) output was:\n${bad}\n\n` +
    `Required schema:\n${AURA_FORMAT_CONTRACT}\n\n` +
    `Re-issue your reply as the JSON object now.`
  );
}

/**
 * Per-request memory reference. Working memory (standard Mastra implementation)
 * is enabled by default, but disabled for model families that break on its
 * XML-wrapped system-message injection — see working-memory-policy.ts (#55).
 */
function memoryRef(threadId: string, modelOverride?: string) {
  const base = { thread: threadId, resource: RESOURCE_ID };
  if (isWorkingMemoryEnabled(modelOverride)) return base;
  return { ...base, options: { workingMemory: { enabled: false } } };
}

async function runAgentStreamValidated(
  threadId: string,
  makeStream: (attempt: number, repairSuffix: string) => Promise<any>,
  log: any,
): Promise<any> {
  // attempt 0 = original prompt, no repair suffix.
  let response = await runStreamingWithRetry(threadId, () => makeStream(0, ""), log, 'generation');

  for (let attempt = 1; attempt < MAX_FORMAT_RETRIES; attempt++) {
    const text = (response.text ?? "").trim();

    // Layer 1 (framework-validated object) or well-formed envelope text → done.
    if (response.object || isValidAuraEnvelope(text)) {
      break;
    }

    // A suspended tool call IS a valid, successful step outcome — the model
    // emitted a tool invocation and Mastra paused for approval. The frontend
    //will surface the approval UI; do NOT treat this as a malformed envelope.
    // Breaking here prevents the repair loop from re-prompting "reply with ONLY
    // the JSON object", which strips the tool call and makes the agent answer
    // in chat instead of editing the file (and wastes up to 5 full re-runs).
    if (response.finishReason === 'suspended') {
      break;
    }

    // A step that requested tool calls (or already carries tool results) is a
    // valid intermediate agent step — NOT a malformed envelope. Breaking here is
    // critical: if we let the repair loop run, it re-prompts "reply with ONLY
    // the JSON object", which strips the model's tool-calling and makes it
    // narrate ("I'll read the file…") instead of calling the tool. The envelope
    // contract (auraEnvelope.ts) has no tool_calls field, so valid tool-using
    // turns legitimately have non-envelope text — they must never be "repaired".
    if (
      (response.toolCalls && response.toolCalls.length > 0) ||
      (response.toolResults && response.toolResults.length > 0)
    ) {
      break;
    }

    // A real transport/API error (not a schema mismatch) is not something a
    // re-prompt can fix — surface it. Tripwire (content filter) is also final.
    const isValidationFailure =
      !!response.error && /validation|Expected .* received|JSON parsing failed/i.test(response.error.message || "");
    const terminal = (response.error && !isValidationFailure) || response.tripwire;
    if (terminal) {
      break;
    }

    // Self-repair: feed the exact error + the malformed output back so the
    // model can correct itself on the next attempt.
    const reason = (response.error && response.error.message) || "response did not match the required schema";
    const repair = buildRepairPrompt(text, reason, attempt, MAX_FORMAT_RETRIES);
    log.warn(
      `Envelope validation failed (attempt ${attempt}/${MAX_FORMAT_RETRIES}); re-prompting agent with repair details.`,
      { preview: text.slice(0, 200), reason },
    );
    // Erase the previous (malformed) attempt's streamed text from the thinking
    // buffer before re-prompting, so the confused fragment never lingers in the
    // planning panel across repair attempts.
    clearCurrentStepRaw(threadId);
    response = await runStreamingWithRetry(threadId, () => makeStream(attempt, repair), log, `repair-${attempt}`);
  }

  return response;
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
    agentType === 'developer' && mode === 'plan' ? 'developerPlanAgent'
    : agentType === 'developer' ? 'developerBuildAgent'
    : 'terminalAgent' as const;
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

// ── /api/settings — live AI settings push ───────────────────────────────────
// Receives the same env-like keys the sidecar is spawned with and swaps the
// agent's in-memory runtime settings, so changes made in Settings → AI (active
// provider, per-tier models, API keys, base URLs) take effect on the next
// generation without restarting the agent process. See issue #50.
server.post('/api/settings', async (request, _reply) => {
  const env = (request.body as any)?.env;
  if (!env || typeof env !== 'object') {
    return _reply.code(400).send({ status: 'error', message: 'Expected { env: { ... } }' });
  }
  updateRuntimeSettingsFromEnv(env as Record<string, string | undefined>);
  const s = getRuntimeSettings();
  const hasKey = !!(s.apiKeys[s.activeProvider] || s.apiKeys[s.activeProvider?.toLowerCase()]);
  log.info('Runtime AI settings updated', {
    activeProvider: s.activeProvider,
    hasApiKey: hasKey,
    balanced: s.models.balanced,
    baseUrl: s.baseUrls[s.activeProvider] || s.baseUrls[s.activeProvider?.toLowerCase()] || '(default)',
    envKeys: Object.keys(env),
  });
  if (!hasKey) {
    log.warn('No API key for active provider after settings update', { provider: s.activeProvider });
  }
  return { status: 'ok' };
});

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
        memory: memoryRef(threadId, model),
        requireToolApproval: true,
        maxSteps: 25,
        abortSignal: runAbort.signal,
        // Enforce the Aura response contract at the framework level instead of
        // relying on instruction-following (#52).
        structuredOutput: AURA_STRUCTURED_OUTPUT,
      };

      if (model) {
        // Resolve via the live runtime settings store so provider/model switches
        // from Settings → AI take effect immediately (no agent restart needed).
        generateOptions.model = await getModelProvider(undefined, model);
        stepLog.info('Using model override', { model });
      }

      if (threadId) {
        await compactThreadIfNeeded(threadId, agent, stepLog);
      }

      // Stream the run so the thinking buffer fills chunk-by-chunk: the Planning
      // and Conclusion chain-of-thought nodes render live as the model generates.
      // `runAgentStreamValidated` re-prompts the model if it emits malformed JSON.
      const response = await runAgentStreamValidated(
        threadId,
        (attempt, repairSuffix) =>
          agent.stream(
            attempt === 0 ? prompt : prompt + repairSuffix,
            generateOptions,
          ),
        stepLog,
      );

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
        const isTransport = isTransportError(response.error);
        stepLog.error('LLM generation error', {
          finishReason: response.finishReason,
          isTransport,
          error: response.error?.message,
          errorStack: response.error?.stack,
        });
        return {
          status: 'error',
          message: generationErrorMessage(errMsg, isTransport),
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

      // Surface file-operation failures so they appear in the user-facing message
      if (result.status === 'completed') {
        const fileToolErrors = response.toolResults
          ?.filter((tr: any) =>
            tr.isError &&
            (tr.toolName === 'patch_file' || tr.toolName === 'write_file')
          )
          .map((tr: any) => ({
            tool: tr.toolName,
            error: tr.error || (typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result)),
          }));
        if (fileToolErrors && fileToolErrors.length > 0) {
          const suffix = '\n\n**File operation failed:**\n' +
            fileToolErrors.map((e: any) => `- \`${e.tool}\`: ${e.error}`).join('\n');
          result.message = (result.message || '') + suffix;
        }
      }

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
    const isTransport = isTransportError(error);
    return {
      status: 'error',
      message: generationErrorMessage(error.message || 'Unknown error', isTransport),
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

/**
 * The run id the client passes back may not match the persisted agentic-loop
 * workflow snapshot (the model output `runId` can differ from the workflow
 * run id, e.g. when the agent runs as a sub-agent). Strategy:
 *   1. If the passed runId's snapshot exists, use it.
 *   2. Otherwise find a suspended run whose suspended step is the tool-approval
 *      for the `toolCallId` we're approving (most reliable disambiguation).
 *   3. Fall back to the single suspended run if there's exactly one.
 * Returns `runId` unchanged when nothing better is available.
 */
async function resolveResumeRunId(runId: string, toolCallId?: string): Promise<string> {
  try {
    const storage = mastra.getStorage();
    const wf = storage ? await storage.getStore('workflows') : undefined;
    if (!wf) return runId;
    const existing = await wf.loadWorkflowSnapshot({ workflowName: 'agentic-loop', runId });
    if (existing) return runId;

    const runs = await wf.listWorkflowRuns({ workflowName: 'agentic-loop' });
    const all = (runs as any)?.runs ?? [];
    const suspended = all.filter((r: any) => r.status === 'suspended');

    const matchByTool = async (candidateRunId: string): Promise<boolean> => {
      try {
        const full = await wf.getWorkflowRunById({ runId: candidateRunId, workflowName: 'agentic-loop' });
        const snapshot: any =
          typeof full?.snapshot === 'string' ? JSON.parse(full.snapshot) : full?.snapshot;
        const ctx = snapshot?.context ?? {};
        for (const step of Object.values(ctx)) {
          const stepAny = step as any;
          if (stepAny?.status === 'suspended' && stepAny.suspendPayload?.requireToolApproval) {
            if (!toolCallId || stepAny.suspendPayload.requireToolApproval.toolCallId === toolCallId) {
              return true;
            }
          }
        }
      } catch {
        /* ignore */
      }
      return false;
    };

    // Prefer the suspended run whose approval matches our toolCallId.
    for (const r of suspended) {
      if (await matchByTool(r.runId)) return r.runId;
    }
    if (suspended.length === 1) return suspended[0].runId;
  } catch {
    /* fall through to original runId */
  }
  return runId;
}

server.post('/api/tool/approve', async (request, _reply) => {
  const body = request.body as any;
  const { agent_type, mode, runId, toolCallId, session_id } = body;
  const toolName = body.toolName ?? body.tool_name;
  const toolArgs = body.toolArgs ?? body.args;
  const providedResumeData = body.resumeData ?? body.resume_data;
  const isSidecarTool = !!(toolName && SIDECAR_READONLY_TOOLS[toolName]);
  // The framework's tool-approval resume REQUIRES `resumeData.approved === true`
  // (otherwise it treats the call as rejected). For read-only sidecar tools we
  // still run the tool here so the agent receives real output, but we must ALSO
  // flag it approved — otherwise the whole suspended batch is rejected.
  const sidecarResult = isSidecarTool
    ? await executeSidecarTool(toolName, toolArgs)
    : undefined;
  // IMPORTANT: the framework forwards `resumeData` to the *tool* (as
  // `context.agent.resumeData`) only when it has more than one key (chunk
  // -HQPHHGZE.js:28068). If it is exactly `{ approved: true }`, the framework
  // passes `void 0` to the tool instead. Tools like `patch_file`/`write_file`
  // then see `resumeData === undefined`, re-trigger their own `requireReview`
  // suspend, and never apply the change. The `_resumePassthrough` key guarantees
  // the payload is forwarded so the tool receives `approved: true` and applies.
  const resumeData = isSidecarTool
    ? { approved: true, ...(sidecarResult ?? { success: false, error: 'tool produced no output' }) }
    : { approved: true, ...(providedResumeData ?? {}), _resumePassthrough: true };

  const toolLog = log.child({
    endpoint: 'tool/approve',
    agentType: agent_type,
    mode,
    runId,
    toolCallId,
    sessionId: session_id,
  });
  toolLog.info('Tool approval request', {
    toolName,
    hasToolArgs: !!toolArgs,
    isSidecarTool,
    resumeDataKeys: resumeData ? Object.keys(resumeData) : undefined,
    providedResumeDataKeys: providedResumeData ? Object.keys(providedResumeData) : undefined,
  });

  const agent = selectAgent(agent_type, mode);
  const startTime = Date.now();
  const threadKey = session_id || runId || 'agent-view';

  // Resolve the run id to the persisted agentic-loop snapshot. The client's
  // runId can diverge from the workflow run id; fall back to the single
  // suspended run currently in storage if the exact id isn't found.
  const resolvedRunId = await resolveResumeRunId(runId, toolCallId);

  // Diagnostic: confirm the suspended-run snapshot is reachable before resuming.
  try {
    const storage = mastra.getStorage();
    const wf = storage ? await storage.getStore('workflows') : undefined;
    if (wf) {
      const snapshot = await wf.loadWorkflowSnapshot({ workflowName: 'agentic-loop', runId: resolvedRunId });
      const runs = await wf.listWorkflowRuns({ workflowName: 'agentic-loop' });
      toolLog.info('Resume snapshot diagnostic', {
        hasSnapshot: !!snapshot,
        snapshotStatus: (snapshot as any)?.status,
        requestedRunId: runId,
        resolvedRunId,
        recentRuns: (runs as any)?.runs?.map((r: any) => ({ runId: r.runId, status: r.status })),
      });
    }
  } catch (diagErr: any) {
    toolLog.warn('Resume snapshot diagnostic failed', { error: diagErr?.message });
  }

  const runAbort = registerRunAbort(threadKey);
  const runTimeout = setTimeout(() => runAbort.abort(), 120_000);

  try {
    // Serialize with other work on the same thread (e.g. /api/btw).
    beginStep(threadKey, 'execution');
    const response = await withThreadLock(threadKey, async () =>
      runStreamingWithRetry(threadKey, () =>
        agent.resumeStream(
          resumeData,
          {
            runId: resolvedRunId,
            toolCallId,
            maxSteps: 25,
            abortSignal: runAbort.signal,
            requireToolApproval: true,
            structuredOutput: AURA_STRUCTURED_OUTPUT,
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
      const isTransport = isTransportError(response.error);
      toolLog.error('Tool approval generation error', {
        error: response.error?.message,
        errorStack: response.error?.stack,
      });
      return {
        status: 'error',
        message: generationErrorMessage(errMsg, isTransport),
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

    // Surface file-operation failures (patch_file / write_file) so the frontend
    // can display them as visible errors. Without this, soft tool errors are
    // only passed to the LLM which may narrate the failure without surfacing it
    // as an actionable user message.
    const fileToolErrors = response.toolResults
      ?.filter((tr: any) =>
        tr.isError &&
        (tr.toolName === 'patch_file' || tr.toolName === 'write_file')
      )
      .map((tr: any) => ({
        tool: tr.toolName,
        error: tr.error || (typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result)),
      }));
    const fileErrorSuffix = fileToolErrors && fileToolErrors.length > 0
      ? '\n\n**File operation failed:**\n' +
        fileToolErrors.map((e: any) => `- \`${e.tool}\`: ${e.error}`).join('\n')
      : '';

    return {
      status: 'completed',
      message: (parsed.message || response.text) + fileErrorSuffix,
      conclusion: parsed.conclusion,
      planning: parsed.planning,
      fileErrors: fileToolErrors && fileToolErrors.length > 0 ? fileToolErrors : undefined,
    };
  } catch (error: any) {
    toolLog.error('Tool approval threw exception', { error: error.message, stack: error.stack });
    // Surface a diagnostic when resume can't find the suspended run so the
    // failure is visible in the UI rather than a generic "rephrase" message.
    if (/could not find a suspended run|AGENT_RESUME_NO_SNAPSHOT_FOUND/i.test(error.message || '')) {
      try {
        const wf = await mastra.getStorage()?.getStore('workflows');
        const runs = wf ? await wf.listWorkflowRuns({ workflowName: 'agentic-loop' }) : undefined;
        const recentRuns = (runs as any)?.runs?.map((r: any) => ({
          runId: r.runId,
          status: r.status,
        }));
        return {
          status: 'error',
          message:
            `Resume failed: the suspended run for runId "${runId}" was not found in storage. ` +
            `Recent agentic-loop runs: ${JSON.stringify(recentRuns ?? [])}. ` +
            `This usually means the sidecar process restarted between suspend and approve, ` +
            `or the stored snapshot was lost. The agentic-loop storage is now durable (file-backed), ` +
            `so restart the sidecar and try the approval flow again.`,
        };
      } catch {
        /* fall through */
      }
    }
    return {
      status: 'error',
      message: generationErrorMessage(error.message || 'Unknown error', isTransportError(error)),
    };
  } finally {
    clearTimeout(runTimeout);
    clearRunAbort(threadKey);
  }
});

server.post('/api/tool/decline', async (request, _reply) => {
  const { agent_type, mode, runId, toolCallId, session_id, feedback } = request.body as any;

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
  const resolvedRunId = await resolveResumeRunId(runId, toolCallId);
  const runAbort = registerRunAbort(threadKey);
  const runTimeout = setTimeout(() => runAbort.abort(), 120_000);

    try {
      // Serialize with other work on the same thread (e.g. /api/btw).
      beginStep(threadKey, 'execution');
      const response = await withThreadLock(threadKey, async () =>
        runAgentStreamValidated(
          threadKey,
          (_attempt, _repairSuffix) =>
            agent.resumeStream(
              { approved: false, stdout: '', stderr: feedback ?? '', exitCode: -1 },
              {
                runId: resolvedRunId,
                toolCallId,
                maxSteps: 25,
                abortSignal: runAbort.signal,
                requireToolApproval: true,
                structuredOutput: AURA_STRUCTURED_OUTPUT,
              },
            ),
          toolLog,
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
      const isTransport = isTransportError(response.error);
      toolLog.error('Tool decline generation error', { error: response.error?.message });
      return { status: 'error', message: generationErrorMessage(errMsg, isTransport) };
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
      message: generationErrorMessage(error.message || 'Unknown error', isTransportError(error)),
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

    const response = await runStreamingWithRetry(threadId, () => agent.stream(
      `Chat message (respond conversationally, NOT as a command): ${message}`,
      {
        memory: memoryRef(threadId),
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
      const isTransport = isTransportError(response.error);
      chatLog.error('Chat generation error', { error: response.error?.message, isTransport });
      return { status: 'error', message: generationErrorMessage(errMsg, isTransport) };
    }

    const parsed = parseAuraResponse(response.text);
    const chatMessage =
      parsed.message && parsed.message.trim()
        ? parsed.message
        : (parsed.planning && parsed.planning.trim()) || parsed.conclusion || "";
    return { status: parsed.status || "completed", message: chatMessage };
  } catch (error: any) {
    chatLog.error('Chat threw exception', { error: error.message, stack: error.stack });
    return { status: 'error', message: generationErrorMessage(error.message || 'Chat error', isTransportError(error)) };
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
      generateOptions.model = await getModelProvider(undefined, model);
    }
    // Wrap generate in a minimal retry loop for transient transport/rate-limit errors
    // so a single blip doesn't surface as a raw "btw error" to the user.
    const runBtwWithRetry = async () => {
      let last: any;
      for (let attempt = 0; attempt <= 2; attempt++) {
        const r = await agent.generate(message, generateOptions);
        last = r;
        if (!r.error || !isTransportError(r.error)) return r;
        const isRateLimit = /429|rate.?limit|overloaded|529/i.test(String((r.error as any)?.message || ''));
        if (attempt < 2) {
          const backoff = (isRateLimit ? 2000 : 800) * Math.pow(1.5, attempt) + Math.random() * 300;
          btwLog.warn(`btw transport error (retry ${attempt + 1}/2)`, { error: (r.error as any)?.message, backoffMs: Math.round(backoff) });
          await new Promise((res) => setTimeout(res, backoff));
        }
      }
      return last;
    };
    const response = await runBtwWithRetry();
    const elapsed = Date.now() - startTime;

    btwLog.info('btw response', {
      elapsedMs: elapsed,
      textLength: response.text?.length,
      textPreview: response.text?.slice(0, 200),
    });

    if (response.finishReason === 'error' || response.error) {
      const errMsg = response.error?.message || response.text || 'Generation failed';
      const isTransport = isTransportError(response.error);
      btwLog.error('btw generation error', { error: response.error?.message, isTransport });
      return { status: 'error', message: isTransport ? generationErrorMessage(errMsg, true) : `btw error: ${errMsg}` };
    }

    const parsed = parseAuraResponse(response.text);
    const btwMessage =
      parsed.message && parsed.message.trim()
        ? parsed.message
        : (parsed.planning && parsed.planning.trim()) || parsed.conclusion || "";
    return { status: parsed.status || "completed", message: btwMessage };
  } catch (error: any) {
    btwLog.error('btw threw exception', { error: error.message, stack: error.stack });
    return { status: 'error', message: generationErrorMessage(error.message || 'btw error', isTransportError(error)) };
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

  // 3) No envelope and no extractable fields. This means the model emitted
  //    something that only *looks* like JSON (or garbage) and never produced a
  //    usable message. Rather than hand the raw `{...}` back — which the frontend
  //    would surface as a "malformed response" warning — return a clear,
  //    non-blaming result. The repair loop upstream already retried several
  //    times, so this is the rare residual case; a friendly, retryable message
  //    is the correct end-state (and never leaks raw JSON to the user).
  if (!src.trim()) {
    return { status: 'error', message: 'The agent returned an empty response. Please try again.' };
  }
  return {
    status: 'error',
    message:
      'The agent reply could not be parsed into the expected format. This is usually transient — please try again.',
  };
}

// ── Server bootstrap ──────────────────────────────────────────────────────
export function startServer(port: number) {
  log.info('=== Aurora Agent Server Starting ===', { port, cwd: process.cwd(), nodeVersion: process.version });
  // Log AI provider configuration for diagnostics
  const s = getRuntimeSettings();
  const hasKey = !!(s.apiKeys[s.activeProvider] || s.apiKeys[s.activeProvider?.toLowerCase()]);
  log.info('AI provider config', {
    activeProvider: s.activeProvider,
    hasApiKey: hasKey,
    baseUrl: s.baseUrls[s.activeProvider] || s.baseUrls[s.activeProvider?.toLowerCase()] || '(default)',
    models: s.models,
  });
  if (!hasKey) {
    log.warn('No API key configured for active provider', { provider: s.activeProvider });
  }
  log.info('Registered routes', { routes: server.printRoutes() });
  server.listen({ port, host: '127.0.0.1' }, (err, address) => {
    if (err) {
      log.error('Failed to start server', { error: err.message, stack: err.stack });
      process.exit(1);
    }
    log.info(`Server listening on ${address}`);
  });
}
