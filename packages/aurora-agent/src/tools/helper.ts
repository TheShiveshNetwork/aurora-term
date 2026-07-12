import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

// Resolve __dirname safely in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function safeResolve(filePath: string): string {
  return path.resolve(process.cwd(), filePath);
}

export const reviewSettings = {
  requireReviewForCommands: true,
  requireReviewForWrites: true,
};

const INLINED_DESCRIPTIONS: Record<string, string> = {
  'ask_user.txt': 'Ask the user a clarifying question or request inputs/choices when stuck or needing details. Pauses and prompts the user.',
  'command.txt': 'Execute a shell command sequentially in the client-side terminal execution queue. Requires user approval.',
  'glob.txt': 'Find files in the workspace matching a wildcard glob pattern (e.g. "src/**/*.ts"). Excludes node_modules and version control folders.',
  'grep.txt': `- Fast content search tool that works with any codebase size
- Searches file contents using regular expressions
- Supports full regex syntax (eg. "log.*Error", "function\\s+\\w+", etc.)
- Filter files by pattern with the include parameter (eg. "*.js", "*.{ts,tsx}")
- Returns file paths and line numbers with matching lines
- Use this tool when you need to find files containing specific patterns
- If you need to identify/count the number of matches within files, use the Bash tool with \`rg\` (ripgrep) directly. Do NOT use \`grep\`.
- When you are doing an open-ended search that may require multiple rounds of globbing and grepping, use the Task tool instead`,
  'list_directory.txt': 'List the files and subdirectories of a given directory in the workspace with details on entry sizes.',
  'patch.txt': 'Patch an existing file by replacing a specific search block with a replacement block of code. Requires user approval.',
  'read.txt': 'Read the contents of a file or directory in the workspace. Returns the raw file contents or list of entries.',
  'search_files.txt': 'Search for filenames containing a query or matching a query fragment in the workspace directory tree.',
  'shell.txt': `\${intro}

Environment:
- OS: \${os}
- Shell: \${shell}
- Temp dir: \${tmp}

\${workdirSection}

\${commandSection}

Git guidance:
- Use \${gitCommands} for all git and version control operations.
- Only use \${gitCommandRestriction} for git operations.
- \${createPrInstruction}
  Example:
    \${createPrExample}`,
  'webfetch.txt': 'Fetch raw content from a public URL and convert it to clean markdown, text, or HTML. Useful for looking up docs or APIs.',
  'write.txt': 'Write new content to a file in the workspace. Overwrites existing files or creates new ones. Requires user approval.',
};

export function getDescription(filename: string, fallback: string): string {
  if (INLINED_DESCRIPTIONS[filename]) {
    return INLINED_DESCRIPTIONS[filename].trim();
  }
  try {
    const textPath = path.resolve(__dirname, filename);
    if (fs.existsSync(textPath)) {
      return fs.readFileSync(textPath, 'utf8').trim();
    }
    // Fallback search relative to cwd (development / workspace dev running)
    const srcPath = path.resolve(process.cwd(), 'src/tools', filename);
    if (fs.existsSync(srcPath)) {
      return fs.readFileSync(srcPath, 'utf8').trim();
    }
    const relativeSrcPath = path.resolve(process.cwd(), 'packages/aurora-agent/src/tools', filename);
    if (fs.existsSync(relativeSrcPath)) {
      return fs.readFileSync(relativeSrcPath, 'utf8').trim();
    }
  } catch (err) {
    // ignore
  }
  return fallback;
}

