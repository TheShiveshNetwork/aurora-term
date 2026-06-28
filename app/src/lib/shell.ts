export const SHELL_PROMPT_COMMAND = `function prompt { $cwd = $ExecutionContext.SessionState.Path.CurrentLocation; "__AURORA_PROMPT_START__" + [char]13 + [char]10 + "__AURORA_CWD__=$cwd" + [char]13 + [char]10 + "__AURORA_PROMPT_END__"; return ' ' }; Clear-Host`;

export function isWindowsPlatform(): boolean {
  return window.navigator.userAgent.includes("Windows");
}

export function getDefaultShellLaunch() {
  const isWin = isWindowsPlatform();
  const shell = isWin ? "powershell.exe" : "bash";
  const args = isWin ? ["-NoLogo", "-NoExit", "-Command", SHELL_PROMPT_COMMAND] : [];

  return { shell, args };
}

export function buildCwdLabel(cwdAbsolute: string): string {
  const parts = cwdAbsolute.split(/[\\/]/).filter(Boolean);
  return `~/${parts[parts.length - 1] || cwdAbsolute || "workspace"}`;
}