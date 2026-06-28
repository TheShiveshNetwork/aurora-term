const ANSI_REGEX = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;

const SENTINEL_CWD = "__AURORA_CWD__";
const SENTINEL_PROMPT_START = "__AURORA_PROMPT_START__";
const SENTINEL_PROMPT_END = "__AURORA_PROMPT_END__";

// Single combined regex for all sentinel/prompt/echo lines (ANSI-preserving)
const CLEAN_LINES_RE = /(?:\r?\n)?(?:__AURORA_PROMPT_START__[^\r\n]*|__AURORA_CWD__[^\r\n]*|__AURORA_PROMPT_END__[^\r\n]*|.*(?:Write-Host|echo)\s+["']?__AURORA_[A-Z_]+__[^\r\n]*)/g;
const PS_PROMPT_RE = /^\r?PS\s*>\s*/gm;
const CONT_PROMPT_RE = /^\r?>+\s*/gm;
const CONT_ONLY_RE = /^\r?>+\s*$/gm;
const OSC133_RE = /\x1b\]133;([A-D])(?:;(\d+))?\x07/g;
const CWD_VALUE_RE = /__AURORA_CWD__=([^\r\n]*)/;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, "");
}

export interface PtyCleanResult {
  cleanData: string;
  cwdValue: string | null;
}

export function cleanPtyData(data: string): PtyCleanResult {
  let cwdValue: string | null = null;

  const cwdMatch = CWD_VALUE_RE.exec(data);
  if (cwdMatch) {
    cwdValue = cwdMatch[1].replace(ANSI_REGEX, "").replace(/\[K$/, "").trim();
  }

  const cleanData = data
    .replace(CLEAN_LINES_RE, "")
    .replace(PS_PROMPT_RE, "")
    .replace(CONT_PROMPT_RE, "")
    .replace(CONT_ONLY_RE, "")
    .trim();

  return { cleanData, cwdValue };
}

export function stripPromptSentinels(text: string): string {
  return text
    .replace(/(?:\r?\n)?__AURORA_PROMPT_START__[^\r\n]*/g, "")
    .replace(/(?:\r?\n)?__AURORA_CWD__[^\r\n]*/g, "")
    .replace(/(?:\r?\n)?__AURORA_BRANCH__[^\r\n]*/g, "")
    .replace(/(?:\r?\n)?__AURORA_PROMPT_END__[^\r\n]*/g, "")
    .trim();
}

export function extractSentinelValue(text: string, sentinel: string): string | null {
  const match = text.match(new RegExp(`${sentinel}=([^\\r\\n]*)`));
  return match ? match[1].trim() : null;
}

export function processOSC133(data: string, callback: (code: string, arg: string | undefined) => void): void {
  let match;
  OSC133_RE.lastIndex = 0;
  while ((match = OSC133_RE.exec(data)) !== null) {
    callback(match[1], match[2]);
  }
}

export function stripOSC133(data: string): string {
  return data.replace(OSC133_RE, "");
}

export const CWD_SENTINEL = SENTINEL_CWD;
