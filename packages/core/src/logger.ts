export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export interface Logger {
  debug(message: string, ...meta: unknown[]): void;
  info(message: string, ...meta: unknown[]): void;
  warn(message: string, ...meta: unknown[]): void;
  error(message: string, ...meta: unknown[]): void;
}

export function createLogger(minLevel: LogLevel = 'info'): Logger {
  const write = (level: LogLevel, message: string, meta: unknown[]): void => {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;
    const prefix = `[${new Date().toISOString()}] [${level.toUpperCase()}]`;
    if (meta.length) console.log(prefix, message, ...meta.map(redactUnknown));
    else console.log(prefix, message);
  };

  return {
    debug: (message, ...meta) => write('debug', message, meta),
    info: (message, ...meta) => write('info', message, meta),
    warn: (message, ...meta) => write('warn', message, meta),
    error: (message, ...meta) => write('error', message, meta),
  };
}

// Keys whose values are always secrets, regardless of nesting depth.
const SECRET_KEY_PATTERN = /token|password|secret|authorization/i;

/** Deep-clones `value`, replacing any object property whose key looks like a secret. */
export function redactObject<T>(value: T): T {
  return redactUnknown(value) as T;
}

function redactUnknown(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redactUnknown);
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_KEY_PATTERN.test(key) ? '[REDACTED]' : redactUnknown(v);
  }
  return out;
}

/** Masks bearer tokens embedded in a plain string (e.g. a logged header line). */
export function redactString(value: string): string {
  return value.replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/g, 'Bearer [REDACTED]');
}
