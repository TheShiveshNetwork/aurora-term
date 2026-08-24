import { Agent } from '@mastra/core/agent';
import { getModelProvider } from './shared/model-provider';
import { auraMemory } from './shared/memory';
import { getDynamicInstructions, envelopeSystemPrompt } from './shared/prompts';
import { auraResponseValidator } from '../processors/auraResponseValidator';
import { terminalShellTool } from '../tools/shell';
import { readFileTool, listDirTool, askUserTool, historySearchTool, execCommandTool } from '../tools';

export const terminalAgent = new Agent({
  id: 'terminalAgent',
  name: 'Terminal Agent',
  description:
    'Executes shell commands directly to accomplish a stated goal in the active terminal session. ' +
    'Default for "run X", "what does Y command show", system/process/package operations, and one-off diagnostics. ' +
    'NOT for multi-file code changes or feature implementation — route those to Developer Agent (Build Mode). ' +
    'NOT for questions answerable without running anything — route those to Chat Agent.',
  instructions: () => getDynamicInstructions(envelopeSystemPrompt('terminal-agent.txt')),
  model: async () => getModelProvider(undefined, undefined, 'balanced'),
  memory: auraMemory,
  tools: {
    shell_terminal: terminalShellTool,
    exec_command: execCommandTool,
    read_file: readFileTool,
    list_directory: listDirTool,
    ask_user: askUserTool,
    history_search: historySearchTool,
  },
  defaultOptions: {
    maxSteps: 20,
    modelSettings: { temperature: 0.2 },
  },
  outputProcessors: [auraResponseValidator],
});
