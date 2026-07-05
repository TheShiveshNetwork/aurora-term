import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { safeResolve, getDescription } from './helper';
import { rootLogger } from '../logger';

const toolLog = rootLogger.child({ tool: 'list_directory' });

export const listDirTool = createTool({
  id: 'list_directory',
  description: getDescription('list_directory.txt', 'List the contents of a directory in the workspace.'),
  inputSchema: z.object({
    path: z.string().optional().default('.').describe('Directory path, relative to workspace root.'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    files: z.array(z.object({
      name: z.string(),
      isDir: z.boolean(),
      size: z.number().optional(),
    })).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ path: dirPath }) => {
    toolLog.debug('Listing directory', { dirPath });
    try {
      const fullPath = safeResolve(dirPath || '.');
      if (!fs.existsSync(fullPath)) {
        toolLog.warn('Directory not found', { dirPath });
        return { success: false, error: `Directory not found: ${dirPath}` };
      }
      const stat = await fs.promises.stat(fullPath);
      if (!stat.isDirectory()) {
        toolLog.warn('Path is not a directory', { dirPath });
        return { success: false, error: `Path is not a directory: ${dirPath}` };
      }
      const entries = await fs.promises.readdir(fullPath, { withFileTypes: true });
      const files = await Promise.all(
        entries.map(async (entry) => {
          const entryPath = path.join(fullPath, entry.name);
          let size: number | undefined;
          if (entry.isFile()) {
            try {
              const entryStat = await fs.promises.stat(entryPath);
              size = entryStat.size;
            } catch { /* ignore stat error */ }
          }
          return {
            name: entry.name,
            isDir: entry.isDirectory(),
            size,
          };
        })
      );
      toolLog.debug('Directory listed', { dirPath, entryCount: files.length });
      return { success: true, files };
    } catch (err: any) {
      toolLog.error('Failed to list directory', { dirPath, error: err.message });
      return { success: false, error: err.message || String(err) };
    }
  },
});
