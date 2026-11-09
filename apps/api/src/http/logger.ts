/* eslint-disable no-console -- this is the API's logger */
/**
 * Small logger: one line per message, `<time> <LEVEL> [Context] message`, to stdout (log, debug) or
 * stderr (warn, error). CloudWatch takes the lines as they are. LOG_LEVEL=silent turns it off (tests
 * can set it); LOG_LEVEL=debug adds debug lines.
 */
type Level = 'debug' | 'log' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 0, log: 1, warn: 2, error: 3 };

function threshold(): number {
  const v = (process.env.LOG_LEVEL ?? 'log').toLowerCase();
  if (v === 'silent' || v === 'off') return 99;
  return ORDER[(v === 'info' ? 'log' : v) as Level] ?? ORDER.log;
}

function write(level: Level, context: string | undefined, message: unknown, extra: unknown[]) {
  if (ORDER[level] < threshold()) return;
  const text =
    message instanceof Error ? (message.stack ?? message.message) : typeof message === 'string' ? message : JSON.stringify(message);
  const line = `${new Date().toISOString()} ${level === 'log' ? 'LOG' : level.toUpperCase()}${context ? ` [${context}]` : ''} ${text}`;
  const rest = extra.filter((e) => e !== undefined).map((e) => (e instanceof Error ? (e.stack ?? e.message) : String(e)));
  if (level === 'error' || level === 'warn') console.error(line, ...rest);
  else console.log(line, ...rest);
}

export class Logger {
  constructor(private readonly context?: string) {}

  log(message: unknown, ...extra: unknown[]) {
    write('log', this.context, message, extra);
  }

  debug(message: unknown, ...extra: unknown[]) {
    write('debug', this.context, message, extra);
  }

  verbose(message: unknown, ...extra: unknown[]) {
    write('debug', this.context, message, extra);
  }

  warn(message: unknown, ...extra: unknown[]) {
    write('warn', this.context, message, extra);
  }

  error(message: unknown, ...extra: unknown[]) {
    write('error', this.context, message, extra);
  }
}
