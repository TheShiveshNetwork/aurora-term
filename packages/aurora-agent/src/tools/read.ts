import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import * as fs from 'fs';
import { safeResolve, getDescription } from './helper';
import { rootLogger } from '../logger';

const toolLog = rootLogger.child({ tool: 'read_file' });

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
    toolLog.debug('Reading file', { path: filePath });
    try {
      const fullPath = safeResolve(filePath);
      if (!fs.existsSync(fullPath)) {
        toolLog.warn('File not found', { path: filePath });
        return { success: false, error: `File not found: ${filePath}` };
      }
      const content = await fs.promises.readFile(fullPath, 'utf8');
      toolLog.debug('File read', { path: filePath, size: content.length });
      return { success: true, content };
    } catch (err: any) {
      toolLog.error('Failed to read file', { path: filePath, error: err.message });
      return { success: false, error: err.message || String(err) };
    }
  },
});
