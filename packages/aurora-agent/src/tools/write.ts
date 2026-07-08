import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { safeResolve, reviewSettings, getDescription } from './helper';
import { rootLogger } from '../logger';

const toolLog = rootLogger.child({ tool: 'write_file' });

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
      toolLog.info('Suspending — awaiting approval for file write', {
        path: input.path,
        contentLength: input.content.length,
        contentPreview: input.content.slice(0, 200),
      });
      return suspend?.({
        path: input.path,
        content: input.content,
        type: 'write' as const,
      });
    }

    if (resumeData && !resumeData.approved) {
      toolLog.warn('File write rejected by user', { path: input.path });
      return { success: false, error: 'User rejected the file write operation.' };
    }

    toolLog.info('Writing file', { path: input.path, contentLength: input.content.length });
    try {
      const fullPath = safeResolve(input.path);
      const parentDir = path.dirname(fullPath);
      if (!fs.existsSync(parentDir)) {
        await fs.promises.mkdir(parentDir, { recursive: true });
      }
      await fs.promises.writeFile(fullPath, input.content, 'utf8');
      toolLog.debug('File written', { path: input.path });
      return { success: true };
    } catch (err: any) {
      toolLog.error('Failed to write file', { path: input.path, error: err.message });
      return { success: false, error: err.message || String(err) };
    }
  },
});
