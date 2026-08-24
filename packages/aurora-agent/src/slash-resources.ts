import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Filesystem enumeration backing the /skills and /mcp slash commands.

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

const SKILL_DIR_NAMES = ['.agents/skills', '.claude/skills', '.opencode/skills'];

const GLOBAL_SKILL_DIRS = [
  path.join(os.homedir(), '.agents', 'skills'),
  path.join(os.homedir(), '.claude', 'skills'),
  path.join(os.homedir(), '.config', 'opencode', 'skills'),
];

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

// Minimal JSONC support so opencode-style .jsonc configs can be read.
function parseJsonc(raw: string): any {
  let src = raw;
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
  src = src.replace(/\/\*[\s\S]*?\*\//g, '');
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
