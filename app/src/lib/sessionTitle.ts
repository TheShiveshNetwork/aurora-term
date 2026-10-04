/**
 * Session naming has two stages. The agent names the session asynchronously
 * (see `agentSessions.requestModelTitle`) and the result is what the user
 * ultimately sees. Until that call comes back — or if it fails — the session
 * carries a random placeholder so the list never shows a blank or a
 * misleading goal-derived guess.
 */

export const UNTITLED_SESSION = "New Session";

const PLACEHOLDER_PREFIX = "session_";
const PLACEHOLDER_DIGITS = 4;

export function generatePlaceholderTitle(): string {
  const upperBound = 10 ** PLACEHOLDER_DIGITS;
  const value = Math.floor(Math.random() * upperBound);
  return `${PLACEHOLDER_PREFIX}${String(value).padStart(PLACEHOLDER_DIGITS, "0")}`;
}

export function isPlaceholderTitle(title: string | null | undefined): boolean {
  return !!title && title.startsWith(PLACEHOLDER_PREFIX);
}

/** First line of the prompt, trimmed for use as a list-row preview. */
export function deriveSessionPreview(goal: string, max = 200): string | null {
  const first = goal.replace(/\s+/g, " ").trim();
  if (!first) return null;
  return first.length > max ? `${first.slice(0, max)}…` : first;
}