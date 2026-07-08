import { Mastra } from '@mastra/core';
import {
  aura,
  terminalAgent,
  developerPlanAgent,
  developerBuildAgent,
  codeCompletionAgent,
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

import { ConsoleLogger, createCustomTransport } from '@mastra/core/logger';
import { Transform } from 'stream';
import { rootLogger, getMemoryLogs, addSink } from '../logger';

export const memoryLogs: Array<{ timestamp: number; type: string; content: string }> = [];
const MAX_MEMORY_LOG_ENTRIES = 2000;

addSink((entry) => {
  memoryLogs.push({
    timestamp: new Date(entry.time).getTime(),
    type: entry.level,
    content: entry.err
      ? `${entry.msg} — ${entry.err.message}`
      : entry.msg,
  });
  if (memoryLogs.length > MAX_MEMORY_LOG_ENTRIES) {
    memoryLogs.splice(0, memoryLogs.length - MAX_MEMORY_LOG_ENTRIES);
  }
});

const logTransformStream = new Transform({
  transform(chunk, encoding, callback) {
    try {
      const parsed = JSON.parse(chunk.toString());
      rootLogger.info(parsed.msg || chunk.toString(), {
        source: 'mastra',
        level: parsed.level,
        ...(parsed.name ? { logger: parsed.name } : {}),
      });
    } catch {
      rootLogger.debug(chunk.toString(), { source: 'mastra-raw' });
    }
    callback(null, chunk);
  }
});

const memoryTransport = createCustomTransport(logTransformStream);

export const customLogger = new ConsoleLogger({
  name: 'aurora-agent',
  level: 'debug',
});
customLogger.getTransports().set('memory', memoryTransport);

export const mastra = new Mastra({
  logger: customLogger,
  agents: {
    aura,
    terminalAgent,
    developerPlanAgent,
    developerBuildAgent,
    codeCompletionAgent,
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
