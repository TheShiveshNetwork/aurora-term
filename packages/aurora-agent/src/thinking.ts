// ── Streaming "thinking" capture ─────────────────────────────────────────
// Mastra's `generate()` accepts an `onChunk` callback. We capture the
// incremental text/reasoning deltas plus tool-call announcements per thread
// (threadId === sessionId) so the frontend can stream "whatever the agent is
// thinking" live in the chat UI while a task runs.
//
// The buffer is intentionally bounded — thinking is transient UI state and is
// never persisted or sent to the LLM.

const thinkingByThread = new Map<string, string>();
const MAX_THINKING_CHARS = 20000;

export function resetThinking(threadId: string) {
  thinkingByThread.delete(threadId);
}

export function appendThinking(threadId: string, text: string) {
  if (!threadId || !text) return;
  const current = thinkingByThread.get(threadId) ?? "";
  const next = current + text;
  thinkingByThread.set(
    threadId,
    next.length > MAX_THINKING_CHARS ? next.slice(-MAX_THINKING_CHARS) : next
  );
}

export function getThinking(threadId: string): string {
  return thinkingByThread.get(threadId) ?? "";
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
    if (type === 'text-delta' || type === 'reasoning-delta') {
      appendThinking(threadId, chunk?.payload?.text ?? '');
    } else if (type === 'tool-call') {
      const payload = chunk?.payload ?? {};
      const toolName = payload.toolName ?? 'tool';
      const icon = TOOL_ICONS[toolName] ?? '🛠';
      const argHint = shortToolArgs(toolName, payload.args);
      appendThinking(threadId, `\n${icon} ${toolName}${argHint}`);
    }
  };
}
