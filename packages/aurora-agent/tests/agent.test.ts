/**
 * Terminal Agent Integration Tests
 *
 * These tests verify that the terminalAgent:
 *  - suspends for every shell command and asks for approval
 *  - resumes correctly when approved/rejected
 *  - passes the right workdir, command, and timeout to the suspend payload
 *
 * We do NOT hit a real LLM — we exercise the underlying tool layer directly
 * (terminalShellTool, listDirTool, readFileTool, etc.) with synthetic inputs
 * that mimic what the model would produce.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { terminalShellTool } from '../src/tools/shell';
import {
  listDirTool,
  readFileTool,
  grepSearchTool,
  globTool,
  searchFilesTool,
  execCommandTool,
} from '../src/tools/index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assertResult<T extends object>(result: T | void | { error: unknown }): T {
  expect(result).toBeDefined();
  if (
    result &&
    typeof result === 'object' &&
    'error' in result &&
    (result as any).message?.includes('Tool output validation failed')
  ) {
    throw new Error(`Tool returned a validation error: ${JSON.stringify(result)}`);
  }
  return result as T;
}

const TEST_DIR = path.resolve(process.cwd(), 'temp_agent_test_dir');

describe('Terminal Agent — Tool Behaviour', () => {
  beforeEach(() => {
    if (!fs.existsSync(TEST_DIR)) {
      fs.mkdirSync(TEST_DIR, { recursive: true });
    }
    // Seed some files for realistic scenarios
    fs.writeFileSync(path.join(TEST_DIR, 'README.md'), '# My Project\nWelcome!', 'utf8');
    fs.writeFileSync(path.join(TEST_DIR, 'index.ts'), 'export const greet = () => "hello";', 'utf8');
    fs.writeFileSync(path.join(TEST_DIR, 'config.json'), '{"version":"1.0.0","name":"aurora"}', 'utf8');
    fs.mkdirSync(path.join(TEST_DIR, 'src'), { recursive: true });
    fs.writeFileSync(path.join(TEST_DIR, 'src', 'main.ts'), 'import "./index";', 'utf8');
    fs.mkdirSync(path.join(TEST_DIR, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(TEST_DIR, 'dist', 'bundle.js'), '// compiled', 'utf8');
  });

  afterEach(() => {
    // Restore platform property so it doesn't bleed into subsequent tests
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    vi.restoreAllMocks();
    // Best-effort cleanup — Windows may hold handles open briefly after file ops
    try {
      if (fs.existsSync(TEST_DIR)) {
        fs.rmSync(TEST_DIR, { recursive: true, force: true });
      }
    } catch {
      // Ignore EPERM on Windows; OS will clean up when handles are released
    }
  });

  // ── Shell tool scenarios ─────────────────────────────────────────────────

  describe('shell_terminal tool', () => {
    it('should suspend with "Get-ChildItem" for "list all files"', async () => {
      const suspendMock = vi.fn().mockReturnValue(undefined);
      const context = { agent: { suspend: suspendMock, resumeData: undefined } } as any;

      await terminalShellTool.execute!({ command: 'Get-ChildItem', explanation: 'List all files in directory', timeout: 30000 }, context);

      expect(suspendMock).toHaveBeenCalledTimes(1);
      expect(suspendMock.mock.calls[0][0]).toMatchObject({
        command: 'Get-ChildItem',
        type: 'command',
      });
    });

    it('should suspend with correct workdir-prefixed command on win32', async () => {
      const suspendMock = vi.fn().mockReturnValue(undefined);
      const context = { agent: { suspend: suspendMock, resumeData: undefined } } as any;

      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

      await terminalShellTool.execute!(
        { command: 'Get-ChildItem -Recurse', explanation: 'Recursively list all files in the project directory', workdir: 'D:\\builds\\aurora', timeout: 30000 },
        context,
      );

      expect(suspendMock).toHaveBeenCalledTimes(1);
      const payload = suspendMock.mock.calls[0][0];
      expect(payload.command).toBe(
        'Set-Location -LiteralPath "D:\\builds\\aurora"; if ($?) { Get-ChildItem -Recurse }',
      );
      expect(payload.type).toBe('command');
      expect(payload.timeout).toBe(30000);
    });

    it('should include timeout in suspend payload', async () => {
      const suspendMock = vi.fn().mockReturnValue(undefined);
      const context = { agent: { suspend: suspendMock, resumeData: undefined } } as any;

      await terminalShellTool.execute!(
        { command: 'pnpm test', explanation: 'Run tests with pnpm', timeout: 60000 },
        context,
      );

      const payload = suspendMock.mock.calls[0][0];
      expect(payload.timeout).toBe(60000);
    });

    it('should return success after approval with exit code 0', async () => {
      const context = {
        agent: {
          resumeData: { approved: true, exitCode: 0, stdout: 'file1.txt  file2.txt', stderr: '' },
        },
      } as any;

      const raw = await terminalShellTool.execute!({ command: 'Get-ChildItem', explanation: 'List all files in directory', timeout: 30000 }, context);
      const result = assertResult<{ success: boolean; stdout?: string; exitCode?: number }>(raw);

      expect(result.success).toBe(true);
      expect(result.stdout).toBe('file1.txt  file2.txt');
      expect(result.exitCode).toBe(0);
    });

    it('should return failure after approval with non-zero exit code', async () => {
      const context = {
        agent: {
          resumeData: {
            approved: true,
            exitCode: 1,
            stdout: '',
            stderr: 'Access denied',
          },
        },
      } as any;

      const raw = await terminalShellTool.execute!({ command: 'Remove-Item -Force secret.txt', explanation: 'Force remove a file named secret.txt', timeout: 30000 }, context);
      const result = assertResult<{ success: boolean; stderr?: string; exitCode?: number }>(raw);

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
    });

    it('should return error when user rejects the command', async () => {
      const context = {
        agent: {
          resumeData: { approved: false, stdout: '', stderr: '', exitCode: -1 },
        },
      } as any;

      const raw = await terminalShellTool.execute!({ command: 'rm -rf /', explanation: 'Recursively force remove root filesystem', timeout: 30000 }, context);
      const result = assertResult<{ success: boolean; error?: string }>(raw);

      expect(result.success).toBe(false);
      expect(result.error).toContain('rejected');
    });

    it('should use bash workdir syntax on linux/mac', async () => {
      const suspendMock = vi.fn().mockReturnValue(undefined);
      const context = { agent: { suspend: suspendMock, resumeData: undefined } } as any;

      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

      await terminalShellTool.execute!(
        { command: 'ls -la', explanation: 'List all files with details in the project directory', workdir: '/home/user/project', timeout: 30000 },
        context,
      );

      const payload = suspendMock.mock.calls[0][0];
      expect(payload.command).toBe('cd "/home/user/project" && ls -la');
    });
  });

  // ── list_directory scenarios ──────────────────────────────────────────────

  describe('list_directory tool (used for "show me what files are here")', () => {
    it('should list all files and dirs in a directory', async () => {
      const relativeTestDir = path.relative(process.cwd(), TEST_DIR);
      const raw = await listDirTool.execute!({ path: relativeTestDir }, {} as any);
      const result = assertResult<{
        success: boolean;
        files?: Array<{ name: string; isDir: boolean; size?: number }>;
      }>(raw);

      expect(result.success).toBe(true);
      const names = result.files?.map((f) => f.name) ?? [];
      expect(names).toContain('README.md');
      expect(names).toContain('index.ts');
      expect(names).toContain('config.json');
      expect(names).toContain('src');
      expect(names).toContain('dist');
    });

    it('should mark directories with isDir=true', async () => {
      const relativeTestDir = path.relative(process.cwd(), TEST_DIR);
      const raw = await listDirTool.execute!({ path: relativeTestDir }, {} as any);
      const result = assertResult<{
        success: boolean;
        files?: Array<{ name: string; isDir: boolean }>;
      }>(raw);

      const src = result.files?.find((f) => f.name === 'src');
      const readme = result.files?.find((f) => f.name === 'README.md');
      expect(src?.isDir).toBe(true);
      expect(readme?.isDir).toBe(false);
    });

    it('should return error for non-existent path', async () => {
      const raw = await listDirTool.execute!({ path: 'definitely/does/not/exist' }, {} as any);
      const result = assertResult<{ success: boolean; error?: string }>(raw);
      expect(result.success).toBe(false);
    });
  });

  // ── read_file scenarios ───────────────────────────────────────────────────

  describe('read_file tool (used for "show me the contents of X")', () => {
    it('should read README.md successfully', async () => {
      const relPath = path.relative(process.cwd(), path.join(TEST_DIR, 'README.md'));
      const raw = await readFileTool.execute!({ path: relPath }, {} as any);
      const result = assertResult<{ success: boolean; content?: string }>(raw);

      expect(result.success).toBe(true);
      expect(result.content).toContain('# My Project');
      expect(result.content).toContain('Welcome!');
    });

    it('should read a JSON config file', async () => {
      const relPath = path.relative(process.cwd(), path.join(TEST_DIR, 'config.json'));
      const raw = await readFileTool.execute!({ path: relPath }, {} as any);
      const result = assertResult<{ success: boolean; content?: string }>(raw);

      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.content ?? '{}');
      expect(parsed.version).toBe('1.0.0');
      expect(parsed.name).toBe('aurora');
    });

    it('should read nested src/main.ts', async () => {
      const relPath = path.relative(process.cwd(), path.join(TEST_DIR, 'src', 'main.ts'));
      const raw = await readFileTool.execute!({ path: relPath }, {} as any);
      const result = assertResult<{ success: boolean; content?: string }>(raw);

      expect(result.success).toBe(true);
      expect(result.content).toContain('import "./index"');
    });
  });

  // ── grep_search scenarios ─────────────────────────────────────────────────

  describe('grep_search tool (used for "find all usages of X")', () => {
    it('should find "greet" function across ts files', async () => {
      const relativeTestDir = path.relative(process.cwd(), TEST_DIR);
      const raw = await grepSearchTool.execute!(
        { pattern: 'greet', path: relativeTestDir },
        {} as any,
      );
      const result = assertResult<{ success: boolean; output?: string }>(raw);

      expect(result.success).toBe(true);
      expect(result.output).toContain('index.ts');
      expect(result.output).toContain('greet');
    });

    it('should find version string in config.json', async () => {
      const relativeTestDir = path.relative(process.cwd(), TEST_DIR);
      const raw = await grepSearchTool.execute!(
        { pattern: '"version"', path: relativeTestDir },
        {} as any,
      );
      const result = assertResult<{ success: boolean; output?: string }>(raw);

      expect(result.success).toBe(true);
      expect(result.output).toContain('config.json');
    });

    it('should return no matches for non-existent pattern', async () => {
      const relativeTestDir = path.relative(process.cwd(), TEST_DIR);
      const raw = await grepSearchTool.execute!(
        { pattern: 'xyz_pattern_that_does_not_exist_12345', path: relativeTestDir },
        {} as any,
      );
      const result = assertResult<{ success: boolean; output?: string }>(raw);

      // No match is success with empty/no output
      expect(result.success).toBe(true);
    });
  });

  // ── glob scenarios ────────────────────────────────────────────────────────

  describe('glob tool (used for "find all TypeScript files")', () => {
    it('should glob .ts files in the root of the test dir', async () => {
      const relativeTestDir = path.relative(process.cwd(), TEST_DIR);
      const raw = await globTool.execute!(
        { pattern: '*.ts', path: relativeTestDir },
        {} as any,
      );
      const result = assertResult<{ success: boolean; files?: string[] }>(raw);

      expect(result.success).toBe(true);
      // index.ts is in the root — should be found
      expect(result.files).toContain('index.ts');
      // main.ts is in src/ subdirectory — not in root glob
      expect(result.files).not.toContain('bundle.js');
    });

    it('should glob .ts files in src/ subdirectory', async () => {
      const relSrcDir = path.relative(process.cwd(), path.join(TEST_DIR, 'src'));
      const raw = await globTool.execute!(
        { pattern: '*.ts', path: relSrcDir },
        {} as any,
      );
      const result = assertResult<{ success: boolean; files?: string[] }>(raw);

      expect(result.success).toBe(true);
      expect(result.files).toContain('main.ts');
    });

    it('should glob only .json files', async () => {
      const relativeTestDir = path.relative(process.cwd(), TEST_DIR);
      const raw = await globTool.execute!(
        { pattern: '*.json', path: relativeTestDir },
        {} as any,
      );
      const result = assertResult<{ success: boolean; files?: string[] }>(raw);

      expect(result.success).toBe(true);
      expect(result.files).toContain('config.json');
      expect(result.files?.some((f) => f.endsWith('.ts'))).toBe(false);
    });

    it('should glob all js files in dist/', async () => {
      const relDistDir = path.relative(process.cwd(), path.join(TEST_DIR, 'dist'));
      const raw = await globTool.execute!(
        { pattern: '*.js', path: relDistDir },
        {} as any,
      );
      const result = assertResult<{ success: boolean; files?: string[] }>(raw);

      expect(result.success).toBe(true);
      expect(result.files).toContain('bundle.js');
    });
  });

  // ── search_files scenarios ────────────────────────────────────────────────

  describe('search_files tool (used for "find the file named X")', () => {
    it('should find config.json by name fragment', async () => {
      const relativeTestDir = path.relative(process.cwd(), TEST_DIR);
      const raw = await searchFilesTool.execute!(
        { query: 'config', path: relativeTestDir },
        {} as any,
      );
      const result = assertResult<{ success: boolean; files?: string[] }>(raw);

      expect(result.success).toBe(true);
      expect(result.files?.some((f) => f.includes('config.json'))).toBe(true);
    });

    it('should find README.md by name', async () => {
      const relativeTestDir = path.relative(process.cwd(), TEST_DIR);
      const raw = await searchFilesTool.execute!(
        { query: 'README', path: relativeTestDir },
        {} as any,
      );
      const result = assertResult<{ success: boolean; files?: string[] }>(raw);

      expect(result.success).toBe(true);
      expect(result.files?.some((f) => f.includes('README.md'))).toBe(true);
    });
  });

  // ── exec_command scenarios ────────────────────────────────────────────────

  describe('exec_command tool (used for "run this command and tell me the result")', () => {
    it('should always suspend for user approval', async () => {
      const suspendMock = vi.fn().mockReturnValue(undefined);
      const context = { agent: { suspend: suspendMock, resumeData: undefined } } as any;

      await execCommandTool.execute!(
        { command: 'pnpm build', explanation: 'Build the project' },
        context,
      );

      expect(suspendMock).toHaveBeenCalledTimes(1);
      expect(suspendMock.mock.calls[0][0]).toMatchObject({
        command: 'pnpm build',
        type: 'command',
      });
    });

    it('should handle successful build command (exit 0)', async () => {
      const context = {
        agent: {
          resumeData: {
            approved: true,
            exitCode: 0,
            stdout: '> aurora build\nDone in 3.2s',
            stderr: '',
          },
        },
      } as any;

      const raw = await execCommandTool.execute!(
        { command: 'pnpm build', explanation: 'Build the project' },
        context,
      );
      const result = assertResult<{ success: boolean; stdout?: string; exitCode?: number }>(raw);

      expect(result.success).toBe(true);
      expect(result.stdout).toContain('Done in 3.2s');
    });

    it('should report failure when build fails (exit 1)', async () => {
      const context = {
        agent: {
          resumeData: {
            approved: true,
            exitCode: 1,
            stdout: '',
            stderr: 'Error: Cannot find module ./missing',
          },
        },
      } as any;

      const raw = await execCommandTool.execute!(
        { command: 'pnpm build', explanation: 'Build the project' },
        context,
      );
      const result = assertResult<{
        success: boolean;
        stderr?: string;
        exitCode?: number;
      }>(raw);

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
    });
  });
});
