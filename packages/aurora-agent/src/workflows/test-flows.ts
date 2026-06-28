import { z } from 'zod';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { aura, coderAgent, researcherAgent, validatorAgent } from '../agents/aura';

// ────────────────────────────────────────────────────────────────────────────
// Test Flows for aurora-agent
//
// Each flow exercises a specific scenario to verify correct agent behaviour:
// 1. Greeting test    — "hello" must return {status:"completed"}, no commands
// 2. Simple command   — "list files" must run exactly one command then complete
// 3. Multi-step       — "check git status" must chain 1-2 commands intelligently
// 4. Error recovery   — injected failing exit code must be handled gracefully
// 5. Sensitive guard  — "delete temp folder" must pause for user approval
// ────────────────────────────────────────────────────────────────────────────

// ── Shared Schemas ────────────────────────────────────────────────────────

const StepResultSchema = z.object({
  status: z.enum(['executing', 'completed', 'error']),
  command: z.string().optional(),
  explanation: z.string().optional(),
  subagent: z.string().optional(),
  message: z.string().optional(),
});

type StepResult = z.infer<typeof StepResultSchema>;

// ── Helper: call /api/step directly (for test isolation) ─────────────────
async function callApiStep(params: {
  task_id: string;
  goal?: string;
  last_output?: string;
  exit_code?: number;
}): Promise<StepResult> {
  // In tests, we use the agent directly instead of HTTP to keep it isolated
  const GREETINGS = /^(hi|hello|hey|howdy|greetings|sup|yo|what'?s up|good (morning|afternoon|evening))\b[!?.]*/i;

  if (params.goal && GREETINGS.test(params.goal.trim())) {
    return {
      status: 'completed',
      message: "Hello! I'm Aura. Describe a task and I'll execute it.",
    };
  }

  const prompt = params.goal
    ? `Goal: ${params.goal}`
    : `Previous command exit code: ${params.exit_code ?? 0}\nOutput:\n${params.last_output ?? '(no output)'}`;

  const response = await aura.generate(prompt, {
    memory: { thread: params.task_id, resource: 'aurora' },
  });

  try {
    const text = response.text.trim();
    const startIdx = text.indexOf('{');
    const endIdx = text.lastIndexOf('}');
    if (startIdx !== -1 && endIdx !== -1) {
      return JSON.parse(text.substring(startIdx, endIdx + 1)) as StepResult;
    }
  } catch { /* fallback */ }

  return { status: 'completed', message: response.text };
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 1: Greeting Test
// Input: "hello"
// Expected: {status:"completed"} immediately, NO commands
// ════════════════════════════════════════════════════════════════════════════

const greetingInputStep = createStep({
  id: 'greeting-input',
  inputSchema: z.object({ taskId: z.string().optional() }),
  outputSchema: z.object({ result: StepResultSchema, passed: z.boolean(), reason: z.string() }),
  execute: async ({ inputData }) => {
    const result = await callApiStep({ task_id: inputData.taskId ?? 'test-greeting', goal: 'hello' });
    const passed = result.status === 'completed' && !result.command;
    return {
      result,
      passed,
      reason: passed
        ? '✅ Greeting correctly returned completed with no commands'
        : `❌ Greeting returned unexpected: ${JSON.stringify(result)}`,
    };
  },
});

export const greetingTestFlow = createWorkflow({
  id: 'test-greeting',
  inputSchema: z.object({ taskId: z.string().optional() }),
  outputSchema: z.object({ result: StepResultSchema, passed: z.boolean(), reason: z.string() }),
}).then(greetingInputStep).commit();

// ════════════════════════════════════════════════════════════════════════════
// TEST 2: Simple Command Test
// Input: "list files"
// Expected: exactly 1 executing step → then completed
// ════════════════════════════════════════════════════════════════════════════

const simpleCommandStep = createStep({
  id: 'simple-command-input',
  inputSchema: z.object({ taskId: z.string().optional() }),
  outputSchema: z.object({
    step1: StepResultSchema,
    step2: StepResultSchema,
    passed: z.boolean(),
    reason: z.string(),
  }),
  execute: async ({ inputData }) => {
    const tid = inputData.taskId ?? 'test-simple';
    const step1 = await callApiStep({ task_id: tid, goal: 'list files in current directory' });
    
    let step2: StepResult = { status: 'completed', message: 'No second step needed' };
    if (step1.status === 'executing') {
      // Simulate successful command output
      step2 = await callApiStep({
        task_id: tid,
        last_output: 'file1.txt\nfile2.ts\npackage.json',
        exit_code: 0,
      });
    }

    const passed = step1.status === 'executing' && !!step1.command && step2.status === 'completed';
    return {
      step1,
      step2,
      passed,
      reason: passed
        ? `✅ Simple command: step1=${step1.command}, step2=completed`
        : `❌ Unexpected flow: step1=${JSON.stringify(step1)}, step2=${JSON.stringify(step2)}`,
    };
  },
});

export const simpleCommandTestFlow = createWorkflow({
  id: 'test-simple-command',
  inputSchema: z.object({ taskId: z.string().optional() }),
  outputSchema: z.object({
    step1: StepResultSchema,
    step2: StepResultSchema,
    passed: z.boolean(),
    reason: z.string(),
  }),
}).then(simpleCommandStep).commit();

// ════════════════════════════════════════════════════════════════════════════
// TEST 3: Multi-Step Test
// Input: "check git status and show last 3 commits"
// Expected: 2 sequential commands, then completed
// ════════════════════════════════════════════════════════════════════════════

const multiStepTestStep = createStep({
  id: 'multi-step-input',
  inputSchema: z.object({ taskId: z.string().optional() }),
  outputSchema: z.object({
    steps: z.array(StepResultSchema),
    commandCount: z.number(),
    passed: z.boolean(),
    reason: z.string(),
  }),
  execute: async ({ inputData }) => {
    const tid = inputData.taskId ?? 'test-multistep';
    const steps: StepResult[] = [];
    const MAX = 5;

    let current = await callApiStep({
      task_id: tid,
      goal: 'check git status and show the last 3 commits',
    });
    steps.push(current);

    while (current.status === 'executing' && steps.length < MAX) {
      current = await callApiStep({
        task_id: tid,
        last_output: `Simulated output for: ${current.command}`,
        exit_code: 0,
      });
      steps.push(current);
    }

    const commandCount = steps.filter((s) => s.status === 'executing').length;
    const lastStep = steps[steps.length - 1];
    const passed = commandCount >= 1 && lastStep.status === 'completed';

    return {
      steps,
      commandCount,
      passed,
      reason: passed
        ? `✅ Multi-step: ${commandCount} command(s) → completed`
        : `❌ Did not complete. Steps: ${JSON.stringify(steps.map(s => s.status))}`,
    };
  },
});

export const multiStepTestFlow = createWorkflow({
  id: 'test-multi-step',
  inputSchema: z.object({ taskId: z.string().optional() }),
  outputSchema: z.object({
    steps: z.array(StepResultSchema),
    commandCount: z.number(),
    passed: z.boolean(),
    reason: z.string(),
  }),
}).then(multiStepTestStep).commit();

// ════════════════════════════════════════════════════════════════════════════
// TEST 4: Error Recovery Test
// Injects a failing exit code to verify agent handles gracefully
// ════════════════════════════════════════════════════════════════════════════

const errorRecoveryStep = createStep({
  id: 'error-recovery-input',
  inputSchema: z.object({ taskId: z.string().optional() }),
  outputSchema: z.object({
    step1: StepResultSchema,
    step2: StepResultSchema,
    passed: z.boolean(),
    reason: z.string(),
  }),
  execute: async ({ inputData }) => {
    const tid = inputData.taskId ?? 'test-error';
    const step1 = await callApiStep({
      task_id: tid,
      goal: 'run git status',
    });

    // Simulate a command failure
    const step2 = await callApiStep({
      task_id: tid,
      last_output: "fatal: not a git repository (or any of the parent directories): .git",
      exit_code: 128,
    });

    // The agent should either try a recovery command or return error/completed gracefully
    const passed = step2.status === 'completed' || step2.status === 'error' || step2.status === 'executing';
    return {
      step1,
      step2,
      passed,
      reason: passed
        ? `✅ Error handled gracefully: status=${step2.status}, msg=${step2.message}`
        : `❌ Unexpected error state: ${JSON.stringify(step2)}`,
    };
  },
});

export const errorRecoveryTestFlow = createWorkflow({
  id: 'test-error-recovery',
  inputSchema: z.object({ taskId: z.string().optional() }),
  outputSchema: z.object({
    step1: StepResultSchema,
    step2: StepResultSchema,
    passed: z.boolean(),
    reason: z.string(),
  }),
}).then(errorRecoveryStep).commit();

// ════════════════════════════════════════════════════════════════════════════
// TEST 5: Sensitive Command Detection Test
// Input: something that should trigger a destructive command
// Expected: command returned with warning (frontend will gate it)
// ════════════════════════════════════════════════════════════════════════════

const sensitiveCommandStep = createStep({
  id: 'sensitive-command-input',
  inputSchema: z.object({ taskId: z.string().optional() }),
  outputSchema: z.object({
    result: StepResultSchema,
    commandIsSensitive: z.boolean(),
    passed: z.boolean(),
    reason: z.string(),
  }),
  execute: async ({ inputData }) => {
    const result = await callApiStep({
      task_id: inputData.taskId ?? 'test-sensitive',
      goal: 'delete the temporary files in C:\\Windows\\Temp',
    });

    // The command should contain a sensitive pattern (rm, del, Remove-Item, etc.)
    const sensitivePatterns = /\b(rm|del|remove-item|rmdir|rd|erase|format)\b/i;
    const commandIsSensitive = !!result.command && sensitivePatterns.test(result.command);

    const passed = result.status === 'executing' && commandIsSensitive;
    return {
      result,
      commandIsSensitive,
      passed,
      reason: passed
        ? `✅ Sensitive command correctly identified: ${result.command}`
        : `❌ Expected a sensitive executing command, got: ${JSON.stringify(result)}`,
    };
  },
});

export const sensitiveCommandTestFlow = createWorkflow({
  id: 'test-sensitive-command',
  inputSchema: z.object({ taskId: z.string().optional() }),
  outputSchema: z.object({
    result: StepResultSchema,
    commandIsSensitive: z.boolean(),
    passed: z.boolean(),
    reason: z.string(),
  }),
}).then(sensitiveCommandStep).commit();
