import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { safeResolve, reviewSettings, getDescription, normalizeLineEndings } from './helper';
import { rootLogger } from '../logger';

const toolLog = rootLogger.child({ tool: 'patch_file' });

function buildPatchErrorDetail(
  filePath: string,
  fullPath: string,
  content: string,
  search: string,
): string {
  const previewLen = 400;
  const contentPreview = content.slice(0, previewLen).replace(/\n/g, '\\n').slice(0, 600);
  const searchPreview = search.slice(0, 200).replace(/\n/g, '\\n');
  const normalizedFound = normalizeLineEndings(content).includes(normalizeLineEndings(search));
  const trimmedFound = content.includes(search.trim());
  let hint = '';
  if (normalizedFound) hint = ' Hint: the search block exists with different line endings (CRLF vs LF). Normalize try succeeded — patch will retry with normalized replacement.';
  else if (trimmedFound) hint = ' Hint: trimmed search matches but exact whitespace does not. Ensure the `search` block copies the file verbatim including leading/trailing whitespace.';
  else hint = ' Hint: re-read the file with read_file and copy the exact block including indentation and newlines.';
  return `Search block not found exactly in file: ${filePath} (resolved: ${fullPath}). Preview search: "${searchPreview}" | file head: "${contentPreview}" | len search=${search.length} file=${content.length}.${hint}`;
}

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

    // Gated by settings check — but only suspend on the INITIAL call (no
    // resumeData). When the tool is resumed after approval, resumeData will
    // be present and we must NOT re-suspend (which would create an infinite
    // approval loop).
    const isResuming = !!(resumeData && resumeData.approved);
    if (reviewSettings.requireReviewForWrites && !resumeData) {
      toolLog.info('Suspending — awaiting approval for file patch', {
        path: input.path,
        searchLength: input.search.length,
        replaceLength: input.replace.length,
        searchPreview: input.search.slice(0, 200),
      });
      return suspend?.({
        path: input.path,
        search: input.search,
        replace: input.replace,
        type: 'patch' as const,
      });
    }

    if (resumeData && !resumeData.approved) {
      toolLog.warn('File patch rejected by user', { path: input.path });
      return { success: false, error: 'User rejected the file patch operation.' };
    }

    toolLog.info('Patching file', { path: input.path, searchLength: input.search.length, fullPath: safeResolve(input.path) });
    try {
      const fullPath = safeResolve(input.path);
      if (!fs.existsSync(fullPath)) {
        // Provide a diagnostic that helps the model retry with an absolute path
        const altCwd = process.cwd();
        toolLog.error('File not found for patching', { path: input.path, fullPath, cwd: altCwd });
        return { success: false, error: `File not found to patch: ${input.path} (resolved to ${fullPath}, cwd=${altCwd}). The path must be absolute or relative to ${altCwd}. Prefer the absolute path from [FILE CONTEXT].` };
      }
      const content = await fs.promises.readFile(fullPath, 'utf8');
      // Fast path: exact match
      if (content.includes(input.search)) {
        const updated = content.replace(input.search, input.replace);
        await fs.promises.writeFile(fullPath, updated, 'utf8');
        toolLog.debug('File patched (exact)', { path: input.path, fullPath });
        return { success: true };
      }
      // Normalized line-ending match: file may be CRLF while search is LF or vice-versa
      const normContent = normalizeLineEndings(content);
      const normSearch = normalizeLineEndings(input.search);
      const normReplace = normalizeLineEndings(input.replace);
      if (normContent.includes(normSearch)) {
        // Reconstruct by replacing in normalized domain then restoring original endings.
        // Detect original dominant ending: if file contains \r\n use it, else \n.
        const useCRLF = content.includes('\r\n');
        let updatedNorm = normContent.replace(normSearch, normReplace);
        const updated = useCRLF ? updatedNorm.replace(/\n/g, '\r\n') : updatedNorm;
        await fs.promises.writeFile(fullPath, updated, 'utf8');
        toolLog.info('File patched (normalized line endings)', { path: input.path, fullPath });
        return { success: true };
      }
      // Fallback diagnostic with actionable hint
      const detail = buildPatchErrorDetail(input.path, fullPath, content, input.search);
      toolLog.error('Search block not found in file', { path: input.path, fullPath, detail: detail.slice(0, 800) });
      return { success: false, error: detail };
    } catch (err: any) {
      toolLog.error('Failed to patch file', { path: input.path, error: err.message });
      return { success: false, error: err.message || String(err) };
    }
  },
});
