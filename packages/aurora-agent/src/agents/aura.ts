import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';
import {
  readFileTool,
  listDirTool,
  searchFilesTool,
  grepSearchTool,
  writeFileTool,
  patchFileTool,
  execCommandTool,
  globTool,
  webFetchTool,
  askUserTool,
} from '../tools';
import { terminalShellTool, developerShellTool } from '../tools/shell';
// Note: no shell tool imported for readonly agents — that's intentional.

// ─────────────────────────────────────────────────────────────────────────────
// Model Provider Helper
// ─────────────────────────────────────────────────────────────────────────────

export function getModelProvider(
  providerName: string,
  modelName?: string,
  tier: 'fast' | 'balanced' | 'powerful' = 'balanced',
): { id: `${string}/${string}`; url?: string; apiKey?: string } {
  // Read dynamic settings from environment variables if passed
  const activeProvider = process.env.ACTIVE_AI_PROVIDER || providerName;
  let activeModel = modelName;

  if (process.env.ACTIVE_AI_PROVIDER) {
    if (tier === 'fast') {
      activeModel = process.env.ACTIVE_AI_MODEL_FAST || activeModel;
    } else if (tier === 'powerful') {
      activeModel = process.env.ACTIVE_AI_MODEL_POWERFUL || activeModel;
    } else {
      activeModel = process.env.ACTIVE_AI_MODEL_BALANCED || activeModel;
    }
  }

  const normalized = activeProvider.toLowerCase();

  if (normalized === 'groq') {
    // llama-3.3-70b-versatile is the most capable available Groq model.
    // The old llama3-groq-70b-8192-tool-use-preview was decommissioned.
    // Tool calling correctness is enforced via the rich shell.txt description
    // template that provides clear role-aware tool-use guidance to the model.
    return {
      id: `groq/${activeModel ?? 'llama-3.3-70b-versatile'}`,
      apiKey: process.env.GROQ_API_KEY,
    };
  }
  if (normalized === 'gpt-oss') {
    return {
      id: `openai/${activeModel ?? 'gpt-4o-mini'}`,
      url: process.env.GPT_OSS_BASE_URL ?? 'http://localhost:11434/v1',
      apiKey: process.env.GPT_OSS_API_KEY ?? 'empty',
    };
  }
  if (normalized === 'kimi') {
    return {
      id: `openai/${activeModel ?? 'kimi-k2'}`,
      url: 'https://api.moonshot.cn/v1',
      apiKey: process.env.KIMI_API_KEY ?? 'empty',
    };
  }
  if (normalized === 'anthropic') {
    return {
      id: `anthropic/${activeModel ?? 'claude-3-5-sonnet-latest'}`,
      apiKey: process.env.ANTHROPIC_API_KEY,
    };
  }
  if (normalized === 'gemini' || normalized === 'google') {
    return {
      id: `google/${activeModel ?? 'gemini-1.5-pro'}`,
      apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    };
  }
  if (normalized === 'openai') {
    return {
      id: `openai/${activeModel ?? 'gpt-4o-mini'}`,
      apiKey: process.env.OPENAI_API_KEY,
    };
  }
  if (normalized === 'nvidia') {
    return {
      id: `nvidia/${activeModel ?? 'meta/llama-3.1-405b-instruct'}`,
      apiKey: process.env.NVIDIA_API_KEY,
    };
  }
  if (normalized === 'ollama') {
    return {
      id: `openai/${activeModel ?? 'llama3.1:8b'}`,
      url: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434/v1',
      apiKey: 'empty',
    };
  }

  // Fallback
  return {
    id: `groq/${activeModel ?? 'llama-3.3-70b-versatile'}`,
    apiKey: process.env.GROQ_API_KEY,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared Memory
// ─────────────────────────────────────────────────────────────────────────────

export const memoryStorage = new LibSQLStore({
  id: 'aura-memory',
  url: 'file:./aura-memory.db',
});

export const auraMemory = new Memory({
  storage: memoryStorage,
  options: {
    lastMessages: 20,
    // Working memory is DISABLED intentionally.
    // Mastra wraps its content in <working_memory>...</working_memory> XML tags
    // which are injected into the system prompt. Llama models interpret XML in
    // the context as a signal to use XML-style function call syntax
    // (<function=name{...}>) instead of the standard JSON tool-calling protocol,
    // causing tool_use_failed errors on every tool call.
    workingMemory: {
      enabled: false,
    },
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Terminal Agent
//
// Shell-first. Shell IS the job. Dedicated file tools exist as conveniences,
// not replacements. The terminalShellTool description reflects this contract.
// ─────────────────────────────────────────────────────────────────────────────

export const terminalAgent = new Agent({
  id: 'terminalAgent',
  name: 'Terminal Agent',
  instructions: `You are the Terminal Agent for Aurora Terminal.
Your primary purpose is running shell commands to accomplish user goals.

OPERATING MODEL:
- Shell execution is your default action. Reach for it first.
- Use read_file and list_directory when you need precise structured output
  (e.g., reading a config file), but never as a substitute for shell when
  shell is simpler.
- Always explain what a command will do before running it.
- Run commands sequentially, one logical step at a time.
- If a command fails, inspect stderr, reason about the cause, and either
  fix and retry or explain the blocker to the user.
- When a goal is fully accomplished, summarize what was done concisely.

CONVERSATION:
- For greetings or simple questions, respond conversationally without
  running any commands.

TOOL CALLING:
- Always use the structured tool-calling interface provided by the system.
- NEVER output raw function call syntax like <function=name> or <tool_call> tags.
- Only call tools through the official tool-use channel.

OUTPUT HANDLING:
- Command output larger than 500 characters is truncated with a summary.
  Focus on the last 200 characters — they contain the most recent results.
- If your output says "[Output truncated...]", do NOT repeat the same command.
  Instead, propose a more targeted command (grep, Select-String, find).
- If command output is empty, the command ran successfully with no output.
  Do NOT repeat it unless the user asks.
- You can chain: list files → if too many results → grep for the specific term.
`,
  model: getModelProvider('groq', 'llama-3.3-70b-versatile', 'balanced'),
  memory: auraMemory,
  tools: {
    // Shell is primary — uses the terminal-role description (no "avoid shell" language)
    shell_terminal: terminalShellTool,
    exec_command: execCommandTool,
    // Supporting tools for when precision matters more than shell convenience
    read_file: readFileTool,
    list_directory: listDirTool,
    ask_user: askUserTool,
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Developer Agent — Plan Mode (READ-ONLY)
//
// No shell tool. No write tools. The agent cannot execute or modify anything.
// This is enforced both by the absence of shell from the tools object AND
// by the system prompt. Two layers, no gaps.
// ─────────────────────────────────────────────────────────────────────────────

export const developerPlanAgent = new Agent({
  id: 'developerPlanAgent',
  name: 'Developer Agent (Plan Mode)',
  instructions: `You are the Software Developer Agent in PLAN mode for Aurora Terminal.
Your job is to deeply understand the codebase and design a precise implementation strategy.

OPERATING MODEL:
- You are in READ-ONLY mode. You have zero ability to write files or execute commands.
  These tools do not exist in your toolkit — do not attempt to use them.
- Use read_file, list_directory, search_files, grep_search, and glob to
  explore the project thoroughly before forming a plan.
- Your output is always a plan, never an implementation.

PLAN FORMAT:
- List every file that needs to change and why.
- For each file change, describe the exact code transformation needed
  (add X before Y, replace Z with W, etc.).
- Flag any risks, ambiguities, or things that need user clarification.
- Do NOT write actual code blocks as the implementation — write them as
  illustrative examples within your plan description.

RESEARCH APPROACH:
- Before planning, fully map the relevant parts of the codebase.
- Cross-reference types, imports, and call sites so the plan is complete.
- Prefer deep understanding over fast answers.
`,
  model: getModelProvider('groq', 'llama-3.3-70b-versatile', 'powerful'),
  memory: auraMemory,
  tools: {
    // Filesystem exploration — read only, no writes, no shell
    read_file: readFileTool,
    list_directory: listDirTool,
    search_files: searchFilesTool,
    grep_search: grepSearchTool,
    glob: globTool,
    // External context
    web_fetch: webFetchTool,
    // Clarification
    ask_user: askUserTool,
    // ⚠️ No shell tool — intentional. Shell execution is blocked by omission.
    // ⚠️ No write_file, no patch_file — read-only contract enforced here.
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Developer Agent — Build Mode (FULL CAPABILITIES)
//
// Shell is a last resort. The developerShellTool description tells the model
// to exhaust dedicated tools first (read_file, grep_search, etc.) and only
// reach for shell when no dedicated tool can do the job. This avoids the
// model reflexively running `cat` and `grep` through shell when better tools exist.
// ─────────────────────────────────────────────────────────────────────────────

export const developerBuildAgent = new Agent({
  id: 'developerBuildAgent',
  name: 'Developer Agent (Build Mode)',
  instructions: `You are the Software Developer Agent in BUILD mode for Aurora Terminal.
Your job is to implement features, fix bugs, and verify the result.

OPERATING MODEL — TOOL PRIORITY ORDER:
1. read_file / grep_search / glob / list_directory — always first for reading and searching.
2. patch_file — for targeted edits to existing files (preferred over write_file for changes).
3. write_file — for creating new files or complete rewrites.
4. shell — LAST RESORT ONLY. Use shell exclusively for:
   - Build commands (cargo build, npm run build, tsc)
   - Test runners (cargo test, vitest, pytest)
   - Git operations (git add, commit, push)
   - Package installs (npm install, cargo add)
   - Process management (kill, ps, lsof)
   Never use shell to read files, search content, or write files when
   the dedicated tools can do the job. The shell tool's own description
   reinforces this — follow it.

IMPLEMENTATION WORKFLOW:
1. Understand before acting: read relevant files, trace types and call sites.
2. Plan the change mentally: know every file that needs editing before you start.
3. Make changes: use patch_file for modifications, write_file for new files.
4. Verify: run build and tests via shell. Inspect errors and fix them.
5. Summarize: list every file changed and what was done.

ERROR HANDLING:
- If a shell command fails, read stderr carefully before retrying.
- If a patch fails (context mismatch), re-read the file and recompute the patch.
- Never guess — inspect first.
`,
  model: getModelProvider('groq', 'llama-3.3-70b-versatile', 'powerful'),
  memory: auraMemory,
  tools: {
    // Reading and search — highest priority, always try these first
    read_file: readFileTool,
    list_directory: listDirTool,
    search_files: searchFilesTool,
    grep_search: grepSearchTool,
    glob: globTool,
    // Writing — use patch_file over write_file when possible
    patch_file: patchFileTool,
    write_file: writeFileTool,
    // Shell — last resort; uses the developer-role description (avoids shell for file ops)
    shell_developer: developerShellTool,
    exec_command: execCommandTool,
    // External and user interaction
    web_fetch: webFetchTool,
    ask_user: askUserTool,
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Legacy Agents (backward compatibility — kept as-is)
// ─────────────────────────────────────────────────────────────────────────────

export const coderAgent = new Agent({
  id: 'coderAgent',
  name: 'Coder Agent',
  description: 'Writes and refactors shell commands and code snippets based on specification.',
  instructions: `You are a code specialist. Given a task, output the exact shell command needed.
Always respond ONLY with valid JSON: {"command": "<shell command>", "explanation": "<why>"}`,
  model: getModelProvider('groq', 'gemma2-9b-it', 'fast'),
});

export const researcherAgent = new Agent({
  id: 'researcherAgent',
  name: 'Researcher Agent',
  description: 'Analyzes file structures, finds files, and reads documentation.',
  instructions: `You are a research specialist. Given a task, identify what information needs to be gathered.
Always respond ONLY with valid JSON: {"command": "<shell command to research>", "explanation": "<why>"}`,
  model: getModelProvider('groq', 'gemma2-9b-it', 'balanced'),
});

export const validatorAgent = new Agent({
  id: 'validatorAgent',
  name: 'Validator Agent',
  description: 'Validates outputs, runs diagnostics, checks build/test results.',
  instructions: `You are a validation specialist. Given command output, determine if the task succeeded.
Always respond ONLY with valid JSON: {"status": "success"|"failure", "reason": "<explanation>"}`,
  model: getModelProvider('groq', 'gemma2-9b-it', 'fast'),
});

export const aura = new Agent({
  id: 'aura',
  name: 'Aura',
  instructions: `You are Aura, an intelligent AI terminal agent for Aurora Terminal.
You help users accomplish tasks by executing shell commands step by step on Windows (PowerShell).
Respond ONLY with a single valid JSON object containing status and command.`,
  model: getModelProvider('groq', 'llama-3.3-70b-versatile', 'balanced'),
  memory: auraMemory,
});

export const codeCompletionAgent = new Agent({
  id: 'codeCompletionAgent',
  name: 'Code Completion Agent',
  description: 'Handles code completion and inline code editing.',
  instructions: `You are a professional code completion and code editing engine.
Provide clean, direct code completions or code edits without any explanation, conversational filler, markdown formatting, or JSON wrapping.
For code completion, return only the completion text to append.
For code editing, return only the final completed/modified code block.`,
  model: getModelProvider('groq', 'llama-3.3-70b-versatile', 'fast'),
});