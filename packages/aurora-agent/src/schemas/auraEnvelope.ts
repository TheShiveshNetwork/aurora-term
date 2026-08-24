import { z } from 'zod';

/**
 * The Aura response contract — shared by every tool-calling agent
 * (terminalAgent, developerPlanAgent, developerBuildAgent).
 *
 * Historically this shape lived only as hand-written "reply with exactly one
 * JSON object" instructions duplicated (and drifting) across three system
 * prompts, which is fragile when mixed with native tool-calling (#52). It is
 * now enforced by the framework via Mastra structured output
 * (`structuredOutput: { schema }` on generate/stream/resumeStream) and this
 * module is the single source of truth for:
 *
 *   - the zod schema used to validate/repair model output,
 *   - the TS type consumed by server handlers,
 *   - the instruction block interpolated into each agent's prompt and into
 *     the retry reminder, so prompt text can never drift from the schema.
 */

export const auraResponseSchema = z.object({
  status: z
    .enum(['executing', 'completed', 'error'])
    .describe('executing = run a command next; completed = final answer; error = failed'),
  command: z
    .string()
    .optional()
    .describe('The shell command to execute. Required when status is "executing".'),
  explanation: z
    .string()
    .optional()
    .describe('Brief reason for running this command. Used when status is "executing".'),
  planning: z
    .string()
    .optional()
    .describe('One sentence on how you are approaching the task.'),
  conclusion: z
    .string()
    .optional()
    .describe('Short transitional reflection that closes the task.'),
  message: z
    .string()
    .optional()
    .describe('User-facing answer in Markdown. Required when status is "completed" or "error".'),
});

export type AuraResponseEnvelope = z.infer<typeof auraResponseSchema>;

/**
 * Canonical field-contract instructions, derived from (and kept beside) the
 * schema. Interpolated verbatim into agent prompts, structured-output
 * instructions, and the retry reminder so all three always agree.
 */
export const AURA_FORMAT_CONTRACT = `RESPONSE CONTRACT:
Your reply is returned as a structured object with these fields:
- status: "executing" | "completed" | "error"
- command: the shell command to execute (status="executing" only)
- explanation: brief why for the command (status="executing")
- planning: one sentence on your approach
- conclusion: short transitional reflection (status="completed"/"error")
- message: the user-facing answer in Markdown (status="completed"/"error")

Field rules per status:
- executing  → include command + explanation (+ planning)
- completed  → include message (+ planning + conclusion)
- error      → include message (+ planning + conclusion)

Do not wrap the reply in code fences or add prose outside the object.`;
