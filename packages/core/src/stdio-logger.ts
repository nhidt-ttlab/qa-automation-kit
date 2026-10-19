import { redactObject, type Logger, type LogLevel } from './logger.js';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/**
 * A logger that writes to stderr only.
 *
 * `createLogger` writes via `console.log` -> **stdout**, which is the JSON-RPC transport for a stdio
 * MCP server. A single stray log line there corrupts the frame and the client drops the connection
 * with an opaque parse error, so a stdio server must never use it. `installStdoutGuard` covers the
 * case where a dependency logs on its own.
 */
export function createStderrLogger(minLevel: LogLevel = 'info'): Logger {
  const write = (level: LogLevel, message: string, meta: unknown[]): void => {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;
    const prefix = `[${new Date().toISOString()}] [${level.toUpperCase()}]`;
    if (meta.length) console.error(prefix, message, ...meta.map((m) => redactObject(m)));
    else console.error(prefix, message);
  };

  return {
    debug: (message, ...meta) => write('debug', message, meta),
    info: (message, ...meta) => write('info', message, meta),
    warn: (message, ...meta) => write('warn', message, meta),
    error: (message, ...meta) => write('error', message, meta),
  };
}

/** Redirects any `console.log`/`console.info` (ours or a dependency's) to stderr, so nothing but JSON-RPC reaches stdout. */
export function installStdoutGuard(): void {
  console.log = console.error;
  console.info = console.error;
}
