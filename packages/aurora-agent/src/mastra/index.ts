import { Mastra } from '@mastra/core';
import { aura, memoryStorage } from '../agents/aura';
import { agentTaskWorkflow } from '../workflows/tasks';
import {
  greetingTestFlow,
  simpleCommandTestFlow,
  multiStepTestFlow,
  errorRecoveryTestFlow,
  sensitiveCommandTestFlow,
} from '../workflows/test-flows';

// Use the same LibSQLStore that backs auraMemory so all memory data
// (threads, working memory, workflow state) lands in a single SQLite file.
export const mastra = new Mastra({
  agents: {
    aura,
  },
  workflows: {
    agentTaskWorkflow,
    // Test flows
    greetingTestFlow,
    simpleCommandTestFlow,
    multiStepTestFlow,
    errorRecoveryTestFlow,
    sensitiveCommandTestFlow,
  },
  storage: memoryStorage,
});
