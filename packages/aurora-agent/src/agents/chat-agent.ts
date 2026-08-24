import { Agent } from '@mastra/core/agent';
import { getModelProvider } from './shared/model-provider';
import { auraMemory } from './shared/memory';
import { getDynamicInstructions, loadPrompt } from './shared/prompts';

export const chatAgent = new Agent({
  id: 'chatAgent',
  name: 'Aurora Chat',
  description:
    'Zero-tool conversational answers only — no file access, no execution. Runs alongside an in-progress background task without interrupting it. ' +
    'Use for questions, clarifications, and small talk that need no codebase or system access. ' +
    'Never attempts execution itself; redirects those requests to Terminal Agent or Developer Agent.',
  instructions: () => getDynamicInstructions(loadPrompt('chat-agent.txt')),
  model: async () => getModelProvider(undefined, undefined, 'balanced'),
  memory: auraMemory,
  // maxSteps=1 also bounds /api/chat, which passes no explicit maxSteps.
  defaultOptions: {
    maxSteps: 1,
    modelSettings: { temperature: 0.7 },
  },
});
