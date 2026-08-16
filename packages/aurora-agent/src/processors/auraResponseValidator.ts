import type { OutputProcessor } from "@mastra/core/processors";

/**
 * Validates that the agent's final output is the expected JSON envelope:
 *   {"status":"completed|executing|error","planning":"...","conclusion":"...","message":"..."}
 *
 * When the model emits free-form text (or a malformed/truncated envelope), the
 * processor aborts with `retry: true` once so the model re-emits in the correct
 * shape. This guarantees the frontend always receives a validated format and
 * never has to render a raw JSON envelope as Markdown. If the model still fails
 * after one retry (retryCount >= 1) we let it through — the frontend's
 * sanitizeMessage() defends the UI as a final safety net.
 */
function isValidAuraEnvelope(text: string): boolean {
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
  processOutputResult({ result, messageList, abort, retryCount }) {
    const text = (result?.text ?? "").trim();
    if (!text || isValidAuraEnvelope(text)) {
      return messageList;
    }
    if ((retryCount ?? 0) < 1) {
      abort(
        "FORMAT ERROR: your response was not valid JSON. You MUST reply with exactly one JSON " +
          'object and nothing else: {"status":"completed","planning":"<your reasoning>","conclusion":"<short summary>","message":"<user-facing answer in Markdown>"}. ' +
          "Keep the answer in the `message` field only.",
        { retry: true }
      );
    }
    return messageList;
  },
};
