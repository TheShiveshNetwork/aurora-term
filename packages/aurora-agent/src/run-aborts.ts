/**
 * Per-thread run cancellation.
 *
 * A stop is a deliberate user action, so it must never be confused with a
 * transient transport failure: `isTransportError` matches the word "aborted",
 * which meant a cancelled generation was immediately retried and appeared to
 * ignore the stop button. `wasRunStopped` lets the retry loop distinguish the two.
 */

const controllers = new Map<string, AbortController>();
const stopped = new Set<string>();

export function registerRunAbort(threadId: string): AbortController {
  const controller = new AbortController();
  controllers.set(threadId, controller);
  // Starting a new run clears any earlier stop for this thread.
  stopped.delete(threadId);
  return controller;
}

export function clearRunAbort(threadId: string): void {
  controllers.delete(threadId);
}

export function isRunStopped(threadId: string): boolean {
  return stopped.has(threadId);
}

/** Aborts the thread's in-flight run. Returns false when nothing was running. */
export function stopRun(threadId: string): boolean {
  const controller = controllers.get(threadId);
  if (!controller) return false;
  controller.abort();
  stopped.add(threadId);
  controllers.delete(threadId);
  return true;
}

export function resetRunAborts(): void {
  controllers.clear();
  stopped.clear();
}
