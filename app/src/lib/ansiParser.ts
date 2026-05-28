/**
 * ansiParser.ts
 *
 * A lightweight, stateful ANSI/VT100 escape-sequence parser.
 * Converts raw PTY byte streams into arrays of StyledLine objects
 * that the custom OutputRenderer can display as React spans.
 *
 * Supported:
 *   - SGR colour/style codes (\x1b[...m) — 3/4-bit, 256-colour, true-colour
 *   - \r\n and bare \r (carriage-return overwrites current line)
 *   - \b (backspace — removes last character)
 *   - \x1b[2J / \x1b[H / \x1b[3J (clear screen variants)
 *   - \x07 (BEL — ignored)
 *
 * Explicitly stripped (not rendered, not stored):
 *   - Cursor movement sequences (\x1b[A/B/C/D, \x1b[H, \x1b[f, \x1b[?...)
 *   - Private DEC sequences
 *   - OSC sequences (\x1b]...\x07 — title, hyperlink, etc.)
 */

// ─── Public types ─────────────────────────────────────────────────────────────

export interface AnsiSpan {
  text: string;
  fg?: string;       // CSS colour string or undefined (inherit)
  bg?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  blink?: boolean;
}

export interface StyledLine {
  spans: AnsiSpan[];
}

// ─── Internal parser state ────────────────────────────────────────────────────

export interface ParserState {
  // Current SGR attributes
  fg?: string;
  bg?: string;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  blink: boolean;

  // Partial escape sequence accumulator
  escBuf: string;
  inEscape: boolean;
  inOsc: boolean;
}

export function createParserState(): ParserState {
  return {
    bold: false,
    dim: false,
    italic: false,
    underline: false,
    strikethrough: false,
    blink: false,
    escBuf: "",
    inEscape: false,
    inOsc: false,
  };
}

// ─── 3/4-bit ANSI colour table ────────────────────────────────────────────────

const ANSI_COLOURS_NORMAL = [
  "#1e1e2e", // 0 black
  "#f38ba8", // 1 red
  "#a6e3a1", // 2 green
  "#f9e2af", // 3 yellow
  "#89b4fa", // 4 blue
  "#cba6f7", // 5 magenta
  "#89dceb", // 6 cyan
  "#cdd6f4", // 7 white
];

const ANSI_COLOURS_BRIGHT = [
  "#585b70", // 8  bright black (grey)
  "#f38ba8", // 9  bright red
  "#a6e3a1", // 10 bright green
  "#f9e2af", // 11 bright yellow
  "#89b4fa", // 12 bright blue
  "#cba6f7", // 13 bright magenta
  "#89dceb", // 14 bright cyan
  "#ffffff", // 15 bright white
];

// ─── 256-colour palette ───────────────────────────────────────────────────────

function ansi256ToHex(n: number): string {
  if (n < 8)  return ANSI_COLOURS_NORMAL[n];
  if (n < 16) return ANSI_COLOURS_BRIGHT[n - 8];

  if (n < 232) {
    // 6×6×6 colour cube
    const i = n - 16;
    const b = i % 6;
    const g = Math.floor(i / 6) % 6;
    const r = Math.floor(i / 36);
    const toHex = (v: number) => Math.round(v ? 55 + v * 40 : 0).toString(16).padStart(2, "0");
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  // Greyscale ramp
  const v = Math.round(8 + (n - 232) * 10.2);
  const hex = v.toString(16).padStart(2, "0");
  return `#${hex}${hex}${hex}`;
}

// ─── SGR parser ───────────────────────────────────────────────────────────────

function applySgr(params: number[], state: ParserState): void {
  if (params.length === 0) params = [0];

  let i = 0;
  while (i < params.length) {
    const p = params[i];

    switch (true) {
      case p === 0:
        state.fg = undefined; state.bg = undefined;
        state.bold = state.dim = state.italic = state.underline =
          state.strikethrough = state.blink = false;
        break;
      case p === 1: state.bold = true; break;
      case p === 2: state.dim = true; break;
      case p === 3: state.italic = true; break;
      case p === 4: state.underline = true; break;
      case p === 5: case p === 6: state.blink = true; break;
      case p === 9: state.strikethrough = true; break;
      case p === 22: state.bold = false; state.dim = false; break;
      case p === 23: state.italic = false; break;
      case p === 24: state.underline = false; break;
      case p === 25: state.blink = false; break;
      case p === 29: state.strikethrough = false; break;
      case p === 39: state.fg = undefined; break;
      case p === 49: state.bg = undefined; break;

      // Standard fg (30-37) and bright fg (90-97)
      case p >= 30 && p <= 37: state.fg = ANSI_COLOURS_NORMAL[p - 30]; break;
      case p >= 90 && p <= 97: state.fg = ANSI_COLOURS_BRIGHT[p - 90]; break;

      // Standard bg (40-47) and bright bg (100-107)
      case p >= 40 && p <= 47: state.bg = ANSI_COLOURS_NORMAL[p - 40]; break;
      case p >= 100 && p <= 107: state.bg = ANSI_COLOURS_BRIGHT[p - 100]; break;

      // 256-colour fg: 38;5;n
      case p === 38 && params[i + 1] === 5:
        if (i + 2 < params.length) { state.fg = ansi256ToHex(params[i + 2]); i += 2; }
        break;

      // True-colour fg: 38;2;r;g;b
      case p === 38 && params[i + 1] === 2:
        if (i + 4 < params.length) {
          const r = params[i + 2], g = params[i + 3], b = params[i + 4];
          state.fg = `rgb(${r},${g},${b})`; i += 4;
        }
        break;

      // 256-colour bg: 48;5;n
      case p === 48 && params[i + 1] === 5:
        if (i + 2 < params.length) { state.bg = ansi256ToHex(params[i + 2]); i += 2; }
        break;

      // True-colour bg: 48;2;r;g;b
      case p === 48 && params[i + 1] === 2:
        if (i + 4 < params.length) {
          const r = params[i + 2], g = params[i + 3], b = params[i + 4];
          state.bg = `rgb(${r},${g},${b})`; i += 4;
        }
        break;

      default: break;
    }
    i++;
  }
}

// ─── Append text to the current line with current style attrs ─────────────────

function pushText(lines: StyledLine[], state: ParserState, text: string): void {
  if (!text) return;
  if (lines.length === 0) lines.push({ spans: [] });

  const line = lines[lines.length - 1];
  const last = line.spans[line.spans.length - 1];

  // Coalesce with the previous span if attributes are identical
  if (
    last &&
    last.fg === state.fg &&
    last.bg === state.bg &&
    !!last.bold === state.bold &&
    !!last.dim === state.dim &&
    !!last.italic === state.italic &&
    !!last.underline === state.underline &&
    !!last.strikethrough === state.strikethrough &&
    !!last.blink === state.blink
  ) {
    last.text += text;
    return;
  }

  line.spans.push({
    text,
    ...(state.fg        ? { fg: state.fg }                 : {}),
    ...(state.bg        ? { bg: state.bg }                 : {}),
    ...(state.bold      ? { bold: true }                    : {}),
    ...(state.dim       ? { dim: true }                     : {}),
    ...(state.italic    ? { italic: true }                  : {}),
    ...(state.underline ? { underline: true }               : {}),
    ...(state.strikethrough ? { strikethrough: true }       : {}),
    ...(state.blink     ? { blink: true }                   : {}),
  });
}

// ─── Process a completed CSI escape sequence ──────────────────────────────────

function handleCsi(seq: string, lines: StyledLine[], state: ParserState): void {
  // SGR — Select Graphic Rendition
  if (seq.endsWith("m")) {
    const inner = seq.slice(0, -1);
    const params = inner === "" ? [0] : inner.split(";").map(Number);
    applySgr(params, state);
    return;
  }

  // Clear screen / erase sequences → we ignore them here to preserve scrollback history.
  // The 'clear' shell command is handled at the App level to reset the UI explicitly.
  if (seq === "2J" || seq === "3J" || seq === "H" || seq === "1;1H") {
    return;
  }

  // All other CSI sequences (cursor movement, etc.) are silently dropped.
}

// ─── Main parse function ──────────────────────────────────────────────────────

/**
 * Parse a PTY data chunk into `lines` (mutates in place).
 * `state` carries over between calls so escape sequences that
 * span chunk boundaries are handled correctly.
 */
export function parseAnsiInto(
  lines: StyledLine[],
  state: ParserState,
  chunk: string
): void {
  if (lines.length === 0) lines.push({ spans: [] });

  for (let i = 0; i < chunk.length; i++) {
    const ch = chunk[i];

    // ── OSC mode ──────────────────────────────────────────────────────────────
    if (state.inOsc) {
      if (ch === "\x07" || (ch === "\\" && state.escBuf.endsWith("\x1b"))) {
        state.inOsc = false;
        state.escBuf = "";
      }
      // consume OSC content
      continue;
    }

    // ── Escape sequence accumulator ───────────────────────────────────────────
    if (state.inEscape) {
      state.escBuf += ch;

      // OSC start: \x1b]
      if (state.escBuf === "]") {
        state.inOsc = true;
        state.escBuf = "";
        continue;
      }

      // CSI start: \x1b[
      if (state.escBuf === "[") continue; // keep accumulating

      // Accumulating CSI parameters (digits, semicolons, ?)
      if (state.escBuf.length > 1 && state.escBuf[0] === "[") {
        const last = ch;
        // Terminator: any letter (A-Z, a-z) or a few specials
        if (/[A-Za-z]/.test(last)) {
          const seq = state.escBuf.slice(1); // strip leading '['
          handleCsi(seq, lines, state);
          state.inEscape = false;
          state.escBuf = "";
        }
        // still accumulating
        continue;
      }

      // 2-char sequences: \x1b= \x1b> \x1bc (reset) etc. — drop silently
      if (state.escBuf.length === 1 && ch !== "[" && ch !== "]") {
        state.inEscape = false;
        state.escBuf = "";
        continue;
      }

      continue;
    }

    // ── Control characters ────────────────────────────────────────────────────
    if (ch === "\x1b") {
      state.inEscape = true;
      state.escBuf = "";
      continue;
    }

    if (ch === "\x07") continue; // BEL — ignore

    if (ch === "\b") {
      // Backspace — trim last character of the last span
      const line = lines[lines.length - 1];
      if (line.spans.length > 0) {
        const last = line.spans[line.spans.length - 1];
        last.text = last.text.slice(0, -1);
        if (!last.text) line.spans.pop();
      }
      continue;
    }

    // ── Carriage return ───────────────────────────────────────────────────────
    if (ch === "\r") {
      // Peek ahead: \r\n is just a newline
      if (chunk[i + 1] === "\n") {
        // handled on \n pass — skip the \r
        continue;
      }
      // Bare \r — overwrite current line (spinner / progress bar)
      lines[lines.length - 1] = { spans: [] };
      continue;
    }

    // ── Newline ───────────────────────────────────────────────────────────────
    if (ch === "\n") {
      lines.push({ spans: [] });
      continue;
    }

    // ── Regular printable character ───────────────────────────────────────────
    pushText(lines, state, ch);
  }
}

// ─── Helper: extract plain text from a StyledLine array (for copy/AI) ─────────

export function styledLinesToText(lines: StyledLine[]): string {
  return lines.map(l => l.spans.map(s => s.text).join("")).join("\n");
}
