export type InputMode = "command" | "natural-language" | "unknown";
export type ShellType = "powershell" | "bash";

let AVAILABLE_COMMANDS: Set<string> | null = null;

export function setAvailableCommands(commands: string[]): void {
  AVAILABLE_COMMANDS = new Set(commands);
}

export function getAvailableCommands(): Set<string> | null {
  return AVAILABLE_COMMANDS;
}

const SHELL_OPERATORS = /[|><;&$`!(){}]|&&|\|\||2>&1|2>|1>|\$\(|`/;

const POWERSHELL_CMDLET = /^[A-Za-z]+-[A-Za-z]+(\-[A-Za-z]+)?$/;

const BASH_COMMANDS = new Set([
  "ls", "cd", "pwd", "mkdir", "rmdir", "rm", "cp", "mv", "cat", "less", "more",
  "head", "tail", "echo", "printf", "touch", "chmod", "chown", "ln", "find",
  "grep", "sed", "awk", "sort", "uniq", "wc", "cut", "tr", "tee", "diff",
  "git", "npm", "pnpm", "yarn", "bun", "npx", "node", "deno", "bunx",
  "cargo", "rustc", "go", "python", "python3", "pip", "pip3", "java", "javac",
  "mvn", "gradle", "docker", "docker-compose", "kubectl", "helm",
  "ssh", "scp", "rsync", "curl", "wget", "ftp", "sftp",
  "ps", "top", "htop", "kill", "pkill", "bg", "fg", "jobs",
  "ping", "traceroute", "nslookup", "dig", "netstat", "ss", "ip",
  "tar", "gzip", "gunzip", "zip", "unzip", "xz",
  "make", "cmake", "nano", "vim", "nvim", "emacs", "code",
  "env", "export", "source", "alias", "unalias", "type", "which", "whereis",
  "history", "clear", "cls", "reset", "exit", "logout", "help",
  "man", "info", "whatis", "apropos",
  "sudo", "su", "whoami", "who", "id", "uname", "neofetch",
  "date", "cal", "uptime", "df", "du", "free", "lscpu", "lsblk",
  "systemctl", "journalctl", "service", "apt", "apt-get", "yum", "dnf", "pacman",
  "cmd", "powershell", "pwsh", "wsl",
]);

const POWERSHELL_COMMANDS = new Set([
  "ls", "cd", "pwd", "mkdir", "rmdir", "rm", "cp", "mv", "cat", "more",
  "echo", "sort", "where", "diff", "kill", "sleep", "write", "ni", "ri",
  "git", "npm", "pnpm", "yarn", "bun", "npx", "node", "deno", "bunx",
  "cargo", "rustc", "go", "python", "python3", "pip", "pip3", "java", "javac",
  "docker", "docker-compose", "kubectl", "helm",
  "ssh", "scp", "curl", "wget", "ping",
  "code", "powershell", "pwsh", "cmd", "wsl",
  "clear", "cls", "exit", "help", "history", "date",
  "type", "dir", "copy", "move", "del", "ren", "md", "rd",
  "set", "setx", "get-childitem", "get-content", "set-content", "add-content",
  "write-host", "write-output", "read-host",
  "get-process", "stop-process", "get-service",
  "get-command", "get-help", "get-member", "get-date",
  "select-object", "where-object", "foreach-object",
  "new-item", "remove-item", "rename-item",
  "copy-item", "move-item", "set-location", "get-location",
  "clear-host", "invoke-webrequest", "invoke-restmethod",
  "convertto-json", "convertfrom-json",
  "import-module", "export-module", "install-module", "find-module",
  "out-file", "start-job", "receive-job",
  "set-executionpolicy", "get-executionpolicy",
  "select-string", "findstr", "where.exe",
  "write-progress", "write-verbose", "write-debug",
]);

const NL_SOCIAL = /^(hi|hello|hey|thanks|thank you|ty|ok|okay|sure|yes|no|bye|goodbye|cya|lol|haha|nice|great|awesome|cool|fine|good|well)\b/i;

const NL_VERBS = /\b(find|show|tell|explain|help|create|make|build|deploy|run|start|stop|list|search|give|get|add|remove|update|change|modify|generate|convert|transform|translate|install|setup|configure|fix|debug|test|check|monitor|track|analyse|analyze|summarize|summarise|compare|contrast)\b/i;

const QUESTION_STARTS = /^(what|how|why|when|where|who|whose|which|whom|can|could|would|will|shall|should|do|does|did|is|are|was|were|has|have|had|tell|show|explain)\b/i;

function getCommandsForShell(shellType: ShellType): Set<string> {
  return shellType === "powershell" ? POWERSHELL_COMMANDS : BASH_COMMANDS;
}

function startsWithPath(input: string): boolean {
  return /^[.~][\\/]/.test(input) || /^[A-Za-z]:[\\/]/.test(input) || /^\/[a-z]/i.test(input);
}

function containsShellOperator(input: string): boolean {
  return SHELL_OPERATORS.test(input);
}

function hasCommandArgs(words: string[]): boolean {
  for (let i = 1; i < words.length; i++) {
    const w = words[i];
    if (w.startsWith("-")) return true;
    if (/^[.\/~]/.test(w)) return true;
    if (/^["']/.test(w)) return true;
    if (/^[A-Za-z]:[\\/]/.test(w)) return true;
  }
  return false;
}

function isPowerShellCmdlet(word: string): boolean {
  return POWERSHELL_CMDLET.test(word);
}

function hasNLStructure(words: string[]): boolean {
  const secondWord = words[1]?.toLowerCase();
  if (!secondWord) return false;

  if (/^(all|the|a|an|my|me|this|that|these|those|every|each|some|any|your|our|their|its|his|her|how|what|why|when|where|about)\b/i.test(secondWord)) return true;

  const joinedRest = words.slice(1).join(" ");
  if (/\b(modified|changed|created|updated|recent|latest|oldest)\b/i.test(joinedRest)) return true;
  if (/\b(that|which|where)\b/i.test(joinedRest)) return true;
  if (/\b(how\s+(to|do|can|would|could|should|is|are))\b/i.test(joinedRest)) return true;

  return false;
}

function startsWithKnownCommand(input: string, commands: Set<string>): boolean {
  const firstWord = input.split(/\s+/)[0].toLowerCase();
  if (commands.has(firstWord)) return true;
  if (isPowerShellCmdlet(firstWord)) return true;

  const firstTwo = input.split(/\s+/).slice(0, 2).join(" ").toLowerCase();
  return commands.has(firstTwo)
    || /^git\s+(add|commit|push|pull|fetch|clone|init|status|log|diff|checkout|branch|merge|rebase|stash|tag|reset|remote|config)/i.test(input)
    || /^npm\s+(install|run|start|test|build|publish|add|remove|update|init|link|exec)/i.test(input)
    || /^pnpm\s+(install|run|start|test|build|publish|add|remove|update|init|link|exec)/i.test(input)
    || /^docker\s+(run|exec|ps|images|build|pull|push|compose|stop|start|restart|rm|logs|network|volume|system)/i.test(input)
    || /^cargo\s+(build|run|test|check|clean|update|add|remove|new|init|install|publish)/i.test(input)
    || /^kubectl\s+(get|describe|apply|delete|logs|exec|port-forward|create|run|rollout|scale|config)/i.test(input);
}

function isFlagLike(input: string, commands: Set<string>): boolean {
  const words = input.split(/\s+/);
  if (words.length === 1) return false;
  const firstWord = words[0].toLowerCase();
  if (commands.has(firstWord) || isPowerShellCmdlet(firstWord) || AVAILABLE_COMMANDS?.has(firstWord)) return false;
  const flagCount = words.filter(w => /^--?[a-z]/i.test(w)).length;
  return flagCount >= 1 && !QUESTION_STARTS.test(input);
}

function classifyKnownCommand(input: string, words: string[]): InputMode {
  if (words.length <= 3) {
    const second = words[1]?.toLowerCase();
    if (second && /^(me|us|him|her|them|it)\b/i.test(second)) return "natural-language";
    return "command";
  }

  if (hasCommandArgs(words)) return "command";

  if (hasNLStructure(words)) return "natural-language";

  const shellScore = scoreShellIndicators(input);
  const nlScore = scoreNLIndicatorsExcludingVerbs(input);
  if (nlScore > shellScore) return "natural-language";
  return "command";
}

function scoreShellIndicators(input: string): number {
  let score = 0;

  if (containsShellOperator(input)) score += 10;

  const words = input.split(/\s+/);
  if (BASH_COMMANDS.has(words[0]?.toLowerCase()) || POWERSHELL_COMMANDS.has(words[0]?.toLowerCase()) || isPowerShellCmdlet(words[0] ?? "")) score += 5;

  const flagCount = words.filter(w => /^--?[a-z]/i.test(w)).length;
  score += flagCount * 2;

  const pathCount = words.filter(w => /^[.\/\\~]/.test(w) || /^[A-Za-z]:\\/.test(w)).length;
  score += pathCount * 2;

  if (/'/.test(input) || /"/.test(input)) score += 2;

  if (/\$\w+/.test(input)) score += 3;

  if (words.some(w => /^[a-z]+=/i.test(w))) score += 3;

  return score;
}

function scoreNLIndicators(input: string): number {
  let score = 0;

  if (QUESTION_STARTS.test(input)) score += 8;

  const words = input.split(/\s+/);
  if (words.length >= 4) score += 2;

  if (/[?.!]$/.test(input.trim())) score += 3;

  if (NL_VERBS.test(input)) score += 4;

  if (/^(find|show|tell|explain|help|create|make|build|deploy)/i.test(input)) score += 3;

  if (/\b(me|my|the|all|every|each|some|any|this|that|these|those)\b/i.test(input)) score += 1;

  if (/^[A-Z][a-z]+\s/.test(input.trim())) score += 2;

  if (/(\bmodified\b|\bchanged\b|\bcreated\b|\bupdated\b|\brecent\b|\blatest\b|\boldest\b|\blast\s+\w+\b)/i.test(input)) score += 2;

  return score;
}

function scoreNLIndicatorsExcludingVerbs(input: string): number {
  let score = 0;

  if (QUESTION_STARTS.test(input)) score += 8;

  const words = input.split(/\s+/);
  if (words.length >= 4) score += 2;

  if (/[?.!]$/.test(input.trim())) score += 3;

  if (/^(find|show|tell|explain|help|create|make|build|deploy)/i.test(input)) score += 3;

  if (/\b(me|my|the|all|every|each|some|any|this|that|these|those)\b/i.test(input)) score += 1;

  if (/^[A-Z][a-z]+\s/.test(input.trim())) score += 2;

  if (/(\bmodified\b|\bchanged\b|\bcreated\b|\bupdated\b|\brecent\b|\blatest\b|\boldest\b|\blast\s+\w+\b)/i.test(input)) score += 2;

  return score;
}

export function classifyInput(input: string, shellType: ShellType = "bash"): InputMode {
  const trimmed = input.trim();
  if (!trimmed) return "unknown";

  const commands = getCommandsForShell(shellType);

  if (containsShellOperator(trimmed)) return "command";

  if (startsWithPath(trimmed)) return "command";

  const words = trimmed.split(/\s+/);
  const firstWord = words[0]?.toLowerCase();
  if (!firstWord) return "unknown";

  if (firstWord.startsWith("-")) return "command";

  if (NL_SOCIAL.test(trimmed) && words.length <= 3) return "natural-language";

  if (commands.has(firstWord) || isPowerShellCmdlet(firstWord) || AVAILABLE_COMMANDS?.has(firstWord)) {
    return classifyKnownCommand(trimmed, words);
  }

  if (startsWithKnownCommand(trimmed, commands)) return "command";

  if (QUESTION_STARTS.test(trimmed) && words.length >= 2) return "natural-language";

  if (isFlagLike(trimmed, commands)) return "command";

  const shellScore = scoreShellIndicators(trimmed);
  const nlScore = scoreNLIndicators(trimmed);

  if (shellScore >= 5 && shellScore > nlScore) return "command";
  if (nlScore >= 4 && nlScore > shellScore) return "natural-language";

  return "natural-language";
}
