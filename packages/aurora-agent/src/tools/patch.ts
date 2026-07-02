import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import * as fs from 'fs';
import { safeResolve, reviewSettings, getDescription } from './helper';

export const patchFileTool = createTool({
  id: 'patch_file',
  description: getDescription('patch.txt', 'Patch an existing file by replacing a specific search block with a replacement block.'),
  inputSchema: z.object({
    path: z.string().describe('Target file path, relative to workspace root.'),
    search: z.string().describe('The exact block of code to search for. Must match exactly including whitespace.'),
    replace: z.string().describe('The replacement block of code.'),
  }),
  suspendSchema: z.object({
    path: z.string(),
    search: z.string(),
    replace: z.string(),
    type: z.literal('patch'),
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
        search: input.search,
        replace: input.replace,
        type: 'patch' as const,
      });
    }

    if (resumeData && !resumeData.approved) {
      return { success: false, error: 'User rejected the file patch operation.' };
    }

    try {
      const fullPath = safeResolve(input.path);
      if (!fs.existsSync(fullPath)) {
        return { success: false, error: `File not found to patch: ${input.path}` };
      }
      const content = await fs.promises.readFile(fullPath, 'utf8');
      if (!content.includes(input.search)) {
        return { success: false, error: `Search block not found exactly in file: ${input.path}` };
      }
      const updated = content.replace(input.search, input.replace);
      await fs.promises.writeFile(fullPath, updated, 'utf8');
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || String(err) };
    }
  },
});
