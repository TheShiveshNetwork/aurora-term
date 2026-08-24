import * as fs from 'fs';
import * as path from 'path';

export interface FileContext {
  path: string;
  name: string;
  size: number;
  size_human: string;
  preview: string;
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function parseFileContext(filePath: string, options?: { previewChars?: number }): FileContext | null {
  const previewChars = options?.previewChars ?? 500;
  let abs = filePath;
  try {
    if (!path.isAbsolute(abs)) abs = path.resolve(process.cwd(), abs);
    const stat = fs.statSync(abs);
    if (!stat.isFile()) return null;

    let preview = '';
    try {
      const buf = fs.readFileSync(abs, 'utf8');
      preview = buf.slice(0, previewChars);
      if (buf.length > previewChars) preview += '\n… [truncated]';
    } catch {
      preview = '<binary or unreadable>';
    }

    return {
      path: abs,
      name: path.basename(abs),
      size: stat.size,
      size_human: humanSize(stat.size),
      preview,
    };
  } catch {
    return null;
  }
}

export function formatFileContexts(contexts: FileContext[]): string {
  if (!contexts.length) return '';
  const parts = contexts.map((ctx) => {
    return [
      `- ${ctx.path} — ${ctx.size_human}`,
      `  Preview (first ${ctx.preview.length} chars):`,
      '  ```',
      ctx.preview.replace(/```/g, '``\u200b`'),
      '  ```',
    ].join('\n');
  });
  
  return [
    '[FILE CONTEXT]',
    'The following files are open in the editor and relevant to this task. Only metadata',
    'and a short preview are provided here — use read_file to inspect full contents.',
    'If the task asks you to modify these files, you are expected to actually make the',
    'change: use patch_file for targeted edits or write_file for new/rewritten files,',
    'targeting the exact paths listed above.',
    parts.join('\n'),
    '[/FILE CONTEXT]',
  ].join('\n');
}

export function formatSelectionContext(selection: {
  path: string;
  startLine: number;
  endLine: number;
  text: string;
}): string {
  const lines = selection.text.split('\n');
  const numbered = lines
    .map((line, i) => `  ${String(selection.startLine + i).padStart(4)} | ${line}`)
    .join('\n');
  return [
    '[SELECTED LINES]',
    `The user has selected lines ${selection.startLine}-${selection.endLine} of:`,
    `  ${selection.path}`,
    'These are the exact lines the user is referring to. Focus all edits on this selection:',
    '```',
    numbered,
    '```',
    '[/SELECTED LINES]',
  ].join('\n');
}
