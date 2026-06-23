import { z } from 'zod';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { aura, coderAgent, researcherAgent, validatorAgent } from '../agents/aura';

// ── Schemas ───────────────────────────────────────────────────────────────

const AuraStepResponseSchema = z.object({
  status: z.enum(['executing', 'completed', 'error']),
  command: z.string().optional(),
  explanation: z.string().optional(),
  subagent: z.string().optional(),
  message: z.string().optional(),
});

// ── Step 1: Analyze & Plan ────────────────────────────────────────────────
const analyzeStep = createStep({
  id: 'analyze-step',
  inputSchema: z.object({
    goal: z.string(),
    taskId: z.string().optional(),
  }),
  outputSchema: z.object({
    plan: z.string(),
    isSimple: z.boolean(),
    needsSubagent: z.enum(['coder', 'researcher', 'validator', 'none']),
  }),
  execute: async ({ inputData }) => {
    const response = await aura.generate(
      `Analyze this goal and determine the approach: "${inputData.goal}"\n\nRespond with JSON: {"plan": "<brief plan>", "isSimple": <true|false>, "needsSubagent": "<coder|researcher|validator|none>"}`,
      {
        memory: inputData.taskId ? { thread: inputData.taskId, resource: 'aurora' } : undefined,
      }
    );

    try {
      // Parse agent's analysis
      const text = response.text.trim();
      const startIdx = text.indexOf('{');
      const endIdx = text.lastIndexOf('}');
      if (startIdx !== -1 && endIdx !== -1) {
        const parsed = JSON.parse(text.substring(startIdx, endIdx + 1));
        return {
          plan: parsed.plan || response.text,
          isSimple: !!parsed.isSimple,
          needsSubagent: parsed.needsSubagent || 'none',
        };
      }
    } catch {
      // Fallback
    }

    return {
      plan: response.text,
      isSimple: false,
      needsSubagent: 'none' as const,
    };
  },
});

// ── Step 2: Execute Plan ──────────────────────────────────────────────────
const executeStep = createStep({
  id: 'execute-step',
  inputSchema: z.object({
    plan: z.string(),
    isSimple: z.boolean(),
    needsSubagent: z.enum(['coder', 'researcher', 'validator', 'none']),
    taskId: z.string().optional(),
  }),
  outputSchema: z.object({
    status: z.string(),
    command: z.string().optional(),
    explanation: z.string().optional(),
    subagent: z.string().optional(),
    message: z.string().optional(),
  }),
  execute: async ({ inputData }) => {
    // Route to subagent if needed
    let delegatedCommand: string | undefined;
    if (inputData.needsSubagent === 'coder') {
      const subResp = await coderAgent.generate(`Generate the shell command for: ${inputData.plan}`);
      try {
        const parsed = JSON.parse(subResp.text.substring(subResp.text.indexOf('{'), subResp.text.lastIndexOf('}') + 1));
        delegatedCommand = parsed.command;
      } catch { /* fallback to main agent */ }
    } else if (inputData.needsSubagent === 'researcher') {
      const subResp = await researcherAgent.generate(`Find the right command to: ${inputData.plan}`);
      try {
        const parsed = JSON.parse(subResp.text.substring(subResp.text.indexOf('{'), subResp.text.lastIndexOf('}') + 1));
        delegatedCommand = parsed.command;
      } catch { /* fallback */ }
    }

    // Use aura for final decision
    const prompt = delegatedCommand
      ? `Subagent proposed command: "${delegatedCommand}"\nPlan: ${inputData.plan}\nValidate and output the final step JSON.`
      : `Goal plan: ${inputData.plan}\nDetermine the next shell command to execute.`;

    const response = await aura.generate(prompt, {
      memory: inputData.taskId ? { thread: inputData.taskId, resource: 'aurora' } : undefined,
    });

    try {
      const text = response.text.trim();
      const startIdx = text.indexOf('{');
      const endIdx = text.lastIndexOf('}');
      if (startIdx !== -1 && endIdx !== -1) {
        return JSON.parse(text.substring(startIdx, endIdx + 1));
      }
    } catch { /* fallback */ }

    return { status: 'completed', message: response.text };
  },
});

// ── Workflow Definition ───────────────────────────────────────────────────
export const agentTaskWorkflow = createWorkflow({
  id: 'agent-task-workflow',
  inputSchema: z.object({
    goal: z.string(),
    taskId: z.string().optional(),
  }),
  outputSchema: z.object({
    status: z.string(),
    command: z.string().optional(),
    explanation: z.string().optional(),
    subagent: z.string().optional(),
    message: z.string().optional(),
  }),
})
  .then(analyzeStep)
  .then(executeStep)
  .commit();
