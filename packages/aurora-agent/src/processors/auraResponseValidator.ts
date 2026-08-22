import type { OutputProcessor } from "@mastra/core/processors";

/**
 * Validates that the agent's final output is the expected JSON envelope:
 *   {"status":"completed|executing|error","planning":"...","conclusion":"...","message":"..."}
 *
 * The actual retry-on-failure loop lives upstream in `server.ts`
 * (`runAgentStreamValidated`), which re-prompts the model (up to a max number
 * of attempts) whenever the emitted text is not a valid envelope. This keeps
 * the user-facing response reliably structured instead of surfacing a raw
 * "FORMAT ERROR" string. The frontend's `sanitizeMessage()` remains the final
 * safety net if every attempt still fails.
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
