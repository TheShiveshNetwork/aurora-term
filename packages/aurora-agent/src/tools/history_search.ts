import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { rootLogger } from '../logger';

const toolLog = rootLogger.child({ tool: 'history_search' });

function getHistoryPaths(): string[] {
  const home = os.homedir();
  const paths: string[] = [];

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    // PSReadLine history paths (PowerShell 5+ / 7+)
    paths.push(path.join(appData, 'Microsoft', 'Windows', 'PowerShell', 'PSReadLine', 'ConsoleHost_history.txt'));
    paths.push(path.join(home, 'Documents', 'PowerShell', 'PSReadLine', 'ConsoleHost_history.txt'));
  } else {
    // macOS and Linux history paths
    paths.push(path.join(home, '.zsh_history'));
    paths.push(path.join(home, '.bash_history'));
    paths.push(path.join(home, '.local', 'share', 'fish', 'fish_history'));
  }

  return paths;
}

export const historySearchTool = createTool({
  id: 'history_search',
  description: 'Search shell command history to find previously run commands.',
  inputSchema: z.object({
    query: z.string().describe('Search query or substring to match in history.'),
    limit: z.number().optional().default(10).describe('Maximum number of matching commands to return.'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    results: z.array(z.string()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ query, limit }) => {
    toolLog.debug('Searching history', { query, limit });
    try {
      const historyFiles = getHistoryPaths();
      let lines: string[] = [];

      for (const file of historyFiles) {
        if (fs.existsSync(file)) {
          toolLog.debug('Reading history file', { file });
          const content = await fs.promises.readFile(file, 'utf8');
          // Parse lines
          const rawLines = content.split(/\r?\n/);
          for (let line of rawLines) {
            line = line.trim();
            if (!line) continue;

            // Strip zsh extended history prefix: ": 1721111111:0;command"
            if (line.startsWith(':') && line.includes(';')) {
              const semicolonIndex = line.indexOf(';');
              if (semicolonIndex !== -1) {
                line = line.substring(semicolonIndex + 1).trim();
              }
            }

            if (line) {
              lines.push(line);
            }
          }
          // We read the first matching history file (e.g. zsh is preferred over bash if both exist, or vice versa)
          break;
        }
      }

      if (lines.length === 0) {
        toolLog.warn('No command history found on this system');
        return { success: true, results: [] };
      }

      // De-duplicate, keeping the latest occurrences
      const uniqueCommands = Array.from(new Set(lines.reverse()));

      // Filter by query substring (case-insensitive)
      const lowercaseQuery = query.toLowerCase();
      const filtered = uniqueCommands.filter(cmd => cmd.toLowerCase().includes(lowercaseQuery));

      // Limit results
      const results = filtered.slice(0, limit);

      toolLog.debug('History search completed', { matches: results.length });
      return { success: true, results };
    } catch (err: any) {
      toolLog.error('Failed to search command history', { error: err.message });
      return { success: false, error: err.message || String(err) };
    }
  },
});
