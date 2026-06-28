// PowerShell prompt decorator command:
// 1. Retrieves the script block of the existing prompt function (e.g. Oh My Posh, Starship, or the default prompt).
// 2. Wraps it in our new prompt function, printing the silent CWD/exit-code sentinel, and then invoking the original script block.
// 3. If no original prompt function was resolved, falls back to printing the current location and a single '>'.
export const SHELL_PROMPT_COMMAND = `$global:auroraOriginalPrompt = (Get-Command prompt -ErrorAction SilentlyContinue).ScriptBlock; function prompt { Write-Host ('__AURORA_CWD__=' + $ExecutionContext.SessionState.Path.CurrentLocation + ';EXIT_CODE=' + $global:LastExitCode); if ($global:auroraOriginalPrompt) { & $global:auroraOriginalPrompt } else { return ($ExecutionContext.SessionState.Path.CurrentLocation + '> ') } }; Clear-Host`;

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