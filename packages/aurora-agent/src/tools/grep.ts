import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { safeResolve, getDescription } from './helper';
import { rootLogger } from '../logger';

const toolLog = rootLogger.child({ tool: 'grep_search' });

export const grepSearchTool = createTool({
  id: 'grep_search',
  description: getDescription('grep.txt', 'Search file contents recursively in the workspace using a regex pattern.'),
  inputSchema: z.object({
    pattern: z.string().describe('The regex pattern to search for in file contents.'),
    path: z.string().optional().describe('The directory to search in. Defaults to the current working directory.'),
    include: z.string().optional().describe('File pattern to include in the search (e.g. "*.js", "*.{ts,tsx}")'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    title: z.string().optional(),
    metadata: z.object({
      matches: z.number(),
      truncated: z.boolean(),
    }).optional(),
    output: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ pattern, path: searchPath, include }) => {
    toolLog.debug('Grep search', { pattern, searchPath, include });
    try {
      if (!pattern) {
        toolLog.warn('Grep called without pattern');
        return { success: false, error: 'pattern is required' };
      }

      const cwd = safeResolve(searchPath || '.');
      if (!fs.existsSync(cwd)) {
        toolLog.warn('Directory not found for grep', { searchPath });
        return { success: false, error: `Directory not found: ${searchPath || '.'}` };
      }

      const emptyResult = {
        success: true,
        title: pattern,
        metadata: { matches: 0, truncated: false },
        output: 'No files found',
      };

      // Helper to compile inclusion pattern
      function matchInclude(filename: string, includePattern?: string): boolean {
        if (!includePattern) return true;
        const regexStr = includePattern
          .replace(/[\-\[\]\/\{\}\(\)\+\.\\\^\$\|]/g, '\\$&')
          .replace(/\*/g, '.*')
          .replace(/\\\{/g, '(')
          .replace(/\\\}/g, ')')
          .replace(/,/g, '|');
        try {
          const regex = new RegExp(`^${regexStr}$`, 'i');
          return regex.test(filename);
        } catch {
          return true;
        }
      }

      const matchedRows: Array<{ path: string; line: number; text: string }> = [];
      const limit = 100;
      let truncated = false;

      const regex = new RegExp(pattern, 'i');

      async function walk(dir: string): Promise<boolean> {
        if (matchedRows.length >= limit) {
          truncated = true;
          return true; // stop walking
        }

        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (matchedRows.length >= limit) {
            truncated = true;
            return true;
          }

          const resPath = path.resolve(dir, entry.name);
          if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') {
              continue;
            }
            const stopped = await walk(resPath);
            if (stopped) return true;
          } else {
            if (!matchInclude(entry.name, include)) {
              continue;
            }

            try {
              const content = await fs.promises.readFile(resPath, 'utf8');
              // Simple check first
              if (!regex.test(content)) {
                continue;
              }

              const lines = content.split(/\r?\n/);
              for (let i = 0; i < lines.length; i++) {
                if (matchedRows.length >= limit) {
                  truncated = true;
                  return true;
                }
                const lineText = lines[i];
                if (regex.test(lineText)) {
                  matchedRows.push({
                    path: path.relative(cwd, resPath).replace(/\\/g, '/'),
                    line: i + 1,
                    text: lineText.trim(),
                  });
                }
              }
            } catch {
              // Ignore unreadable files
            }
          }
        }
        return false;
      }

      await walk(cwd);

      if (matchedRows.length === 0) {
        toolLog.debug('Grep found no matches', { pattern });
        return emptyResult;
      }

      const total = matchedRows.length;
      const outputLines = [`Found ${total} matches${truncated ? ' (more matches available)' : ''}`];
      let currentPath = '';

      for (const match of matchedRows) {
        if (currentPath !== match.path) {
          if (currentPath !== '') outputLines.push('');
          currentPath = match.path;
          outputLines.push(`${match.path}:`);
        }
        outputLines.push(`  Line ${match.line}: ${match.text}`);
      }

      if (truncated) {
        outputLines.push('');
        outputLines.push('(Results truncated. Consider using a more specific path or pattern.)');
      }

      toolLog.debug('Grep result', { pattern, matches: total, truncated });
      return {
        success: true,
        title: pattern,
        metadata: {
          matches: total,
          truncated,
        },
        output: outputLines.join('\n'),
      };
    } catch (err: any) {
      toolLog.error('Grep failed', { pattern, error: err.message });
      return { success: false, error: err.message || String(err) };
    }
  },
});
