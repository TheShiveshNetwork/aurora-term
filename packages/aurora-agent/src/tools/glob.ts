import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { safeResolve, getDescription } from './helper';

export const globTool = createTool({
  id: 'glob',
  description: getDescription('glob.txt', 'Find files in the workspace matching a glob pattern.'),
  inputSchema: z.object({
    pattern: z.string().describe('The glob pattern to match files against.'),
    path: z.string().optional().default('.').describe('The directory to search in, relative to workspace root.'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    files: z.array(z.string()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ pattern, path: searchPath }) => {
    try {
      const baseDir = safeResolve(searchPath || '.');
      if (!fs.existsSync(baseDir)) {
        return { success: false, error: `Directory not found: ${searchPath}` };
      }
      
      const allFiles: string[] = [];
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
            const relativePath = path.relative(baseDir, resPath).replace(/\\/g, '/');
            allFiles.push(relativePath);
          }
        }
      }
      
      await walk(baseDir);
      
      const regexStr = pattern
        .replace(/[\-\[\]\/\{\}\(\)\+\.\\\^\$\|]/g, '\\$&')
        .replace(/\*\*/g, '@@ANYTHING@@')
        .replace(/\*/g, '[^/]*?')
        .replace(/@@ANYTHING@@/g, '.*?')
        .replace(/\?/g, '.');
      
      const regex = new RegExp(`^${regexStr}$`, 'i');
      const matchedFiles = allFiles.filter(f => regex.test(f));
      
      return { success: true, files: matchedFiles };
    } catch (err: any) {
      return { success: false, error: err.message || String(err) };
    }
  },
});
