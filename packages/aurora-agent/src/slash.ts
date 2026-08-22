import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ─────────────────────────────────────────────────────────────────────────────
// Slash-command support module.
//
// Provides filesystem enumeration helpers for the `/skills` and `/mcp`
// slash commands. Skills are read from the standard agent skill locations
// (`<project>/.agents/skills`, `<project>/.claude/skills`, `<project>/.opencode/skills`,
// plus the matching global directories under the user home). MCP servers are read
// from the standard MCP config files (`<project>/.agents/mcp_config.json`,
// `<project>/.mcp.json`, opencode config, plus the matching global locations).
// ─────────────────────────────────────────────────────────────────────────────

export interface SkillInfo {
  name: string;
  path: string;
  source: 'project' | 'global';
  description?: string;
}

export interface McpInfo {
  name: string;
  type: string;
  command?: string;
  args?: string[];
  url?: string;
  description?: string;
  source: 'project' | 'global';
}

// ── Skills ────────────────────────────────────────────────────────────────

const SKILL_DIR_NAMES = ['.agents/skills', '.claude/skills', '.opencode/skills'];

const GLOBAL_SKILL_DIRS = [
  path.join(os.homedir(), '.agents', 'skills'),
  path.join(os.homedir(), '.claude', 'skills'),
  path.join(os.homedir(), '.config', 'opencode', 'skills'),
];

/**
 * Read the human-readable description of a skill. Prefers the `description:`
 * field in the SKILL.md frontmatter; falls back to the first H1 heading.
 */
function readSkillDescription(skillDir: string): string | undefined {
  const skillMd = path.join(skillDir, 'SKILL.md');
  if (!fs.existsSync(skillMd)) return undefined;
  try {
    const raw = fs.readFileSync(skillMd, 'utf8');
    const frontmatter = raw.match(/^---\n([\s\S]*?)\n---/);
    if (frontmatter) {
      const descMatch = frontmatter[1].match(/description:\s*["']?([^"'\n]+)/);
      if (descMatch) return descMatch[1].trim().replace(/["']+$/, '');
    }
    const heading = raw.split('\n').find((l) => l.startsWith('# '));
    return heading?.replace(/^#\s*/, '').trim();
  } catch {
    return undefined;
  }
}

function listSkillsIn(dir: string, source: 'project' | 'global'): SkillInfo[] {
  const out: SkillInfo[] = [];
  if (!fs.existsSync(dir)) return out;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillDir = path.join(dir, entry.name);
    // A directory only counts as a skill when it contains a SKILL.md file.
    if (!fs.existsSync(path.join(skillDir, 'SKILL.md'))) continue;
    out.push({
      name: entry.name,
      path: skillDir,
      source,
      description: readSkillDescription(skillDir),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function listSkills(cwd?: string): { project: SkillInfo[]; global: SkillInfo[] } {
  const root = cwd || process.cwd();
  const project: SkillInfo[] = [];
  const global: SkillInfo[] = [];
  for (const dirName of SKILL_DIR_NAMES) {
    project.push(...listSkillsIn(path.join(root, dirName), 'project'));
  }
  for (const dir of GLOBAL_SKILL_DIRS) {
    global.push(...listSkillsIn(dir, 'global'));
  }
  return { project, global };
}

// ── MCP ──────────────────────────────────────────────────────────────────

/**
 * Minimal JSONC parser — strips line comments, block comments and trailing
 * commas so we can read `.jsonc` config files (e.g. opencode configs).
 */
function parseJsonc(raw: string): any {
  let src = raw;
  // Strip line comments (careful with URLs containing // inside strings)
  const lines = src.split('\n');
  const cleaned: string[] = [];
  for (const line of lines) {
    let out = '';
    let inString = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inString) {
        out += ch;
        if (ch === '\\') {
          out += line[i + 1] ?? '';
          i++;
        } else if (ch === '"') {
          inString = false;
        }
      } else if (ch === '"') {
        inString = true;
        out += ch;
      } else if (ch === '/' && line[i + 1] === '/') {
        break;
      } else {
        out += ch;
      }
    }
    cleaned.push(out);
  }
  src = cleaned.join('\n');
  // Strip block comments
  src = src.replace(/\/\*[\s\S]*?\*\//g, '');
  // Strip trailing commas
  src = src.replace(/,\s*([}\]])/g, '$1');
  return JSON.parse(src);
}

function readMcpConfig(filePath: string): Record<string, any> | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    const isJsonc = filePath.toLowerCase().endsWith('.jsonc');
    const parsed = isJsonc ? parseJsonc(raw) : JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function extractMcpServers(cfg: Record<string, any> | null): Record<string, any> {
  if (!cfg) return {};
  if (cfg.mcpServers && typeof cfg.mcpServers === 'object') return cfg.mcpServers;
  if (cfg.mcp && typeof cfg.mcp === 'object') return cfg.mcp;
  return {};
}

function normalizeMcpEntry(name: string, raw: any, source: 'project' | 'global'): McpInfo {
  const type = typeof raw.type === 'string' ? raw.type : typeof raw.url === 'string' ? 'http' : 'stdio';
  return {
    name,
    type,
    command: typeof raw.command === 'string' ? raw.command : undefined,
    args: Array.isArray(raw.args) ? raw.args.map(String) : undefined,
    url: typeof raw.url === 'string' ? raw.url : undefined,
    description: typeof raw.description === 'string' ? raw.description : undefined,
    source,
  };
}

function listMcpsFrom(filePath: string, source: 'project' | 'global'): McpInfo[] {
  const cfg = readMcpConfig(filePath);
  const servers = extractMcpServers(cfg);
  return Object.entries(servers).map(([name, raw]) => normalizeMcpEntry(name, raw, source));
}

export function listMcps(cwd?: string): { project: McpInfo[]; global: McpInfo[] } {
  const root = cwd || process.cwd();
  const project: McpInfo[] = [];
  const global: McpInfo[] = [];

  project.push(...listMcpsFrom(path.join(root, '.agents', 'mcp_config.json'), 'project'));
  project.push(...listMcpsFrom(path.join(root, '.mcp.json'), 'project'));
  project.push(...listMcpsFrom(path.join(root, 'opencode.json'), 'project'));
  project.push(...listMcpsFrom(path.join(root, '.opencode', 'opencode.json'), 'project'));
  project.push(...listMcpsFrom(path.join(root, '.opencode', 'opencode.jsonc'), 'project'));

  global.push(...listMcpsFrom(path.join(os.homedir(), '.agents', 'mcp_config.json'), 'global'));
  global.push(...listMcpsFrom(path.join(os.homedir(), '.config', 'opencode', 'opencode.json'), 'global'));
  global.push(...listMcpsFrom(path.join(os.homedir(), '.config', 'opencode', 'opencode.jsonc'), 'global'));

  return { project, global };
}

// ─────────────────────────────────────────────────────────────────────────────
// FILE CONTEXT — metadata + preview for files relevant to the current task
//
// Used by the `/file` slash command. The full contents are intentionally NOT
// included (that would flood the context window); the agent must use the
// `read_file` tool to actually inspect a file when it needs the code.
// ─────────────────────────────────────────────────────────────────────────────

export interface FileContext {
  path: string;
  name: string;
  size: number;
  size_human: string;
  language?: string;
  preview: string;
}

const EXT_TO_LANGUAGE: Record<string, string> = {
  ts: 'TypeScript', tsx: 'TypeScript (React)', js: 'JavaScript', jsx: 'JavaScript (React)',
  mjs: 'JavaScript', cjs: 'JavaScript', rs: 'Rust', py: 'Python', go: 'Go',
  rb: 'Ruby', php: 'PHP', java: 'Java', kt: 'Kotlin', swift: 'Swift',
  c: 'C', h: 'C', cpp: 'C++', hpp: 'C++', cs: 'C#',
  json: 'JSON', jsonc: 'JSONC', toml: 'TOML', yaml: 'YAML', yml: 'YAML',
  md: 'Markdown', markdown: 'Markdown', css: 'CSS', scss: 'SCSS', html: 'HTML',
  sh: 'Shell', bash: 'Shell', zsh: 'Shell', ps1: 'PowerShell', bat: 'Batch',
  sql: 'SQL', xml: 'XML', vue: 'Vue', svelte: 'Svelte',
};

function detectLanguage(filePath: string): string | undefined {
  const ext = path.extname(filePath).replace(/^\./, '').toLowerCase();
  if (ext === 'nvmrc' || ext === 'node-version') return 'Node.js';
  return EXT_TO_LANGUAGE[ext];
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Build a `[FILE CONTEXT]` block for a file. Reads at most PREVIEW_CHARS bytes
 * of the head of the file as a preview; the rest is described by metadata.
 */
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
      language: detectLanguage(abs),
      preview,
    };
  } catch {
    return null;
  }
}

/**
 * Serialize one or more FileContext entries into a prompt-ready `[FILE CONTEXT]`
 * block that the agents are instructed to follow.
 */
export function formatFileContexts(contexts: FileContext[]): string {
  if (!contexts.length) return '';
  const parts = contexts.map((ctx) => {
    const lang = ctx.language ? ` (${ctx.language})` : '';
    return [
      `- ${ctx.path}${lang} — ${ctx.size_human}`,
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
    parts.join('\n'),
    '[/FILE CONTEXT]',
  ].join('\n');
}

/**
 * Build a `[SELECTED LINES]` block for a user's editor selection. Highlights the
 * exact line numbers and text the user has selected so the agent can target its
 * edits to those specific lines.
 */
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
