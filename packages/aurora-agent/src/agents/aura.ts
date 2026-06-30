import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';

// ── Model Provider Helper ─────────────────────────────────────────────────
export function getModelProvider(providerName: string, modelName?: string): {
  id: `${string}/${string}`;
  url?: string;
  apiKey?: string;
} {
  const normalized = providerName.toLowerCase();

  if (normalized === 'groq') {
    return {
      id: `groq/${modelName || 'llama-3.3-70b-versatile'}` as const,
      apiKey: process.env.GROQ_API_KEY,
    };
  }

  if (normalized === 'gpt-oss') {
    return {
      id: `openai/${modelName || 'gpt-4o-mini'}` as const,
      url: process.env.GPT_OSS_BASE_URL || 'http://localhost:11434/v1',
      apiKey: process.env.GPT_OSS_API_KEY || 'empty',
    };
  }

  if (normalized === 'kimi') {
    return {
      id: `openai/${modelName || 'kimi-k2'}` as const,
      url: 'https://api.moonshot.cn/v1',
      apiKey: process.env.KIMI_API_KEY || 'empty',
    };
  }

  // Fallback to Groq
  return {
    id: `groq/${modelName || 'llama-3.3-70b-versatile'}` as const,
    apiKey: process.env.GROQ_API_KEY,
  };
}

// ── Persistent memory storage ─────────────────────────────────────────────
// Shared LibSQLStore for both Mastra instance and agent memory persistence.
// Using file-based SQLite so memory survives server restarts.
export const memoryStorage = new LibSQLStore({
  id: 'aura-memory',
  url: 'file:./aura-memory.db',
});

// ── Shared memory store for Aura ──────────────────────────────────────────
// - lastMessages: 20 messages of conversation history per thread (session tab)
// - workingMemory: resource-scoped so user profile persists across ALL sessions
export const auraMemory = new Memory({
  storage: memoryStorage,
  options: {
    lastMessages: 20,
    workingMemory: {
      enabled: true,
      scope: 'resource',
      template: `# User Profile
- **Name**:
- **OS**:
- **Shell**:
- **Working Directory**:

# Preferences
- **Verbosity**: [concise | detailed]
- **Auto-approve commands**: [yes | no]
- **Preferred tools**:

# Session Notes
- **Frequent tasks**:
- **Known project context**:
- **Important paths**:
`,
    },
  },
});

// ── Subagents ─────────────────────────────────────────────────────────────
export const coderAgent = new Agent({
  id: 'coderAgent',
  name: 'Coder Agent',
  description: 'Writes and refactors shell commands and code snippets based on specification.',
  instructions: `You are a code specialist. Given a task, output the exact shell command needed.
Always respond ONLY with valid JSON: {"command": "<shell command>", "explanation": "<why>"}`,
  model: getModelProvider('groq', 'gemma2-9b-it'),
});

export const researcherAgent = new Agent({
  id: 'researcherAgent',
  name: 'Researcher Agent',
  description: 'Analyzes file structures, finds files, and reads documentation.',
  instructions: `You are a research specialist. Given a task, identify what information needs to be gathered.
Always respond ONLY with valid JSON: {"command": "<shell command to research>", "explanation": "<why>"}`,
  model: getModelProvider('groq', 'gemma2-9b-it'),
});

export const validatorAgent = new Agent({
  id: 'validatorAgent',
  name: 'Validator Agent',
  description: 'Validates outputs, runs diagnostics, checks build/test results.',
  instructions: `You are a validation specialist. Given command output, determine if the task succeeded.
Always respond ONLY with valid JSON: {"status": "success"|"failure", "reason": "<explanation>"}`,
  model: getModelProvider('groq', 'gemma2-9b-it'),
});

// ── Main Supervisor Agent (Aura) ──────────────────────────────────────────
// NOTE: Do NOT add an `agents` field here. Mastra v1 auto-registers subagents
// as LLM tools with a strict schema (threadId, resourceId, etc.) that causes
// tool_call_validation errors on Groq when the model passes incorrect params.
// Subagents are called programmatically in tasks.ts and test-flows.ts instead.
export const aura = new Agent({
  id: 'aura',
  name: 'Aura',
  instructions: `You are Aura, an intelligent AI terminal agent for Aurora Terminal.
You help users accomplish tasks by executing shell commands step by step on Windows (PowerShell).

CRITICAL RULES:
1. Respond ONLY with a single valid JSON object — no markdown, no prose, no code fences.
2. ONE command per response. Never output multiple commands at once.
3. For SOCIAL/GREETING inputs (hi, hello, hey, thanks, etc.) always respond with status "completed".
4. For SIMPLE tasks, prefer a SINGLE command then mark as "completed" on the next step.
5. Commands must be Windows PowerShell compatible.
6. NEVER repeat a command you already executed in this session.
7. When the previous command succeeded (exit_code 0) and the goal is achieved, respond with "completed".
8. NEVER describe your own capabilities, tools, or features — just execute the task.
9. NEVER mention "working memory", "memory", or internal tools in your message field.
10. Specific workspace-level settings overrides are NOT implemented yet. If the user asks to modify workspace settings, explain that specific workspace settings are not yet implemented.

OUTPUT FORMAT (choose exactly one, no deviations):

When you want to run a command:
{"status":"executing","command":"<powershell command here>","explanation":"<brief why, under 80 chars>","subagent":"<coder|researcher|validator|none>"}

When the goal is fully accomplished:
{"status":"completed","message":"<brief summary of what was done, plain text only>"}

When there is an unrecoverable error:
{"status":"error","message":"<reason why you cannot proceed, plain text only>"}

EXAMPLES:
- Input: "Goal: list files" → {"status":"executing","command":"Get-ChildItem","explanation":"List directory contents","subagent":"none"}
- Input: "Goal: check git status" → {"status":"executing","command":"git status","explanation":"Show working tree status","subagent":"researcher"}  
- Input: "Previous command exit code: 0\\nOutput: On branch main..." → {"status":"completed","message":"Git status checked: on branch main, working tree clean."}
- Input: "Goal: hello" → {"status":"completed","message":"Hello! Describe a task and I will execute it for you."}
- Input: "Goal: hi there" → {"status":"completed","message":"Hi! I am Aura. What would you like me to do?"}

The subagent field indicates which specialist is handling this step (for UI display only):
- "coder" — writing or modifying files/code
- "researcher" — reading files, exploring structure, running diagnostics  
- "validator" — checking outputs, running tests, verifying results
- "none" — direct execution, no specialist needed
`,
  // Use llama-3.3-70b-versatile for better instruction following and JSON output
  // TPM on Groq free tier: 12,000 for 70b vs 6,000 for 8b-instant
  model: getModelProvider('groq', 'llama-3.3-70b-versatile'),
  memory: auraMemory,
});
