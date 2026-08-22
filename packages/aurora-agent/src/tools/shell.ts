import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import * as os from 'os';
import { getDescription } from './helper';
import { rootLogger } from '../logger';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type Limits = {
  maxLines: number;
  maxBytes: number;
};

/**
 * Controls the behavioral contract the tool description communicates to the model.
 *
 * - 'terminal'  → Shell execution is the PRIMARY tool. Dedicated file tools are
 *                 secondary suggestions, not replacements. Used by terminalAgent.
 *
 * - 'developer' → Shell execution is a LAST RESORT. The model must exhaust all
 *                 dedicated tools (read_file, grep, etc.) before reaching for shell.
 *                 Used by developerBuildAgent.
 *
 * - 'readonly'  → Shell is DISABLED entirely. The tool will always reject execution
 *                 at runtime. Used by developerPlanAgent.
 */
export type AgentRole = 'terminal' | 'developer' | 'readonly';

// ─────────────────────────────────────────────────────────────────────────────
// Shell platform helpers (unchanged logic, extracted cleanly)
// ─────────────────────────────────────────────────────────────────────────────

const PS = new Set(['powershell', 'pwsh']);
const CMD = new Set(['cmd']);

function renderPrompt(template: string, values: Record<string, string>) {
  return template.replace(/\$\{(\w+)\}/g, (_, key: string) => {
    const value = values[key];
    if (value === undefined) throw new Error(`Missing shell prompt value: ${key}`);
    return value;
  });
}

function shellDisplayName(name: string) {
  if (name === 'pwsh') return 'PowerShell (7+)';
  if (name === 'powershell') return 'Windows PowerShell (5.1)';
  if (name === 'cmd') return 'cmd.exe';
  return name;
}

function powershellNotes(name: string) {
  if (name === 'pwsh') {
    return `# PowerShell (7+) shell notes
- This cross-platform shell supports pipeline chain operators (\`&&\` and \`||\`).
- Use double quotes for interpolated strings (\`"Hello $name"\`), single quotes for verbatim strings.
- Prefer full cmdlet names like \`Get-ChildItem\`, \`Set-Content\`, \`Remove-Item\`, and \`New-Item\` over aliases.
- Use \`$(...)\` for subexpressions. Use \`@(...)\` for array expressions.
- To call a native executable whose path contains spaces, use the call operator: \`& "path/to/exe" args\`.
- Escape special characters with the PowerShell backtick character.`;
  }
  if (name === 'powershell') {
    return `# Windows PowerShell (5.1) shell notes
- Use \`cmd1; if ($?) { cmd2 }\` to chain dependent commands.
- Use double quotes for interpolated strings (\`"Hello $name"\`), single quotes for verbatim strings.
- Prefer full cmdlet names like \`Get-ChildItem\`, \`Set-Content\`, \`Remove-Item\`, and \`New-Item\` over aliases.
- Use \`$(...)\` for subexpressions. Use \`@(...)\` for array expressions.
- To call a native executable whose path contains spaces, use the call operator: \`& "path/to/exe" args\`.
- Escape special characters with the PowerShell backtick character.`;
  }
  return '';
}

function chainGuidance(name: string) {
  if (name === 'powershell') {
    return "If the commands depend on each other and must run sequentially, avoid '&&' in this shell because Windows PowerShell (5.1) does not support it. Use PowerShell conditionals such as `cmd1; if ($?) { cmd2 }` when later commands must depend on earlier success.";
  }
  if (PS.has(name)) {
    return "If the commands depend on each other and must run sequentially, use a single shell call with '&&' to chain them (e.g., `git add . && git commit -m \"message\" && git push`).";
  }
  if (CMD.has(name)) {
    return "If the commands depend on each other and must run sequentially, use a single shell call with `&&` to chain them (e.g., `mkdir out && dir out`).";
  }
  return "If the commands depend on each other and must run sequentially, use a single Bash call with '&&' to chain them (e.g., `git add . && git commit -m \"message\" && git push`).";
}

// ─────────────────────────────────────────────────────────────────────────────
// Role-aware tool-preference sections
//
// This is the key abstraction: the same shell execution logic produces a
// completely different behavioral contract depending on AgentRole.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * For terminalAgent: shell IS the primary interface. Dedicated tools are helpful
 * alternatives, not mandatory replacements. The model should reach for shell first.
 */
function terminalToolPreference(): string {
  return `Tool preference (terminal-first mode):
  - Shell is your PRIMARY execution mechanism. Use it freely.
  - You MAY use dedicated tools (read_file, grep_search, etc.) when they are
    more precise or faster — but they are never mandatory.
  - Do NOT avoid shell out of habit. If a shell command solves the problem
    directly, use it.`;
}

/**
 * For developerBuildAgent: shell is a last resort. The model must use dedicated
 * tools for file I/O and search, reserving shell only for things dedicated tools
 * cannot do (build commands, git, package managers, test runners).
 */
function developerToolPreference(): string {
  return `Tool preference (developer mode — shell is last resort):
  - ALWAYS prefer dedicated tools over shell for file and content operations:
    - File search   → use glob (NOT find / Get-ChildItem / dir /s)
    - Content search → use grep_search (NOT grep / rg / Select-String / findstr)
    - Read files    → use read_file (NOT cat / Get-Content / type)
    - Edit files    → use patch_file (NOT sed / awk / Set-Content)
    - Write files   → use write_file (NOT echo > / Out-File / here-strings)
    - Output text   → reply directly (NOT echo / printf / Write-Host)
  - Only reach for shell when no dedicated tool can do the job:
    acceptable uses: build commands, test runners, git operations,
    package manager installs, process management, environment inspection.
  - When in doubt, ask yourself: "Does a dedicated tool exist for this?" If yes, use it.`;
}

/**
 * For developerPlanAgent: shell must not be used. This string is embedded in the
 * description so the model understands the constraint before attempting a call.
 * Runtime enforcement is handled separately in execute().
 */
function readonlyToolPreference(): string {
  return `IMPORTANT — READ-ONLY MODE:
  - You are operating in plan/analysis mode. Shell execution is DISABLED.
  - Any attempt to call this tool will be rejected at runtime.
  - Use only read_file, list_directory, search_files, grep_search, and glob
    to explore the codebase. Do NOT call shell under any circumstances.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Platform-specific command sections (now role-aware)
// ─────────────────────────────────────────────────────────────────────────────

function bashCommandSection(
  chain: string,
  limits: Limits,
  defaultTimeoutMs: number,
  toolPreference: string,
): string {
  return `Before executing the command, please follow these steps:

1. Directory Verification:
   - If the command will create new directories or files, first use \`ls\` to verify
     the parent directory exists and is the correct location.

2. Command Execution:
   - Always quote file paths that contain spaces with double quotes.
   - Execute the command and capture the output.

Usage notes:
  - The command argument is required.
  - You can specify an optional timeout in milliseconds (default: ${defaultTimeoutMs}ms).
  - If the output exceeds ${limits.maxLines} lines or ${limits.maxBytes} bytes, it will be
    truncated and written to a file. Use read_file with offset/limit or grep_search on that
    file. Do NOT use \`head\`, \`tail\`, or similar truncation commands.
  - When issuing multiple commands:
    - If independent, make multiple parallel tool calls in a single message.
    - ${chain}
    - Use ';' only when you need sequential execution but don't care if earlier commands fail.
    - DO NOT use newlines to separate commands (newlines are ok in quoted strings).
  - AVOID \`cd <directory> && <command>\`. Use the \`workdir\` parameter instead.
    Good example: Use workdir="/foo/bar" with command: pytest tests
    Bad example: cd /foo/bar && pytest tests

${toolPreference}`;
}

function powershellCommandSection(
  name: string,
  chain: string,
  pathSep: string,
  limits: Limits,
  defaultTimeoutMs: number,
  toolPreference: string,
): string {
  return `${powershellNotes(name)}

Before executing the command, please follow these steps:

1. Directory Verification:
   - If the command will create new directories or files, first use
     \`Test-Path -LiteralPath <parent>\` to verify the parent directory exists.

2. Command Execution:
   - Always quote file paths that contain spaces with double quotes.
   - Execute the command and capture the output.

Usage notes:
  - The command argument is required.
  - You can specify an optional timeout in milliseconds (default: ${defaultTimeoutMs}ms).
  - If the output exceeds ${limits.maxLines} lines or ${limits.maxBytes} bytes, it will be
    truncated and written to a file. Use read_file with offset/limit or grep_search on that
    file.
  - When issuing multiple commands:
    - If independent, make multiple parallel tool calls in a single message.
    - ${chain}
    - Use \`;\` only when you need sequential execution but don't care if earlier commands fail.
    - DO NOT use newlines to separate commands (newlines are ok in quoted strings).
  - AVOID changing directories inside the command. Use the \`workdir\` parameter instead.
    Good example: Use workdir="project${pathSep}subdir" with command: pytest tests
    Bad example: ${name === 'powershell' ? `Set-Location -LiteralPath "project${pathSep}subdir"; if ($?) { pytest tests }` : `Set-Location -LiteralPath "project${pathSep}subdir" && pytest tests`}

${toolPreference}`;
}

function cmdCommandSection(
  chain: string,
  limits: Limits,
  defaultTimeoutMs: number,
  toolPreference: string,
): string {
  return `# cmd.exe shell notes
- Use double quotes for paths with spaces.
- Use %VAR% for environment variables.
- Use \`if exist\` for existence checks.
- Use \`call\` when invoking batch files.

Before executing the command, please follow these steps:

1. Directory Verification:
   - Use \`if exist\` to verify the parent directory before creating files.

2. Command Execution:
   - Always quote file paths that contain spaces with double quotes.
   - Execute the command and capture the output.

Usage notes:
  - The command argument is required.
  - You can specify an optional timeout in milliseconds (default: ${defaultTimeoutMs}ms).
  - If the output exceeds ${limits.maxLines} lines or ${limits.maxBytes} bytes, it will be
    truncated and written to a file.
  - When issuing multiple commands:
    - If independent, make multiple parallel tool calls in a single message.
    - ${chain}
    - Use \`&\` only when sequential but failure of earlier steps doesn't matter.
    - DO NOT use newlines to separate commands.
  - AVOID changing directories inside the command. Use the \`workdir\` parameter instead.

${toolPreference}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Profile assembly — now takes AgentRole
// ─────────────────────────────────────────────────────────────────────────────

function resolveToolPreference(role: AgentRole): string {
  switch (role) {
    case 'terminal': return terminalToolPreference();
    case 'developer': return developerToolPreference();
    case 'readonly': return readonlyToolPreference();
  }
}

function profile(
  name: string,
  platform: NodeJS.Platform,
  limits: Limits,
  defaultTimeoutMs: number,
  role: AgentRole,
) {
  const toolPreference = resolveToolPreference(role);
  const chain = chainGuidance(name);

  const introByRole: Record<AgentRole, string> = {
    terminal: `Executes a ${shellDisplayName(name)} command. Shell is your primary tool — use it freely.`,
    developer: `Executes a ${shellDisplayName(name)} command. Prefer dedicated tools for file/content ops; use shell only for build, test, git, and process management.`,
    readonly: `[DISABLED] Shell execution is not available in plan/read-only mode.`,
  };

  const createPr = CMD.has(name)
    ? {
      instruction: 'Create PR using a temporary body file so cmd.exe quoting stays simple.',
      example: `(\n  echo ## Summary\n  echo - ^<1-3 bullet points^>\n) pr-body.txt\ngh pr create --title "the pr title" --body-file pr-body.txt`,
    }
    : PS.has(name)
      ? {
        instruction: 'Create PR using gh pr create with a PowerShell here-string to pass the body correctly.',
        example: `gh pr create --title "the pr title" --body @'\n## Summary\n- <1-3 bullet points>\n'@`,
      }
      : {
        instruction: 'Create PR using gh pr create with a HEREDOC to pass the body.',
        example: `gh pr create --title "the pr title" --body "$(cat <<'EOF'\n## Summary\n<1-3 bullet points>`,
      };

  let commandSection: string;
  if (CMD.has(name)) {
    commandSection = cmdCommandSection(chain, limits, defaultTimeoutMs, toolPreference);
  } else if (PS.has(name)) {
    commandSection = powershellCommandSection(
      name,
      chain,
      platform === 'win32' ? '\\' : '/',
      limits,
      defaultTimeoutMs,
      toolPreference,
    );
  } else {
    commandSection = bashCommandSection(chain, limits, defaultTimeoutMs, toolPreference);
  }

  return {
    intro: introByRole[role],
    workdirSection:
      CMD.has(name) || PS.has(name)
        ? "All commands run in the current working directory by default. Use the `workdir` parameter if you need to run a command in a different directory. AVOID changing directories inside the command."
        : "All commands run in the current working directory by default. Use the `workdir` parameter if you need to run a command in a different directory. AVOID using `cd <directory> && <command>` patterns.",
    commandSection,
    gitCommands: CMD.has(name) || PS.has(name) ? 'shell commands' : 'bash commands',
    gitCommandRestriction: CMD.has(name) || PS.has(name) ? 'shell commands' : 'git bash commands',
    createPrInstruction: createPr.instruction,
    createPrExample: createPr.example,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public factory — render() now takes AgentRole
// ─────────────────────────────────────────────────────────────────────────────

export function render(
  name: string,
  platform: NodeJS.Platform,
  limits: Limits,
  defaultTimeoutMs: number,
  role: AgentRole = 'developer', // safe default: prefer dedicated tools
) {
  const rawDescription = getDescription(
    'shell.txt',
    'Execute a shell command sequentially in the terminal queue.',
  );
  const selected = profile(name, platform, limits, defaultTimeoutMs, role);

  const description = renderPrompt(rawDescription, {
    intro: selected.intro,
    os: platform,
    shell: name,
    tmp: os.tmpdir(),
    workdirSection: selected.workdirSection,
    commandSection: selected.commandSection,
    gitCommands: selected.gitCommands,
    toolName: 'shell',
    gitCommandRestriction: selected.gitCommandRestriction,
    createPrInstruction: selected.createPrInstruction,
    createPrExample: selected.createPrExample,
  });

  return {
    description,
    parameters: z.object({
      command: z.string().describe('The command to execute.'),
      explanation: z.string().describe('Brief explanation of what this command accomplishes.'),
      timeout: z.number().int().positive().default(120_000).describe('Timeout in milliseconds.'),
      workdir: z
        .string()
        .optional()
        .describe(
          "The working directory to run the command in. Defaults to the current directory. Use this instead of 'cd' commands.",
        ),
    }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory function — creates a shell tool bound to a specific AgentRole
//
// Usage:
//   import { createShellTool } from './tools/shell';
//   const terminalShellTool  = createShellTool('terminal');
//   const developerShellTool = createShellTool('developer');
//   // developerPlanAgent gets no shell tool at all — don't pass one.
// ─────────────────────────────────────────────────────────────────────────────

export function createShellTool(role: AgentRole) {
  const currentShell = process.platform === 'win32' ? 'powershell' : 'bash';
  const renderedInfo = render(
    currentShell,
    process.platform,
    { maxLines: 1000, maxBytes: 1_000_000 },
    120_000,
    role,
  );

  return createTool({
    id: `shell_${role}`, // distinct IDs prevent accidental cross-agent reuse
    description: renderedInfo.description,
    inputSchema: renderedInfo.parameters,
    suspendSchema: z.object({
      command: z.string(),
      explanation: z.string(),
      timeout: z.number().int().positive().optional(),
      type: z.literal('command'),
    }),
    resumeSchema: z.object({
      approved: z.boolean(),
      stdout: z.string(),
      stderr: z.string(),
      exitCode: z.number(),
    }),
    outputSchema: z.object({
      success: z.boolean(),
      stdout: z.string().optional(),
      stderr: z.string().optional(),
      exitCode: z.number().optional(),
      error: z.string().optional(),
    }),

    execute: async (input, context) => {
      const toolLog = rootLogger.child({ tool: `shell_${role}` });

      // ── Runtime enforcement for readonly role ───────────────────────────
      // Belt-and-suspenders: even if the model ignores the description, the
      // tool itself refuses to execute in readonly mode.
      if (role === 'readonly') {
        toolLog.warn('Shell execution blocked — readonly mode');
        return {
          success: false,
          error:
            'Shell execution is disabled in plan/read-only mode. Use read_file, ' +
            'grep_search, list_directory, or glob to explore the codebase.',
        };
      }

      const { resumeData, suspend } = context?.agent ?? {};

      if (!resumeData) {
        let commandToRun = input.command;
        if (input.workdir) {
          commandToRun =
            process.platform === 'win32'
              ? `Set-Location -LiteralPath "${input.workdir}"; if ($?) { ${input.command} }`
              : `cd "${input.workdir}" && ${input.command}`;
        }
        toolLog.info('Suspending — sending shell command to terminal', {
          command: commandToRun.slice(0, 200),
          workdir: input.workdir,
          role,
        });
        return suspend?.({
          command: commandToRun,
          explanation: input.explanation,
          timeout: input.timeout,
          type: 'command' as const,
        });
      }

      if (!resumeData.approved) {
        toolLog.warn('Shell command rejected by user', {
          command: input.command.slice(0, 200),
          role,
        });
        return {
          success: false,
          error: resumeData.stderr?.trim() || 'User rejected or cancelled command execution.',
        };
      }

      toolLog.info('Shell command result received', {
        command: input.command.slice(0, 200),
        exitCode: resumeData.exitCode,
        success: resumeData.exitCode === 0,
        stdoutLength: resumeData.stdout?.length,
        stderrLength: resumeData.stderr?.length,
        role,
      });
      toolLog.debug('Shell stdout', { stdout: resumeData.stdout?.slice(0, 500) });
      toolLog.debug('Shell stderr', { stderr: resumeData.stderr?.slice(0, 500) });

      return {
        success: resumeData.exitCode === 0,
        stdout: resumeData.stdout,
        stderr: resumeData.stderr,
        exitCode: resumeData.exitCode,
      };
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Pre-built instances — import these directly in your agent definitions
// ─────────────────────────────────────────────────────────────────────────────

/** For terminalAgent — shell is the primary tool, no restrictions. */
export const terminalShellTool = createShellTool('terminal');

/** For developerBuildAgent — shell is last resort, dedicated tools preferred. */
export const developerShellTool = createShellTool('developer');

// Note: there is intentionally NO readonlyShellTool export.
// developerPlanAgent should receive zero shell tools in its tools object.