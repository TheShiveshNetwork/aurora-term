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
  patchFileTool,
  writeFileTool,
  webFetchTool,
  askUserTool,
} from '../tools';
import { developerShellTool } from '../tools/shell';
import { execCommandTool } from '../tools';

export const developerBuildAgent = new Agent({
  id: 'developerBuildAgent',
  name: 'Developer Agent (Build Mode)',
  description:
    'Full read/write/execute implementation agent — writes code, runs builds and tests, uses git. ' +
    'Use for concrete implementation work: given a plan (from Plan Mode) or a small well-scoped change, makes the edit and verifies it. ' +
    'NOT for pure investigation with no code change (use Plan Mode) and NOT for arbitrary system/shell tasks unrelated to the codebase (use Terminal Agent).',
  instructions: () => getDynamicInstructions(envelopeSystemPrompt('developer-build-agent.txt')),
  model: async () => getModelProvider(undefined, undefined, 'powerful'),
  memory: auraMemory,
  tools: {
    read_file: readFileTool,
    list_directory: listDirTool,
    search_files: searchFilesTool,
    grep_search: grepSearchTool,
    glob: globTool,
    patch_file: patchFileTool,
    write_file: writeFileTool,
    shell_developer: developerShellTool,
    exec_command: execCommandTool,
    web_fetch: webFetchTool,
    ask_user: askUserTool,
  },
  defaultOptions: {
    maxSteps: 20,
    modelSettings: { temperature: 0.2 },
  },
  outputProcessors: [auraResponseValidator],
});
