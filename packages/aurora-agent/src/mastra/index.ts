import { Mastra } from '@mastra/core';
import {
  terminalAgent,
  developerPlanAgent,
  developerBuildAgent,
  codeCompletionAgent,
  chatAgent,
  memoryStorage,
} from '../agents';
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
  historySearchTool,
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
    terminalAgent,
    developerPlanAgent,
    developerBuildAgent,
    codeCompletionAgent,
    chatAgent,
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
    history_search: historySearchTool,
  },
});
