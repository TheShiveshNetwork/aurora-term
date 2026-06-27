const ANSI_REGEX = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;

const SENTINEL_CWD = "__AURORA_CWD__";
const SENTINEL_BRANCH = "__AURORA_BRANCH__";
const SENTINEL_PROMPT_START = "__AURORA_PROMPT_START__";
const SENTINEL_PROMPT_END = "__AURORA_PROMPT_END__";

export function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, "");
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

export const CWD_SENTINEL = SENTINEL_CWD;
export const BRANCH_SENTINEL = SENTINEL_BRANCH;
