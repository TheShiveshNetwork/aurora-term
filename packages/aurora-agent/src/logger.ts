import { createWriteStream, existsSync, mkdirSync, WriteStream } from 'fs';
import { dirname } from 'path';

type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';
const LOG_WEIGHTS: Record<LogLevel, number> = { trace: 10, debug: 20, info: 30, warn: 40, error: 50 };
const MAX_MEMORY_ENTRIES = 1000;

export interface LogEntry {
  time: string;
  level: LogLevel;
  msg: string;
  context?: Record<string, unknown>;
  err?: { message: string; stack?: string };
}

export type LogSink = (entry: LogEntry) => void;

let configuredLevel: LogLevel = 'debug';
let prettyMode = false;
let sinks: LogSink[] = [];
let memoryBuffer: LogEntry[] = [];
let logFileStream: WriteStream | null = null;

const LEVEL_COLORS: Record<LogLevel, string> = {
  trace: '\x1b[90m',
  debug: '\x1b[36m',
  info: '\x1b[32m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
};
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

export function configureLogger(opts: { level?: LogLevel; pretty?: boolean; logFilePath?: string }) {
  if (opts.level) configuredLevel = opts.level;
  if (opts.pretty !== undefined) prettyMode = opts.pretty;

  // Close previous file stream if reconfiguring
  if (logFileStream) {
    logFileStream.close();
    logFileStream = null;
  }

  if (opts.logFilePath) {
    try {
      const parent = dirname(opts.logFilePath);
      if (!existsSync(parent)) {
        mkdirSync(parent, { recursive: true });
      }
      logFileStream = createWriteStream(opts.logFilePath, { flags: 'a' });
    } catch (err) {
      process.stderr.write(`[logger] Failed to open log file "${opts.logFilePath}": ${err}\n`);
    }
  }
}

export function addSink(sink: LogSink) {
  sinks.push(sink);
}

export function getMemoryLogs(): LogEntry[] {
  return memoryBuffer;
}

export function clearMemoryLogs() {
  memoryBuffer = [];
}

function formatPretty(entry: LogEntry): string {
  const time = new Date(entry.time).toLocaleTimeString('en-US', { hour12: false });
  const color = LEVEL_COLORS[entry.level];
  const levelTag = entry.level.toUpperCase().padEnd(5);
  const ctxStr = entry.context && Object.keys(entry.context).length > 0
    ? ' ' + DIM + JSON.stringify(entry.context, null, 0) + RESET
    : '';
  const errStr = entry.err
    ? `\n${color}  ╰─ ${entry.err.message}${entry.err.stack ? '\n  ' + entry.err.stack.split('\n').slice(0, 4).join('\n  ') : ''}${RESET}`
    : '';

  return `${DIM}${time}${RESET} ${color}${levelTag}${RESET} ${entry.msg}${ctxStr}${errStr}`;
}

export class Logger {
  constructor(private baseCtx?: Record<string, unknown>) {}

  child(ctx: Record<string, unknown>): Logger {
    return new Logger({ ...this.baseCtx, ...ctx });
  }

  trace(msg: string, ctx?: Record<string, unknown>) { this.log('trace', msg, ctx); }
  debug(msg: string, ctx?: Record<string, unknown>) { this.log('debug', msg, ctx); }
  info(msg: string, ctx?: Record<string, unknown>) { this.log('info', msg, ctx); }
  warn(msg: string, ctx?: Record<string, unknown>) { this.log('warn', msg, ctx); }
  error(msg: string, ctx?: Record<string, unknown>) { this.log('error', msg, ctx); }

  private log(level: LogLevel, msg: string, ctx?: Record<string, unknown>) {
    if (LOG_WEIGHTS[level] < LOG_WEIGHTS[configuredLevel]) return;

    const entry: LogEntry = {
      time: new Date().toISOString(),
      level,
      msg,
      context: { ...this.baseCtx, ...ctx },
    };

    // Bound memory buffer to prevent unbounded growth
    memoryBuffer.push(entry);
    if (memoryBuffer.length > MAX_MEMORY_ENTRIES) {
      memoryBuffer.splice(0, memoryBuffer.length - MAX_MEMORY_ENTRIES);
    }

    // Stdout / stderr output
    if (prettyMode) {
      const out = formatPretty(entry);
      switch (level) {
        case 'error': process.stderr.write(out + '\n'); break;
        default: process.stdout.write(out + '\n'); break;
      }
    } else {
      const out = JSON.stringify(entry);
      switch (level) {
        case 'error': process.stderr.write(out + '\n'); break;
        default: process.stdout.write(out + '\n'); break;
      }
    }

    // File output (always JSON, regardless of prettyMode)
    if (logFileStream) {
      logFileStream.write(JSON.stringify(entry) + '\n');
    }

    // Registered sinks (e.g. Mastra bridge, frontend polling)
    for (const sink of sinks) {
      try { sink(entry); } catch { /* ignore sink errors */ }
    }
  }
}

export const rootLogger = new Logger();
