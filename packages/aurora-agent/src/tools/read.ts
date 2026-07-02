import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import * as fs from 'fs';
import { safeResolve, getDescription } from './helper';

export const readFileTool = createTool({
  id: 'read_file',
  description: getDescription('read.txt', 'Read the contents of a file in the workspace.'),
  inputSchema: z.object({
    path: z.string().describe('File path, relative to workspace root.'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    content: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ path: filePath }) => {
    try {
      const fullPath = safeResolve(filePath);
      if (!fs.existsSync(fullPath)) {
        return { success: false, error: `File not found: ${filePath}` };
      }
      const content = await fs.promises.readFile(fullPath, 'utf8');
      return { success: true, content };
    } catch (err: any) {
      return { success: false, error: err.message || String(err) };
    }
  },
});
