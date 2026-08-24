import { Agent } from '@mastra/core/agent';
import { getModelProvider } from './shared/model-provider';
import { auraMemory } from './shared/memory';
import { getDynamicInstructions, envelopeSystemPrompt } from './shared/prompts';
import { auraResponseValidator } from '../processors/auraResponseValidator';
import {
  readFileTool,
  listDirTool,
  searchFilesTool,
  grepSearchTool,
  globTool,
  webFetchTool,
  askUserTool,
} from '../tools';

export const developerPlanAgent = new Agent({
  id: 'developerPlanAgent',
  name: 'Developer Agent (Plan Mode)',
  description:
    'Read-only codebase investigation and planning. Produces a precise, file-by-file implementation plan for a feature, fix, or refactor — never writes or executes anything. ' +
    'Use for "how would I...", "plan out...", or pre-implementation architecture decisions. ' +
    'Hand its plan to Developer Agent (Build Mode) to execute.',
  instructions: () => getDynamicInstructions(envelopeSystemPrompt('developer-plan-agent.txt')),
  model: async () => getModelProvider(undefined, undefined, 'powerful'),
  memory: auraMemory,
  tools: {
    read_file: readFileTool,
    list_directory: listDirTool,
    search_files: searchFilesTool,
    grep_search: grepSearchTool,
    glob: globTool,
    web_fetch: webFetchTool,
    ask_user: askUserTool,
  },
  defaultOptions: {
    maxSteps: 40,
    modelSettings: { temperature: 0.3 },
  },
  outputProcessors: [auraResponseValidator],
});
