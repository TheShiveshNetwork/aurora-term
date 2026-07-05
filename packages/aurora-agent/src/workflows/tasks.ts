import { z } from 'zod';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { aura, coderAgent, researcherAgent, validatorAgent } from '../agents/aura';
import { rootLogger } from '../logger';

const wfLog = rootLogger.child({ service: 'workflow' });

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
    const log = wfLog.child({ step: 'analyze', taskId: inputData.taskId });
    log.info('Analyzing goal', { goal: inputData.goal });

    const startTime = Date.now();
    const response = await aura.generate(
      `Analyze this goal and determine the approach: "${inputData.goal}"\n\nRespond with JSON: {"plan": "<brief plan>", "isSimple": <true|false>, "needsSubagent": "<coder|researcher|validator|none>"}`,
      {
        memory: inputData.taskId ? { thread: inputData.taskId, resource: 'aurora' } : undefined,
      }
    );
    const elapsed = Date.now() - startTime;
    log.info('Analysis response', {
      elapsedMs: elapsed,
      textLength: response.text?.length,
      finishReason: response.finishReason,
    });

    try {
      const text = response.text.trim();
      const startIdx = text.indexOf('{');
      const endIdx = text.lastIndexOf('}');
      if (startIdx !== -1 && endIdx !== -1) {
        const parsed = JSON.parse(text.substring(startIdx, endIdx + 1));
        log.info('Analysis parsed', { plan: parsed.plan, isSimple: parsed.isSimple, needsSubagent: parsed.needsSubagent });
        return {
          plan: parsed.plan || response.text,
          isSimple: !!parsed.isSimple,
          needsSubagent: parsed.needsSubagent || 'none',
        };
      }
    } catch {
      log.warn('Failed to parse analysis JSON, using raw text');
    }

    log.info('Analysis fallback — using raw response text');
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
    const log = wfLog.child({ step: 'execute', taskId: inputData.taskId });
    log.info('Executing plan', { plan: inputData.plan, isSimple: inputData.isSimple, needsSubagent: inputData.needsSubagent });

    const startTime = Date.now();
    let delegatedCommand: string | undefined;
    if (inputData.needsSubagent === 'coder') {
      log.info('Delegating to coder subagent');
      const subResp = await coderAgent.generate(`Generate the shell command for: ${inputData.plan}`);
      try {
        const parsed = JSON.parse(subResp.text.substring(subResp.text.indexOf('{'), subResp.text.lastIndexOf('}') + 1));
        delegatedCommand = parsed.command;
        log.info('Coder subagent produced command', { command: delegatedCommand });
      } catch {
        log.warn('Coder subagent response unparseable, falling back to main agent');
      }
    } else if (inputData.needsSubagent === 'researcher') {
      log.info('Delegating to researcher subagent');
      const subResp = await researcherAgent.generate(`Find the right command to: ${inputData.plan}`);
      try {
        const parsed = JSON.parse(subResp.text.substring(subResp.text.indexOf('{'), subResp.text.lastIndexOf('}') + 1));
        delegatedCommand = parsed.command;
        log.info('Researcher subagent produced command', { command: delegatedCommand });
      } catch {
        log.warn('Researcher subagent response unparseable, falling back to main agent');
      }
    }

    const prompt = delegatedCommand
      ? `Subagent proposed command: "${delegatedCommand}"\nPlan: ${inputData.plan}\nValidate and output the final step JSON.`
      : `Goal plan: ${inputData.plan}\nDetermine the next shell command to execute.`;

    log.info('Calling aura for final decision', { delegatedCommand: !!delegatedCommand });

    const response = await aura.generate(prompt, {
      memory: inputData.taskId ? { thread: inputData.taskId, resource: 'aurora' } : undefined,
    });
    const elapsed = Date.now() - startTime;
    log.info('Execution response', {
      elapsedMs: elapsed,
      textLength: response.text?.length,
      finishReason: response.finishReason,
    });

    try {
      const text = response.text.trim();
      const startIdx = text.indexOf('{');
      const endIdx = text.lastIndexOf('}');
      if (startIdx !== -1 && endIdx !== -1) {
        const parsed = JSON.parse(text.substring(startIdx, endIdx + 1));
        log.info('Execution result', { status: parsed.status, command: parsed.command, message: parsed.message });
        return parsed;
      }
    } catch {
      log.warn('Failed to parse execution JSON, using raw text');
    }

    log.info('Execution fallback — using raw response text');
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
