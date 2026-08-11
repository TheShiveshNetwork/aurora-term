/**
 * Slash-command support tests
 *
 * Verifies the filesystem helpers backing the `/skills`, `/mcp` and `/file`
 * slash commands: skill discovery, MCP server enumeration, and the FILE CONTEXT
 * metadata+preview builder used to inject file context into agent prompts.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  listSkills,
  listMcps,
  parseFileContext,
  formatFileContexts,
} from '../src/slash';

const PROJECT_DIR = path.resolve(process.cwd(), 'temp_slash_test_dir');

describe('Slash-command support module', () => {
  beforeEach(() => {
    fs.rmSync(PROJECT_DIR, { recursive: true, force: true });
    fs.mkdirSync(PROJECT_DIR, { recursive: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(PROJECT_DIR, { recursive: true, force: true });
    } catch {
      // Ignore EPERM on Windows
    }
  });

  describe('listSkills', () => {
    it('discovers project skills with SKILL.md from .agents/skills', () => {
      const skillDir = path.join(PROJECT_DIR, '.agents', 'skills', 'my-skill');
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\ndescription: "Does a thing"\n---\n# My Skill\n', 'utf8');

      const result = listSkills(PROJECT_DIR);
      expect(result.project).toHaveLength(1);
      expect(result.project[0].name).toBe('my-skill');
      expect(result.project[0].source).toBe('project');
      expect(result.project[0].description).toBe('Does a thing');
    });

    it('ignores directories without a SKILL.md', () => {
      const emptyDir = path.join(PROJECT_DIR, '.agents', 'skills', 'not-a-skill');
      fs.mkdirSync(emptyDir, { recursive: true });

      const result = listSkills(PROJECT_DIR);
      expect(result.project).toHaveLength(0);
    });

    it('discovers skills from .claude/skills too', () => {
      const skillDir = path.join(PROJECT_DIR, '.claude', 'skills', 'claude-skill');
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Claude Skill\n', 'utf8');

      const result = listSkills(PROJECT_DIR);
      const names = result.project.map((s) => s.name);
      expect(names).toContain('claude-skill');
    });

    it('falls back to the first H1 heading for description when frontmatter is missing', () => {
      const skillDir = path.join(PROJECT_DIR, '.agents', 'skills', 'heading-skill');
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Heading Skill\n\nSome body.\n', 'utf8');

      const result = listSkills(PROJECT_DIR);
      expect(result.project[0].description).toBe('Heading Skill');
    });
  });

  describe('listMcps', () => {
    it('reads stdio servers from .agents/mcp_config.json', () => {
      fs.mkdirSync(path.join(PROJECT_DIR, '.agents'), { recursive: true });
      fs.writeFileSync(
        path.join(PROJECT_DIR, '.agents', 'mcp_config.json'),
        JSON.stringify({
          mcpServers: {
            filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'] },
          },
        }),
        'utf8'
      );

      const result = listMcps(PROJECT_DIR);
      expect(result.project).toHaveLength(1);
      expect(result.project[0].name).toBe('filesystem');
      expect(result.project[0].type).toBe('stdio');
      expect(result.project[0].command).toBe('npx');
      expect(result.project[0].source).toBe('project');
    });

    it('reads HTTP servers from .mcp.json with a url', () => {
      fs.writeFileSync(
        path.join(PROJECT_DIR, '.mcp.json'),
        JSON.stringify({
          mcpServers: {
            remote: { type: 'http', url: 'https://example.com/mcp' },
          },
        }),
        'utf8'
      );

      const result = listMcps(PROJECT_DIR);
      expect(result.project).toHaveLength(1);
      expect(result.project[0].name).toBe('remote');
      expect(result.project[0].type).toBe('http');
      expect(result.project[0].url).toBe('https://example.com/mcp');
    });

    it('returns empty lists when no config files exist', () => {
      const result = listMcps(PROJECT_DIR);
      expect(result.project).toHaveLength(0);
      expect(result.global).toBeDefined();
    });
  });

  describe('parseFileContext', () => {
    it('builds metadata and preview for a text file', () => {
      const file = path.join(PROJECT_DIR, 'sample.ts');
      fs.writeFileSync(file, 'export const x = 1;\n', 'utf8');

      const ctx = parseFileContext(file);
      expect(ctx).not.toBeNull();
      expect(ctx!.name).toBe('sample.ts');
      expect(ctx!.language).toBe('TypeScript');
      expect(ctx!.size).toBeGreaterThan(0);
      expect(ctx!.preview).toContain('export const x = 1;');
      expect(ctx!.path).toBe(file);
    });

    it('truncates previews beyond the preview character budget', () => {
      const file = path.join(PROJECT_DIR, 'big.txt');
      fs.writeFileSync(file, 'a'.repeat(2000), 'utf8');

      const ctx = parseFileContext(file, { previewChars: 100 });
      expect(ctx!.preview.length).toBeLessThan(150);
      expect(ctx!.preview).toContain('[truncated]');
    });

    it('returns null for a missing file', () => {
      const ctx = parseFileContext(path.join(PROJECT_DIR, 'missing.txt'));
      expect(ctx).toBeNull();
    });

    it('returns null for a directory', () => {
      const dir = path.join(PROJECT_DIR, 'subdir');
      fs.mkdirSync(dir, { recursive: true });
      const ctx = parseFileContext(dir);
      expect(ctx).toBeNull();
    });

    it('resolves relative paths against the cwd', () => {
      const file = path.join(PROJECT_DIR, 'rel.txt');
      fs.writeFileSync(file, 'hello', 'utf8');

      const prevCwd = process.cwd();
      process.chdir(PROJECT_DIR);
      try {
        const ctx = parseFileContext('rel.txt');
        expect(ctx).not.toBeNull();
        expect(ctx!.name).toBe('rel.txt');
      } finally {
        process.chdir(prevCwd);
      }
    });
  });

  describe('formatFileContexts', () => {
    it('returns empty string for no contexts', () => {
      expect(formatFileContexts([])).toBe('');
    });

    it('renders a FILE CONTEXT block with metadata and preview', () => {
      const file = path.join(PROJECT_DIR, 'a.ts');
      fs.writeFileSync(file, 'export const a = 1;\n', 'utf8');
      const ctx = parseFileContext(file);
      const block = formatFileContexts([ctx!]);
      expect(block).toContain('[FILE CONTEXT]');
      expect(block).toContain('[/FILE CONTEXT]');
      expect(block).toContain('a.ts');
      expect(block).toContain('use read_file to inspect full contents');
    });
  });
});
