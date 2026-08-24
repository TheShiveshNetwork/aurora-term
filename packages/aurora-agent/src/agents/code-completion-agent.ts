import { Agent } from '@mastra/core/agent';
import { getModelProvider } from './shared/model-provider';
import { getDynamicInstructions, loadPrompt } from './shared/prompts';

export const codeCompletionAgent = new Agent({
  id: 'codeCompletionAgent',
  name: 'Code Completion Agent',
  description:
    'Raw code completion/editing only — returns code, never prose. For anything that needs explanation, planning, or verification, use Developer Agent instead.',
  instructions: () => getDynamicInstructions(loadPrompt('code-completion-agent.txt')),
  model: async () => getModelProvider(undefined, undefined, 'fast'),
  defaultOptions: {
    maxSteps: 1,
    modelSettings: { temperature: 0.2 },
  },
});
