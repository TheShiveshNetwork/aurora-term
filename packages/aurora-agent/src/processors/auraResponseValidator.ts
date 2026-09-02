import type { OutputProcessor } from "@mastra/core/processors";

/**
 * Validates that the agent's final output is the expected JSON envelope:
 *   {"status":"executing|completed|error","planning":"...","conclusion":"...","message":"..."}
 *
 * ENFORCEMENT LAYERS (see #52):
 *   1. Framework — Mastra structured output (`structuredOutput: { schema }` on
 *      the generate/stream calls in server.ts) validates/repairs the model's
 *      final object against the shared zod schema (schemas/auraEnvelope.ts).
 *      When this succeeds, server.ts canonicalizes the validated object into
 *      the response text and no further checking is needed.
 *   2. Retry — `runAgentStreamValidated` in server.ts. If the structured pass
 *      produced no object, it checks the emitted text with
 *      `isValidAuraEnvelope` below and, on failure, re-prompts the model (up
 *      to MAX_FORMAT_RETRIES attempts) with a corrective reminder instead of
 *      surfacing a raw "FORMAT ERROR".
 *   3. Frontend — the UI's `sanitizeMessage()` remains the final safety net if
 *      every attempt still fails.
 *
 * This processor itself is a deliberate PASS-THROUGH: rejecting here would
 * abort the run with no way to re-prompt, so validation + retry live upstream.
 */
export function isValidAuraEnvelope(text: string): boolean {
  let src = text.trim();
  const fenced = src.match(/```[a-zA-Z]*\n([\s\S]*?)\n```/);
  if (fenced) src = fenced[1].trim();

  const start = src.indexOf("{");
  if (start === -1) return false;

  // Brace-match (string-aware) to isolate the first complete object.
  let depth = 0;
  let inStr = false;
  let esc = false;
  let end = -1;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (esc) esc = false;
    else if (c === "\\") esc = true;
    else if (c === '"') inStr = !inStr;
    else if (!inStr) {
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
  }
  if (end === -1) return false;

  try {
    const parsed = JSON.parse(src.slice(start, end + 1));
    if (!parsed || typeof parsed !== "object" || typeof parsed.status !== "string") {
      return false;
    }
    // `executing` steps carry `command` (no `message`); `completed`/`error`
    // carry `message`. Accept either shape so tool-call steps are never rejected.
    const hasMessage = typeof parsed.message === "string" && parsed.message.trim().length > 0;
    const hasCommand = typeof parsed.command === "string" && parsed.command.trim().length > 0;
    return hasMessage || hasCommand;
  } catch {
    return false;
  }
}

export const auraResponseValidator: OutputProcessor = {
  id: "aura-response-validator",
  name: "Aura Response Validator",
  description:
    "Ensures the agent final output is a JSON envelope with status/planning/conclusion/message.",
  // Pass-through: envelope validation + retry is handled in server.ts so the
  // model can be re-prompted rather than aborting with a raw format error.
  processOutputResult({ messageList }) {
    return messageList;
  },
};
