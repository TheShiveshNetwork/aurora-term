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
import { getRuntimeSettings } from '../runtime-settings';
import { AURA_FORMAT_CONTRACT } from '../schemas/auraEnvelope';

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

/**
 * Fetch Ollama's installed models via its HTTP API (`/api/tags`) using the
 * runtime's native fetch. This replaces an earlier implementation that
 * spawned a second Node process (`execSync('node -e ...')`, with an
 * `ollama list` CLI fallback) just to make one HTTP GET (#54) — spawning
 * added ~50–200ms of latency per resolution, depended on `node` being on
 * PATH, and relied on a string-escaped inline script staying quote-safe.
 *
 * Resolves to an empty list if the server is unreachable or slow (2.5s cap);
 * the caller caches the result so a downed Ollama doesn't re-probe on every
 * generation within the TTL window.
 */
async function getInstalledOllamaModels(baseUrl: string): Promise<string[]> {
  try {
    const url = baseUrl.replace(/\/v1\/?$/, '').replace(/\/$/, '');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    let data: any;
    try {
      const res = await fetch(`${url}/api/tags`, { signal: controller.signal });
      if (!res.ok) return [];
      data = await res.json();
    } finally {
      clearTimeout(timer);
    }
    return Array.isArray(data?.models)
      ? data.models.map((m: any) => m.name).filter((n: unknown): n is string => typeof n === 'string')
      : [];
  } catch {
    // Server down / timeout / non-JSON body — treated as "no installed models".
    return [];
  }
}

// Cache installed Ollama models per base URL so we don't re-probe the server
// on every generation (getInstalledOllamaModels hits /api/tags). Failures are
// cached too — an unreachable Ollama must not add probe latency to every call.
const installedOllamaModelsCache: { baseUrl: string; models: string[]; fetchedAt: number } = {
  baseUrl: '',
  models: [],
  fetchedAt: 0,
};
const OLLAMA_CACHE_TTL_MS = 10_000;

async function getInstalledOllamaModelsCached(baseUrl: string): Promise<string[]> {
  const now = Date.now();
  if (installedOllamaModelsCache.baseUrl === baseUrl && now - installedOllamaModelsCache.fetchedAt < OLLAMA_CACHE_TTL_MS) {
    return installedOllamaModelsCache.models;
  }
  const models = await getInstalledOllamaModels(baseUrl);
  installedOllamaModelsCache.baseUrl = baseUrl;
  installedOllamaModelsCache.models = models;
  installedOllamaModelsCache.fetchedAt = now;
  return models;
}

export async function getModelProvider(
  providerName?: string,
  modelName?: string,
  tier: 'fast' | 'balanced' | 'powerful' = 'balanced',
): Promise<{ id: `${string}/${string}`; url?: string; apiKey?: string }> {
  // Resolve from the live runtime settings store (initialized from the env that
  // the sidecar was spawned with, but updatable at runtime via POST /api/settings).
  // This is what lets Settings → AI changes apply without an agent restart.
  const settings = getRuntimeSettings();
  const hasActiveProvider = !!settings.activeProvider;
  const activeProvider = settings.activeProvider || providerName;

  // When an active provider is configured, its per-tier model (from Settings →
  // AI) wins over the per-agent default `modelName`. This mirrors the previous
  // ACTIVE_AI_MODEL_* env-var override behavior, but now it is live.
  let activeModel = hasActiveProvider ? settings.models[tier] : modelName;
  if (!activeModel) activeModel = modelName;

  if (!activeProvider || activeProvider.trim() === '') {
    throw new Error('No AI provider selected. Please select a provider in Settings → AI.');
  }

  const normalized = activeProvider.toLowerCase();
  const selectedModel = (activeModel || '').trim();

  if (!selectedModel) {
    throw new Error(`No model selected for provider '${activeProvider}'. Please select a model in Settings → AI.`);
  }

  const apiKey = settings.apiKeys[normalized];
  const baseUrl = settings.baseUrls[normalized];

  if (normalized === 'groq') {
    return { id: `groq/${selectedModel}`, apiKey };
  }
  if (normalized === 'gpt-oss') {
    return {
      id: `openai/${selectedModel}`,
      url: baseUrl ?? 'http://localhost:11434/v1',
      apiKey: apiKey ?? 'empty',
    };
  }
  if (normalized === 'kimi') {
    return {
      id: `openai/${selectedModel}`,
      url: 'https://api.moonshot.cn/v1',
      apiKey: apiKey ?? 'empty',
    };
  }
  if (normalized === 'anthropic') {
    return { id: `anthropic/${selectedModel}`, apiKey };
  }
  if (normalized === 'gemini' || normalized === 'google') {
    return { id: `google/${selectedModel}`, apiKey };
  }
  if (normalized === 'openai') {
    return { id: `openai/${selectedModel}`, apiKey };
  }
  if (normalized === 'nvidia') {
    return { id: `nvidia/${selectedModel}`, apiKey };
  }
  if (normalized === 'ollama') {
    const rawUrl = baseUrl || 'http://localhost:11434';
    const cleanUrl = rawUrl.endsWith('/v1') ? rawUrl : `${rawUrl.replace(/\/$/, '')}/v1`;

    // Fall back to an installed model if the configured one isn't available,
    // mirroring the Rust OllamaProvider. Prevents "model not found" errors.
    let resolvedModel = selectedModel;
    const installed = await getInstalledOllamaModelsCached(rawUrl);
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

  return { id: `openai/${selectedModel}`, apiKey };
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

ALTERNATE SCREEN BUFFER (TUI) MODE:
- If a command you propose is declined with a message that the terminal is in
  an "alternate screen buffer", that means shell commands CANNOT be executed right now.
  Do NOT attempt to run or re-propose terminal commands in this state.
- When in this mode, your PRIMARY tools become the read-only ones
  (read_file, list_directory, grep_search, glob, web_fetch, history_search).
  Use them to gather any information you need, and respond using your normal
  JSON format (put the explanation in the \`message\` field).
- Only resume proposing/running shell commands once the TUI has been exited
  and the terminal is back to a normal prompt.

CONVERSATION:
- For greetings or simple questions, respond conversationally without
  running any commands.

RESPONSE FORMAT:
${AURA_FORMAT_CONTRACT}

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
  model: async () => getModelProvider(undefined, undefined, 'balanced'),
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
  // Hard ceilings for a shell-capable agent (#53): an unbounded tool loop on
  // something that executes side-effecting commands is dangerous. Low
  // temperature keeps command generation deterministic.
  defaultOptions: {
    maxSteps: 20,
    modelSettings: { temperature: 0.2 },
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
${AURA_FORMAT_CONTRACT}
\`planning\` is your thinking about the exploration — streamed live into the
UI's planning step. \`conclusion\` is your closing reflection — streamed live into
the UI's conclusion step. \`message\` holds the actual plan and is the ONLY text
rendered as your response. Never put the plan inside \`planning\` or
\`conclusion\`.
`),
  model: async () => getModelProvider(undefined, undefined, 'powerful'),
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
  // Read-only exploration can legitimately take more steps than build mode
  // needs per turn (#53). Slightly higher temperature is acceptable here —
  // nothing this agent runs has side effects.
  defaultOptions: {
    maxSteps: 40,
    modelSettings: { temperature: 0.3 },
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
${AURA_FORMAT_CONTRACT}
- \`planning\` is your thinking about the task — streamed live into the UI's
  planning step of the chain of thought. \`conclusion\` is a short transitional
  thought that is streamed live into the UI's conclusion step of the chain of
  thought. \`message\` holds the actual answer. Never put the answer inside
  \`conclusion\`, and never put the reflection inside \`message\`.
`),
  model: async () => getModelProvider(undefined, undefined, 'powerful'),
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
  // Hard ceilings for a write-capable agent (#53): patch_file/write_file/shell
  // all have side effects, so the tool loop gets a tight budget and a low
  // temperature for deterministic edits and commands.
  defaultOptions: {
    maxSteps: 20,
    modelSettings: { temperature: 0.2 },
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
  model: async () => getModelProvider(undefined, undefined, 'balanced'),
  memory: auraMemory,
  // No tools bound — one shot, conversationally warm (#53). The maxSteps=1
  // default also bounds /api/chat, which passes no explicit maxSteps.
  defaultOptions: {
    maxSteps: 1,
    modelSettings: { temperature: 0.7 },
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
  model: async () => getModelProvider(undefined, undefined, 'fast'),
  // One-shot command generation -- deterministic, single step (#53).
  defaultOptions: { maxSteps: 1, modelSettings: { temperature: 0.2 } },
});

export const researcherAgent = new Agent({
  id: 'researcherAgent',
  name: 'Researcher Agent',
  description: 'Analyzes file structures, finds files, and reads documentation.',
  instructions: `You are a research specialist. Given a task, identify what information needs to be gathered.
Always respond ONLY with valid JSON: {"command": "<shell command to research>", "explanation": "<why>"}`,
  model: async () => getModelProvider(undefined, undefined, 'balanced'),
  defaultOptions: { maxSteps: 5, modelSettings: { temperature: 0.3 } },
});

export const validatorAgent = new Agent({
  id: 'validatorAgent',
  name: 'Validator Agent',
  description: 'Validates outputs, runs diagnostics, checks build/test results.',
  instructions: `You are a validation specialist. Given command output, determine if the task succeeded.
Always respond ONLY with valid JSON: {"status": "success"|"failure", "reason": "<explanation>"}`,
  model: async () => getModelProvider(undefined, undefined, 'fast'),
  // Classification task -- near-greedy sampling (#53).
  defaultOptions: { maxSteps: 1, modelSettings: { temperature: 0.1 } },
});

export const aura = new Agent({
  id: 'aura',
  name: 'Aura',
  instructions: `You are Aura, an intelligent AI terminal agent for Aurora Terminal.
You help users accomplish tasks by executing shell commands step by step on Windows (PowerShell).
Respond ONLY with a single valid JSON object containing status and command.`,
  model: async () => getModelProvider(undefined, undefined, 'balanced'),
  memory: auraMemory,
  defaultOptions: { maxSteps: 10, modelSettings: { temperature: 0.2 } },
});

export const codeCompletionAgent = new Agent({
  id: 'codeCompletionAgent',
  name: 'Code Completion Agent',
  description: 'Handles code completion and inline code editing.',
  instructions: `You are a professional code completion and code editing engine.
Provide clean, direct code completions or code edits without any explanation, conversational filler, markdown formatting, or JSON wrapping.
For code completion, return only the completion text to append.
For code editing, return only the final completed/modified code block.`,
  model: async () => getModelProvider(undefined, undefined, 'fast'),
  // Inline completions must be deterministic and instant (#53).
  defaultOptions: { maxSteps: 1, modelSettings: { temperature: 0.2 } },
});



