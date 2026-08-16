// ── Phase-aware streaming "thinking" capture ─────────────────────────────
// Mastra's generate()/resumeGenerate() accept an onChunk callback. We capture
// the incremental text + reasoning deltas plus tool-call announcements per
// thread (threadId === sessionId) so the frontend can stream organized,
// human-readable "thinking" live in the chat UI while a task runs.
//
// Thinking is split into buckets that map to chain-of-thought steps:
//   - planning:   the initial goal step (phase = 'planning')
//   - conclusion: the final step that returns { status: 'completed' }
// Execution steps in between are transient and never surface.
//
// The buffers are intentionally bounded — thinking is transient UI state and is
// never persisted or sent back to the LLM.

interface ThreadThinking {
  phase: 'planning' | 'execution';
  raw: string; // text-delta + tool-call stream for the current step (bounded)
  reasoning: string; // reasoning-delta stream for the current step (bounded)
  stepStart: number; // raw.length when the current step began
  planning: string; // finalized planning text
  conclusion: string; // finalized conclusion text
}

const thinkingByThread = new Map<string, ThreadThinking>();
const MAX_THINKING_CHARS = 20000;

export function resetThinking(threadId: string) {
  thinkingByThread.delete(threadId);
}

function entry(threadId: string): ThreadThinking {
  let e = thinkingByThread.get(threadId);
  if (!e) {
    e = { phase: 'planning', raw: '', reasoning: '', stepStart: 0, planning: '', conclusion: '' };
    thinkingByThread.set(threadId, e);
  }
  return e;
}

// Starts a new LLM step. `phase` decides which bucket the streamed text lands in.
export function beginStep(threadId: string, phase: 'planning' | 'execution') {
  const e = entry(threadId);
  e.phase = phase;
  e.stepStart = e.raw.length;
  e.reasoning = '';
}

export function getPhase(threadId: string): 'planning' | 'execution' {
  return entry(threadId).phase;
}

export function appendThinking(threadId: string, text: string) {
  if (!threadId || !text) return;
  const e = entry(threadId);
  e.raw = (e.raw + text).slice(-MAX_THINKING_CHARS);
}

export function appendReasoning(threadId: string, text: string) {
  if (!threadId || !text) return;
  const e = entry(threadId);
  e.reasoning = (e.reasoning + text).slice(-MAX_THINKING_CHARS);
}

// ── Human-readable extraction ─────────────────────────────────────────────
// The agents emit structured JSON ({ status, command, explanation, message,
// conclusion }). Streaming JSON is useless raw, so we pull out the narrative
// fields and any reasoning deltas. Field extraction wins over raw text.

// Extract the value(s) of a single JSON string field from streamed text.
// Works on partially-streamed JSON because it is regex-based, not a parser.
function extractField(delta: string, field: string): string {
  const re = new RegExp(`"${field}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, 'g');
  const values: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(delta))) {
    const v = m[1].trim();
    if (v) values.push(v);
  }
  return values.join('\n\n');
}

// Return the first non-empty field from a prioritized list. Used so the planning
// node always has something to render even when an agent schema omits `planning`
// (e.g. groq drops it, or the developer agent only emits `explanation`).
function firstField(delta: string, ...fields: string[]): string {
  for (const f of fields) {
    const v = extractField(delta, f);
    if (v) return v;
  }
  return '';
}

// Planning bucket: the explicit `planning` field (the agent's thinking about the
// query) plus any reasoning deltas. Falls back to `explanation` then `conclusion`
// so the planning node is never empty. The answer (`message`) and free-form prose
// are deliberately excluded so the planning node never leaks the final response.
function extractPlanning(delta: string, reasoning: string): string {
  const planning = firstField(delta, 'planning', 'explanation', 'conclusion');
  return [reasoning.trim(), planning].filter(Boolean).join('\n\n');
}

// Conclusion bucket: the explicit `conclusion` field (the agent's closing
// reflection) plus any reasoning deltas. `message` (the answer) is excluded.
function extractConclusion(delta: string, reasoning: string): string {
  const conclusion = extractField(delta, 'conclusion');
  return [reasoning.trim(), conclusion].filter(Boolean).join('\n\n');
}

// ── Committing steps into buckets ─────────────────────────────────────────
// Finalizes the current step's streamed text. A planning-phase step commits to
// the planning bucket (narrative + explanation) and, when it carries an
// explicit `conclusion` field (single-step completion), also to the conclusion
// bucket. An execution-phase step commits to the conclusion bucket only when it
// completes; the server calls discardStep for everything else.
export function commitStep(threadId: string): 'planning' | 'execution' {
  const e = entry(threadId);
  const delta = e.raw.slice(e.stepStart);
  const reasoning = e.reasoning;
  e.stepStart = e.raw.length;
  e.reasoning = '';

  if (e.phase === 'planning') {
    const planning = extractPlanning(delta, reasoning);
    if (planning) e.planning = [e.planning, planning].filter(Boolean).join('\n\n');
    const conclusion = extractField(delta, 'conclusion');
    if (conclusion) e.conclusion = [e.conclusion, conclusion].filter(Boolean).join('\n\n');
  } else {
    const conclusion = extractConclusion(delta, reasoning);
    if (conclusion) e.conclusion = [e.conclusion, conclusion].filter(Boolean).join('\n\n');
  }
  return e.phase;
}

export function discardStep(threadId: string) {
  const e = entry(threadId);
  e.stepStart = e.raw.length;
  e.reasoning = '';
}

export function getThinking(threadId: string): string {
  return entry(threadId).raw;
}

// Finalized planning text, or the live in-progress stream while the planning
// step is still generating. Only the explicit `planning` field is surfaced —
// raw JSON / narrative is never leaked into the planning node. Falls back to
// `explanation`/`conclusion` so the node is never empty.
export function getPlanning(threadId: string): string {
  const e = entry(threadId);
  if (e.phase === 'planning') {
    const live = firstField(e.raw.slice(e.stepStart), 'planning', 'explanation', 'conclusion');
    return [e.planning, live].filter(Boolean).join('\n\n');
  }
  return e.planning;
}

// Finalized conclusion text, or the live stream once the current step starts
// emitting its completion JSON (that marks it as the final step). Only the
// explicit `conclusion` field is surfaced — the raw JSON / narrative is never
// leaked into the conclusion node (which renders as plain text, not markdown).
export function getConclusion(threadId: string): string {
  const e = entry(threadId);
  const liveRaw = e.raw.slice(e.stepStart);
  if (liveRaw && /"status"\s*:\s*"completed"/.test(liveRaw)) {
    const live = extractField(liveRaw, 'conclusion');
    return [e.conclusion, live].filter(Boolean).join('\n\n');
  }
  return e.conclusion;
}

const TOOL_ICONS: Record<string, string> = {
  read_file: '📖',
  list_directory: '📂',
  search_files: '🔎',
  grep_search: '🔍',
  glob: '🗂',
  write_file: '✍️',
  patch_file: '🔧',
  exec_command: '⚙️',
  shell_terminal: '🖥',
  shell_developer: '🖥',
  web_fetch: '🌐',
  ask_user: '❓',
  history_search: '🕘',
};

function shortToolArgs(toolName: string, args: Record<string, any> | undefined): string {
  if (!args) return '';
  if (typeof args.path === 'string') return ` ${args.path}`;
  if (typeof args.command === 'string') {
    const cmd = args.command.replace(/\s+/g, ' ').trim();
    return cmd.length > 60 ? ` ${cmd.slice(0, 60)}…` : ` ${cmd}`;
  }
  if (typeof args.query === 'string') return ` ${args.query}`;
  return '';
}

// Builds an `onChunk` handler that accumulates the agent's visible thinking
// into the per-thread buffer. Safe to pass to any generate()/resumeGenerate().
export function onChunkCapture(threadId: string) {
  return (chunk: any) => {
    const type = chunk?.type;
    if (type === 'text-delta') {
      appendThinking(threadId, chunk?.payload?.text ?? '');
    } else if (type === 'reasoning-delta') {
      appendReasoning(threadId, chunk?.payload?.text ?? '');
    } else if (type === 'tool-call') {
      const payload = chunk?.payload ?? {};
      const toolName = payload.toolName ?? 'tool';
      const icon = TOOL_ICONS[toolName] ?? '🛠';
      const argHint = shortToolArgs(toolName, payload.args);
      appendThinking(threadId, `\n${icon} ${toolName}${argHint}`);
    }
  };
}
