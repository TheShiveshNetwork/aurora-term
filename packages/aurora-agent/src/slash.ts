export type SlashCommandId = '/btw' | '/file' | '/skills' | '/mcp';

export interface SlashCommandConfig {
  id: SlashCommandId;
  description: string;
  usage: string;
}

// /btw → frontend agentSlash.ts → /api/btw · /file → /api/file/context
// (/agents/shared/file-context.ts) · /skills → /api/skills · /mcp → /api/mcp
// (logic: slash-resources.ts)
export const SLASH_COMMANDS: readonly SlashCommandConfig[] = [
  { id: '/btw', description: 'Ask a side question while a task runs', usage: '/btw <message>' },
  { id: '/file', description: 'Attach open-editor file context to the current task', usage: '/file <path...>' },
  { id: '/skills', description: 'List available agent skills', usage: '/skills' },
  { id: '/mcp', description: 'List configured MCP servers', usage: '/mcp' },
];

export { listSkills } from './slash-resources';
export type { SkillInfo } from './slash-resources';
