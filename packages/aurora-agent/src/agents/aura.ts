import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { InMemoryStore } from '@mastra/core/storage';
import { auraResponseValidator } from '../processors/auraResponseValidator';
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
  historySearchTool,
} from '../tools';
import { terminalShellTool, developerShellTool } from '../tools/shell';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

function getDynamicInstructions(baseInstructions: string): string {
  try {
    const agentsMdPath = path.join(process.cwd(), 'AGENT.md');
    if (fs.existsSync(agentsMdPath)) {
      const agentsMd = fs.readFileSync(agentsMdPath, 'utf-8');
      return `${baseInstructions}\n\n<system_reminder>\nPROJECT RULES (FROM AGENT.md):\n${agentsMd}\n</system_reminder>`;
    }
  } catch (err) {
    console.error('Failed to load AGENT.md for instructions:', err);
  }
  return baseInstructions;
}
// ─────────────────────────────────────────────────────────────────────────────
// Model Provider Helper
// ─────────────────────────────────────────────────────────────────────────────

function getInstalledOllamaModels(baseUrl: string): string[] {
  try {
    const url = baseUrl.replace(/\/v1\/?$/, '').replace(/\/$/, '');
    const nodeScript = `
      const http = require('http');
      const req = http.get('${url}/api/tags', (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => { process.stdout.write(data); process.exit(0); });
      });
      req.on('error', () => process.exit(1));
      req.setTimeout(2500, () => { req.destroy(); process.exit(1); });
    `;
    const response = execSync(`node -e "${nodeScript.replace(/\n/g, ' ')}"`, { timeout: 3000 }).toString();
    const data = JSON.parse(response);
    if (data && Array.isArray(data.models)) {
      return data.models.map((m: any) => m.name);
    }
  } catch (err) {
    try {
      const output = execSync('ollama list', { timeout: 3000 }).toString();
      const lines = output.split('\n').slice(1);
      const models: string[] = [];
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts[0]) {
          models.push(parts[0]);
        }
      }
      return models;
    } catch (e) {
      // Ignored
    }
  }
  return [];
}

// Cache installed Ollama models per base URL so we don't spawn a node
// subprocess on every request (getInstalledOllamaModels uses execSync).
const installedOllamaModelsCache: { baseUrl: string; models: string[]; fetchedAt: number } = {
  baseUrl: '',
  models: [],
  fetchedAt: 0,
};
const OLLAMA_CACHE_TTL_MS = 10_000;

function getInstalledOllamaModelsCached(baseUrl: string): string[] {
  const now = Date.now();
  if (installedOllamaModelsCache.baseUrl === baseUrl && now - installedOllamaModelsCache.fetchedAt < OLLAMA_CACHE_TTL_MS) {
    return installedOllamaModelsCache.models;
  }
  const models = getInstalledOllamaModels(baseUrl);
  installedOllamaModelsCache.baseUrl = baseUrl;
  installedOllamaModelsCache.models = models;
  installedOllamaModelsCache.fetchedAt = now;
  return models;
}

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

  if (!activeProvider || activeProvider.trim() === '') {
    throw new Error('No AI provider selected. Please select a provider in Settings → AI.');
  }

  const normalized = activeProvider.toLowerCase();
  const selectedModel = (activeModel || '').trim();

  if (!selectedModel) {
    throw new Error(`No model selected for provider '${activeProvider}'. Please select a model in Settings → AI.`);
  }

  if (normalized === 'groq') {
    return {
      id: `groq/${selectedModel}`,
      apiKey: process.env.GROQ_API_KEY,
    };
  }
  if (normalized === 'gpt-oss') {
    return {
      id: `openai/${selectedModel}`,
      url: process.env.GPT_OSS_BASE_URL ?? 'http://localhost:11434/v1',
      apiKey: process.env.GPT_OSS_API_KEY ?? 'empty',
    };
  }
  if (normalized === 'kimi') {
    return {
      id: `openai/${selectedModel}`,
      url: 'https://api.moonshot.cn/v1',
      apiKey: process.env.KIMI_API_KEY ?? 'empty',
    };
  }
  if (normalized === 'anthropic') {
    return {
      id: `anthropic/${selectedModel}`,
      apiKey: process.env.ANTHROPIC_API_KEY,
    };
  }
  if (normalized === 'gemini' || normalized === 'google') {
    return {
      id: `google/${selectedModel}`,
      apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    };
  }
  if (normalized === 'openai') {
    return {
      id: `openai/${selectedModel}`,
      apiKey: process.env.OPENAI_API_KEY,
    };
  }
  if (normalized === 'nvidia') {
    return {
      id: `nvidia/${selectedModel}`,
      apiKey: process.env.NVIDIA_API_KEY,
    };
  }
  if (normalized === 'ollama') {
    const rawUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    const cleanUrl = rawUrl.endsWith('/v1') ? rawUrl : `${rawUrl.replace(/\/$/, '')}/v1`;

    // Fall back to an installed model if the configured one isn't available,
    // mirroring the Rust OllamaProvider. Prevents "model not found" errors.
    let resolvedModel = selectedModel;
    const installed = getInstalledOllamaModelsCached(rawUrl);
    if (installed.length > 0 && !installed.includes(resolvedModel)) {
      const cleanModel = resolvedModel.split(':')[0];
      const matched = installed.find(
        (m) => m === cleanModel || m.startsWith(cleanModel) || m.split(':')[0] === cleanModel
      );
      resolvedModel = matched || installed[0];
    }

    return {
      id: `openai/${resolvedModel}`,
      url: cleanUrl,
      apiKey: 'empty',
    };
  }

  return {
    id: `openai/${selectedModel}`,
    apiKey: process.env.GROQ_API_KEY,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared Memory
// ─────────────────────────────────────────────────────────────────────────────

export const memoryStorage = new InMemoryStore({
  id: 'aura-memory',
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
  instructions: () => getDynamicInstructions(`You are the Terminal Agent for Aurora Terminal.
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

RESPONSE FORMAT:
- Respond with EXACTLY one JSON object and nothing else (no surrounding prose,
  no markdown code fences).
- While working, respond with:
  {"status":"executing","command":"<shell command>","explanation":"<brief why>","planning":"<1 sentence on how you are approaching the query before this command>"}
- When the goal is fully accomplished, respond with:
  {"status":"completed","planning":"<1-2 sentence thinking about how you approached the query>","conclusion":"<1-2 sentence reflection such as 'I now have everything and will write the response'>","message":"<the complete answer for the user, formatted in markdown>"}
- \`planning\` is your thinking about the query — it is streamed live into the UI's
  planning step of the chain of thought. \`conclusion\` is your closing reflection —
  streamed live into the UI's conclusion step. \`message\` holds the actual answer
  and is the ONLY text rendered as your response. Never put the answer inside
  \`planning\` or \`conclusion\`, and never put your thinking inside \`message\`.

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

FILE CONTEXT:
- When a prompt contains [FILE CONTEXT] blocks, only METADATA about the file is
  provided (path, name, size, language) plus a short preview. The full contents
  are NOT included. Use the read_file tool with the given path whenever you need
  to actually inspect the file's code. Never assume the preview is the whole file.

SELECTED LINES:
- When a prompt contains a [SELECTED LINES] block, the user has highlighted the
  exact lines shown there in the editor. Treat that selection as the scope of the
  request — inspect those lines first, and target edits to those specific lines
  only unless the user's goal clearly requires changing adjacent code.
`),
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
    history_search: historySearchTool,
  },
  outputProcessors: [auraResponseValidator],
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
  instructions: () => getDynamicInstructions(`You are the Software Developer Agent in PLAN mode for Aurora Terminal.
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

RESPONSE FORMAT:
- Respond with EXACTLY one JSON object and nothing else (no surrounding prose,
  no markdown code fences).
- When the plan is ready, respond with:
  {"status":"completed","planning":"<1-2 sentence thinking about how you explored the codebase and the approach you formed>","conclusion":"<1-2 sentence reflection such as 'I now have a complete approach and will write the plan'>","message":"<the full plan, formatted in markdown>"}
- \`planning\` is your thinking about the exploration — streamed live into the UI's
  planning step. \`conclusion\` is your closing reflection — streamed live into the
  UI's conclusion step. \`message\` holds the actual plan and is the ONLY text
  rendered as your response. Never put the plan inside \`planning\` or
  \`conclusion\`.
`),
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
  outputProcessors: [auraResponseValidator],
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
  instructions: () => getDynamicInstructions(`You are the Software Developer Agent in BUILD mode for Aurora Terminal.
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

FILE CONTEXT:
- When a prompt contains [FILE CONTEXT] blocks, only METADATA about the file is
  provided (path, name, size, language) plus a short preview. The full contents
  are NOT included. Use the read_file tool with the given path whenever you need
  to actually inspect the file's code. Never assume the preview is the whole file.

SELECTED LINES:
- When a prompt contains a [SELECTED LINES] block, the user has highlighted the
  exact lines shown there in the editor. Treat that selection as the scope of the
  request — inspect those lines first, and target edits to those specific lines
  only unless the user's goal clearly requires changing adjacent code.

RESPONSE FORMAT:
- Always respond with EXACTLY one JSON object and nothing outside it.
  - While working, respond with:
    {"status":"executing","command":"<shell command>","explanation":"<brief why>","planning":"<1 sentence on how you are approaching the task before this command>"}
  - When the goal is fully accomplished, respond with:
    {"status":"completed","planning":"<1-2 sentence thinking about how you approached the task>","conclusion":"<1-2 sentence reflection such as 'I now have everything I need and will write the response'>","message":"<the complete answer for the user, formatted in markdown>"}
  - \`planning\` is your thinking about the task - streamed live into the UI's
    planning step of the chain of thought. \`conclusion\` is a short transitional thought that is streamed live into the UI's
  conclusion step of the chain of thought. \`message\` holds the actual answer.
  Never put the answer inside \`conclusion\`, and never put the reflection inside
  \`message\`.
`),
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
  outputProcessors: [auraResponseValidator],
});

// ─────────────────────────────────────────────────────────────────────────────
// Chat Agent — conversational answers, NO tools
//
// Used by the `/btw` slash command: answers a question conversationally while a
// task (and its tool calls) continues running in the background. Because it has
// zero tools bound, it can never suspend, never interrupt an in-flight run, and
// never try to execute commands — guaranteed safe for out-of-band questions.
// ─────────────────────────────────────────────────────────────────────────────

export const chatAgent = new Agent({
  id: 'chatAgent',
  name: 'Aurora Chat',
  instructions: () => getDynamicInstructions(`You are a conversational assistant embedded in Aurora Terminal.
You answer the user's questions directly and conversationally.
You have NO tools — never attempt to run commands, read files, or modify anything.
If a task is currently in progress in the same session, do not reference or try to
interrupt it; just answer the question that was asked.
Keep answers concise and helpful. If the user asks for something that requires
inspecting files or running commands, briefly explain that you can only answer
conversationally and suggest they submit it as a task.`),
  model: getModelProvider('groq', 'llama-3.3-70b-versatile', 'balanced'),
  memory: auraMemory,
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