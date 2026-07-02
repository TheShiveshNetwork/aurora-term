import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { safeResolve, reviewSettings, getDescription } from './helper';

export const writeFileTool = createTool({
  id: 'write_file',
  description: getDescription('write.txt', 'Write content to a file in the workspace.'),
  inputSchema: z.object({
    path: z.string().describe('Target file path, relative to workspace root.'),
    content: z.string().describe('The complete file content to write.'),
  }),
  suspendSchema: z.object({
    path: z.string(),
    content: z.string(),
    type: z.literal('write'),
  }),
  resumeSchema: z.object({
    approved: z.boolean(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    error: z.string().optional(),
  }),
  execute: async (input, context) => {
    const { resumeData, suspend } = context?.agent ?? {};

    // Gated by settings check
    if (reviewSettings.requireReviewForWrites && !resumeData) {
      return suspend?.({
        path: input.path,
        content: input.content,
        type: 'write' as const,
      });
    }

    if (resumeData && !resumeData.approved) {
      return { success: false, error: 'User rejected the file write operation.' };
    }

    try {
      const fullPath = safeResolve(input.path);
      const parentDir = path.dirname(fullPath);
      if (!fs.existsSync(parentDir)) {
        await fs.promises.mkdir(parentDir, { recursive: true });
      }
      await fs.promises.writeFile(fullPath, input.content, 'utf8');
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || String(err) };
    }
  },
});
