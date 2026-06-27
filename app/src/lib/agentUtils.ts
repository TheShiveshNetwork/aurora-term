const SENSITIVE_COMMANDS = ["rm -rf", "rm -r /", "rm -rf /", "dd if=", ":(){ :|:& };:", "> /dev/sda", "mkfs.", "format", "fdisk /", "shutdown", "reboot", "init 0", "poweroff"];

export function isSensitiveCommand(cmd: string): boolean {
  return SENSITIVE_COMMANDS.some((s) => cmd.toLowerCase().includes(s.toLowerCase()));
}
