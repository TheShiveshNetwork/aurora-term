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
const CWD_EXIT_RE = /__AURORA_CWD__=([^;\r\n]*)(?:;EXIT_CODE=(\d+))?/;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, "");
}

export interface PtyCleanResult {
  cleanData: string;
  cwdValue: string | null;
  exitCode: number | null;
}

export interface PtyCleanOptions {
  /**
   * Collapse WinPS Clear-Host erase-walk runs (`\x1b[K\r\n` repetitions).
   *
   * WinPS 5.1 `cls` emulates a clear by walking the cursor from its current row
   * to the bottom of the screen, erasing each line. When the walk exactly fills
   * the viewport, xterm scrolls the buffer (baseY >= 1) AFTER the fresh prompt
   * has been written, and WinPS's absolute `\x1b[<row>;<col>H` tail then lands
   * one row below the prompt — so the next command types on its own row,
   * leaving a stranded duplicate prompt line.
   *
   * The app clears the screen locally (terminal-clear → `\x1b[3J\x1b[H\x1b[2J`)
   * before the shell's clear output arrives, so the walk is redundant there:
   * collapsing its runs keeps the buffer from scrolling and the absolute cursor
   * placement aligned with the prompt. Must only be enabled for clear streams
   * that follow a local clear (script-triggered clears still rely on the walk).
   *
   * The collapse is intentionally NOT gated on `\x1b[3J` being present in the
   * same chunk: the clear stream can arrive split across pty reads, and the
   * caller's `collapseClearWalk` flag already encodes "a local clear just
   * happened". The caller is responsible for arming this flag for the whole
   * clear stream (via a short grace window after the sentinel prompt), since a
   * second walk chunk can arrive after the sentinel has been captured.
   */
  collapseClearWalk?: boolean;
}

export function cleanPtyData(data: string, options: PtyCleanOptions = {}): PtyCleanResult {
  let cwdValue: string | null = null;
  let exitCode: number | null = null;

  const cwdMatch = CWD_EXIT_RE.exec(data);
  if (cwdMatch) {
    cwdValue = cwdMatch[1].replace(ANSI_REGEX, "").replace(/\[K$/, "").trim();
    if (cwdMatch[2]) {
      exitCode = parseInt(cwdMatch[2], 10);
    }
  }

  let cleanData = data.replace(CLEAN_LINES_RE, "");

  if (options.collapseClearWalk) {
    cleanData = cleanData.replace(/(?:\x1b\[K\r\n)+/g, "\x1b[K\r\n");
  }

  return { cleanData, cwdValue, exitCode };
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
