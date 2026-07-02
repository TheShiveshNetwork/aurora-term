import { Mastra } from '@mastra/core';
import {
  aura,
  terminalAgent,
  developerPlanAgent,
  developerBuildAgent,
  memoryStorage,
} from '../agents/aura';
import { agentTaskWorkflow } from '../workflows/tasks';
import {
  greetingTestFlow,
  simpleCommandTestFlow,
  multiStepTestFlow,
  errorRecoveryTestFlow,
  sensitiveCommandTestFlow,
} from '../workflows/test-flows';
import {
  readFileTool,
  listDirTool,
  searchFilesTool,
  grepSearchTool,
  writeFileTool,
  patchFileTool,
  execCommandTool,
  globTool,
  webFetchTool,
  askUserTool,
  terminalShellTool,
  developerShellTool,
} from '../tools';

import { createLogger, createCustomTransport } from '@mastra/core/logger';
import { Transform } from 'stream';

export const memoryLogs: Array<{ timestamp: number; type: string; content: string }> = [];

const logTransformStream = new Transform({
  transform(chunk, encoding, callback) {
    try {
      const parsed = JSON.parse(chunk.toString());
      memoryLogs.push({
        timestamp: Date.now(),
        type: (parsed.levelLabel || parsed.level || 'info').toLowerCase(),
        content: parsed.msg || JSON.stringify(parsed),
      });
    } catch {
      memoryLogs.push({
        timestamp: Date.now(),
        type: 'info',
        content: chunk.toString(),
      });
    }
    callback(null, chunk);
  }
});

const memoryTransport = createCustomTransport(logTransformStream);

export const customLogger = createLogger({
  name: 'aurora-agent',
  level: 'info',
  transports: {
    memory: memoryTransport,
  },
});

export const mastra = new Mastra({
  logger: customLogger,
  agents: {
    aura,
    terminalAgent,
    developerPlanAgent,
    developerBuildAgent,
  },
  workflows: {
    agentTaskWorkflow,
    greetingTestFlow,
    simpleCommandTestFlow,
    multiStepTestFlow,
    errorRecoveryTestFlow,
    sensitiveCommandTestFlow,
  },
  storage: memoryStorage,
  tools: {
    read_file: readFileTool,
    list_directory: listDirTool,
    search_files: searchFilesTool,
    grep_search: grepSearchTool,
    write_file: writeFileTool,
    patch_file: patchFileTool,
    exec_command: execCommandTool,
    glob: globTool,
    web_fetch: webFetchTool,
    ask_user: askUserTool,
    shell_terminal: terminalShellTool,
    shell_developer: developerShellTool,
  },
});
