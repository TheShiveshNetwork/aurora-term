import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { safeResolve, getDescription } from './helper';

export const searchFilesTool = createTool({
  id: 'search_files',
  description: getDescription('search_files.txt', 'Find files in the workspace matching a name or query.'),
  inputSchema: z.object({
    query: z.string().describe('Search query or file name fragment (e.g. "package.json").'),
    path: z.string().optional().default('.').describe('The directory to search in, relative to workspace root.'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    files: z.array(z.string()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ query, path: searchPath }) => {
    try {
      const baseDir = safeResolve(searchPath || '.');
      if (!fs.existsSync(baseDir)) {
        return { success: false, error: `Directory not found: ${searchPath}` };
      }
      
      const matches: string[] = [];
      const normalizedQuery = query.toLowerCase();

      async function walk(dir: string) {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const resPath = path.resolve(dir, entry.name);
          if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') {
              continue;
            }
            await walk(resPath);
          } else {
            if (entry.name.toLowerCase().includes(normalizedQuery)) {
              matches.push(path.relative(baseDir, resPath).replace(/\\/g, '/'));
            }
          }
        }
      }
      
      await walk(baseDir);
      return { success: true, files: matches };
    } catch (err: any) {
      return { success: false, error: err.message || String(err) };
    }
  },
});
