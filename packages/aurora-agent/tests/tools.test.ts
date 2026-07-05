import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  readFileTool,
  writeFileTool,
  patchFileTool,
  execCommandTool,
  globTool,
  webFetchTool,
  askUserTool,
  grepSearchTool,
  listDirTool,
  searchFilesTool,
  terminalShellTool,
  developerShellTool,
} from '../src/tools/index';
import { reviewSettings } from '../src/tools/helper';

// ---------------------------------------------------------------------------
// Type helpers
// ---------------------------------------------------------------------------

/** Strips `void` and Mastra's `ValidationError<unknown>` from a tool result union,
 *  leaving only the real output type. Throws if the result is missing or invalid. */
function assertResult<T extends object>(
  result: T | void | { error: unknown },
): T {
  expect(result).toBeDefined();
  expect(result).not.toBeNull();
  // ValidationError objects have an `error: true` flag set by Mastra
  if (result && typeof result === 'object' && 'error' in result && (result as any).message?.includes('Tool output validation failed')) {
    throw new Error(`Tool returned a validation error: ${JSON.stringify(result)}`);
  }
  return result as T;
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

const TEST_DIR = path.resolve(process.cwd(), 'temp_test_dir');

describe('Agent Tools Tests', () => {
  beforeEach(() => {
    if (!fs.existsSync(TEST_DIR)) {
      fs.mkdirSync(TEST_DIR, { recursive: true });
    }
    reviewSettings.requireReviewForWrites = false;
    reviewSettings.requireReviewForCommands = false;
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  // 1. read_file
  describe('readFileTool', () => {
    it('should read file content successfully', async () => {
      const filePath = path.join(TEST_DIR, 'test-read.txt');
      fs.writeFileSync(filePath, 'hello file content', 'utf8');

      const relativePath = path.relative(process.cwd(), filePath);
      const raw = await readFileTool.execute!({ path: relativePath }, {} as any);
      const result = assertResult<{ success: boolean; content?: string; error?: string }>(raw);

      expect(result.success).toBe(true);
      expect(result.content).toBe('hello file content');
    });

    it('should return error if file does not exist', async () => {
      const raw = await readFileTool.execute!({ path: 'non-existent-file.txt' }, {} as any);
      const result = assertResult<{ success: boolean; error?: string }>(raw);

      expect(result.success).toBe(false);
      expect(result.error).toContain('File not found');
    });
  });

  // 2. write_file
  describe('writeFileTool', () => {
    it('should write file content successfully when review is disabled', async () => {
      const filePath = path.join(TEST_DIR, 'test-write.txt');
      const relativePath = path.relative(process.cwd(), filePath);

      const raw = await writeFileTool.execute!({ path: relativePath, content: 'hello write' }, {} as any);
      const result = assertResult<{ success: boolean; error?: string }>(raw);

      expect(result.success).toBe(true);
      expect(fs.readFileSync(filePath, 'utf8')).toBe('hello write');
    });

    it('should call suspend with correct payload when review is required', async () => {
      reviewSettings.requireReviewForWrites = true;
      const filePath = path.join(TEST_DIR, 'test-write-suspend.txt');
      const relativePath = path.relative(process.cwd(), filePath);

      const suspendMock = vi.fn().mockReturnValue(undefined);
      const context = {
        agent: { suspend: suspendMock, resumeData: undefined },
      } as any;

      await writeFileTool.execute!({ path: relativePath, content: 'suspend write' }, context);

      expect(suspendMock).toHaveBeenCalledTimes(1);
      expect(suspendMock.mock.calls[0][0]).toEqual({
        path: relativePath,
        content: 'suspend write',
        type: 'write',
      });
      // suspend() throws internally in Mastra; we just verify it was invoked correctly
    });

    it('should write file successfully when resumed and approved', async () => {
      reviewSettings.requireReviewForWrites = true;
      const filePath = path.join(TEST_DIR, 'test-write-resume.txt');
      const relativePath = path.relative(process.cwd(), filePath);

      const context = {
        agent: { resumeData: { approved: true } },
      } as any;

      const raw = await writeFileTool.execute!({ path: relativePath, content: 'resume write' }, context);
      const result = assertResult<{ success: boolean; error?: string }>(raw);

      expect(result.success).toBe(true);
      expect(fs.readFileSync(filePath, 'utf8')).toBe('resume write');
    });

    it('should fail when resumed and rejected', async () => {
      reviewSettings.requireReviewForWrites = true;
      const filePath = path.join(TEST_DIR, 'test-write-reject.txt');
      const relativePath = path.relative(process.cwd(), filePath);

      const context = {
        agent: { resumeData: { approved: false } },
      } as any;

      const raw = await writeFileTool.execute!({ path: relativePath, content: 'resume write' }, context);
      const result = assertResult<{ success: boolean; error?: string }>(raw);

      expect(result.success).toBe(false);
      expect(result.error).toContain('rejected');
      expect(fs.existsSync(filePath)).toBe(false);
    });
  });

  // 3. patch_file
  describe('patchFileTool', () => {
    it('should patch file content successfully', async () => {
      const filePath = path.join(TEST_DIR, 'test-patch.txt');
      fs.writeFileSync(filePath, 'foo\nbar\nbaz', 'utf8');
      const relativePath = path.relative(process.cwd(), filePath);

      const raw = await patchFileTool.execute!(
        { path: relativePath, search: 'bar', replace: 'qux' },
        {} as any,
      );
      const result = assertResult<{ success: boolean; error?: string }>(raw);

      expect(result.success).toBe(true);
      expect(fs.readFileSync(filePath, 'utf8')).toBe('foo\nqux\nbaz');
    });

    it('should fail if search block is not found', async () => {
      const filePath = path.join(TEST_DIR, 'test-patch-fail.txt');
      fs.writeFileSync(filePath, 'foo\nbar\nbaz', 'utf8');
      const relativePath = path.relative(process.cwd(), filePath);

      const raw = await patchFileTool.execute!(
        { path: relativePath, search: 'not-in-file', replace: 'qux' },
        {} as any,
      );
      const result = assertResult<{ success: boolean; error?: string }>(raw);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Search block not found');
    });
  });

  // 4. exec_command
  describe('execCommandTool', () => {
    it('should call suspend with correct payload when no resumeData', async () => {
      const suspendMock = vi.fn().mockReturnValue(undefined);
      const context = {
        agent: { suspend: suspendMock, resumeData: undefined },
      } as any;

      await execCommandTool.execute!(
        { command: 'npm test', explanation: 'run tests' },
        context,
      );

      expect(suspendMock).toHaveBeenCalledTimes(1);
      expect(suspendMock.mock.calls[0][0]).toEqual({
        command: 'npm test',
        explanation: 'run tests',
        type: 'command',
      });
      // suspend() throws internally in Mastra; we just verify it was invoked correctly
    });

    it('should return success when resumed with exit code 0', async () => {
      const context = {
        agent: {
          resumeData: { approved: true, exitCode: 0, stdout: 'passed', stderr: '' },
        },
      } as any;

      const raw = await execCommandTool.execute!(
        { command: 'npm test', explanation: 'run tests' },
        context,
      );
      const result = assertResult<{
        success: boolean;
        stdout?: string;
        stderr?: string;
        exitCode?: number;
        error?: string;
      }>(raw);

      expect(result.success).toBe(true);
      expect(result.stdout).toBe('passed');
      expect(result.exitCode).toBe(0);
    });
  });

  // 5. glob
  describe('globTool', () => {
    it('should find files matching the pattern', async () => {
      fs.writeFileSync(path.join(TEST_DIR, 'glob-1.txt'), 'test1');
      fs.writeFileSync(path.join(TEST_DIR, 'glob-2.log'), 'test2');
      fs.writeFileSync(path.join(TEST_DIR, 'glob-3.txt'), 'test3');

      const relativeTestDir = path.relative(process.cwd(), TEST_DIR);
      const raw = await globTool.execute!({ pattern: '*.txt', path: relativeTestDir }, {} as any);
      const result = assertResult<{ success: boolean; files?: string[]; error?: string }>(raw);

      expect(result.success).toBe(true);
      expect(result.files).toContain('glob-1.txt');
      expect(result.files).toContain('glob-3.txt');
      expect(result.files).not.toContain('glob-2.log');
    });
  });

  // 6. web_fetch
  describe('webFetchTool', () => {
    it('should strip script tags and convert HTML to markdown', async () => {
      const mockHtml =
        '<html><body><h1>Header</h1><p>Paragraph <script>console.log(1)</script></p></body></html>';
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => mockHtml,
      }) as any;

      const raw = await webFetchTool.execute!(
        { url: 'https://example.com', format: 'markdown' },
        {} as any,
      );
      const result = assertResult<{ success: boolean; content?: string; error?: string }>(raw);

      expect(result.success).toBe(true);
      expect(result.content).toContain('# Header');
      expect(result.content).toContain('Paragraph');
      expect(result.content).not.toContain('console.log(1)');
    });
  });

  // 7. ask_user
  describe('askUserTool', () => {
    it('should call suspend with correct payload when no resumeData', async () => {
      const suspendMock = vi.fn().mockReturnValue(undefined);
      const context = {
        agent: { suspend: suspendMock, resumeData: undefined },
      } as any;

      await askUserTool.execute!({ question: 'Is this correct?' }, context);

      expect(suspendMock).toHaveBeenCalledTimes(1);
      expect(suspendMock.mock.calls[0][0]).toEqual({
        question: 'Is this correct?',
        type: 'question',
      });
      // suspend() throws internally in Mastra; we just verify it was invoked correctly
    });

    it('should return answer when resumed and approved', async () => {
      const context = {
        agent: { resumeData: { approved: true, answer: 'Yes it is' } },
      } as any;

      const raw = await askUserTool.execute!({ question: 'Is this correct?' }, context);
      const result = assertResult<{ success: boolean; answer?: string; error?: string }>(raw);

      expect(result.success).toBe(true);
      expect(result.answer).toBe('Yes it is');
    });
  });

  // 8. grep_search
  describe('grepSearchTool', () => {
    it('should find matching lines in files recursively', async () => {
      fs.writeFileSync(path.join(TEST_DIR, 'grep-1.txt'), 'target keyword is here');
      fs.writeFileSync(path.join(TEST_DIR, 'grep-2.txt'), 'nothing here');

      const relativeTestDir = path.relative(process.cwd(), TEST_DIR);
      const raw = await grepSearchTool.execute!(
        { pattern: 'target keyword', path: relativeTestDir },
        {} as any,
      );
      const result = assertResult<{
        success: boolean;
        output?: string;
        title?: string;
        metadata?: { matches: number; truncated: boolean };
        error?: string;
      }>(raw);

      expect(result.success).toBe(true);
      expect(result.output).toContain('grep-1.txt');
      expect(result.output).toContain('Line 1: target keyword is here');
      expect(result.output).not.toContain('grep-2.txt');
    });
  });

  // 9. list_directory
  describe('listDirTool', () => {
    it('should list files and subdirectories', async () => {
      fs.writeFileSync(path.join(TEST_DIR, 'file1.txt'), 'data');
      fs.mkdirSync(path.join(TEST_DIR, 'subdir1'));

      const relativeTestDir = path.relative(process.cwd(), TEST_DIR);
      const raw = await listDirTool.execute!({ path: relativeTestDir }, {} as any);
      const result = assertResult<{
        success: boolean;
        files?: Array<{ name: string; isDir: boolean; size?: number }>;
        error?: string;
      }>(raw);

      expect(result.success).toBe(true);
      const fileNames = result.files?.map((f) => f.name);
      expect(fileNames).toContain('file1.txt');
      expect(fileNames).toContain('subdir1');

      const subdir = result.files?.find((f) => f.name === 'subdir1');
      expect(subdir?.isDir).toBe(true);
    });
  });

  // 10. search_files
  describe('searchFilesTool', () => {
    it('should search files by name fragment', async () => {
      fs.writeFileSync(path.join(TEST_DIR, 'my-special-name.txt'), 'data');
      fs.writeFileSync(path.join(TEST_DIR, 'other-name.txt'), 'data');

      const relativeTestDir = path.relative(process.cwd(), TEST_DIR);
      const raw = await searchFilesTool.execute!(
        { query: 'special-name', path: relativeTestDir },
        {} as any,
      );
      const result = assertResult<{ success: boolean; files?: string[]; error?: string }>(raw);

      expect(result.success).toBe(true);
      expect(result.files).toContain('my-special-name.txt');
      expect(result.files).not.toContain('other-name.txt');
    });
  });

  // 11 & 12. terminalShellTool & developerShellTool
  describe('Shell Tools (terminal & developer)', () => {
    it('terminalShellTool — should call suspend with workdir-prefixed command on win32', async () => {
      const suspendMock = vi.fn().mockReturnValue(undefined);
      const context = {
        agent: { suspend: suspendMock, resumeData: undefined },
      } as any;

      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

      await terminalShellTool.execute!(
        { command: 'dir', explanation: 'List files in projects directory', workdir: 'C:\\projects' },
        context,
      );

      expect(suspendMock).toHaveBeenCalledTimes(1);
      expect(suspendMock.mock.calls[0][0]).toEqual({
        command: 'Set-Location -LiteralPath "C:\\projects"; if ($?) { dir }',
        explanation: 'List files in projects directory',
        timeout: 120000,
        type: 'command',
      });
      // suspend() throws internally in Mastra; we just verify it was invoked correctly
    });

    it('developerShellTool — should return success when resumed with exit code 0', async () => {
      const context = {
        agent: {
          resumeData: { approved: true, exitCode: 0, stdout: 'files', stderr: '' },
        },
      } as any;

      const raw = await developerShellTool.execute!({ command: 'ls', explanation: 'List directory contents' }, context);
      const result = assertResult<{
        success: boolean;
        stdout?: string;
        stderr?: string;
        exitCode?: number;
        error?: string;
      }>(raw);

      expect(result.success).toBe(true);
      expect(result.stdout).toBe('files');
      expect(result.exitCode).toBe(0);
    });
  });
});
