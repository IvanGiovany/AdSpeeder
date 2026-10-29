export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export interface LoggerOptions {
  /** Read on every call, so toggling `settings.debug` takes effect without a reload. */
  isDebug?: () => boolean;
  onEvent?: (level: LogLevel, args: unknown[]) => void;
  sink?: Pick<Console, LogLevel>;
}

/**
 * Prefixes every line with `[AdSpeeder:<scope>]`. `debug` and `info` only print while
 * `isDebug()` is true; `warn` and `error` always print.
 */
export function createLogger(scope: string, options: LoggerOptions = {}): Logger {
  const { isDebug = () => false, sink = console } = options;
  const prefix = `[AdSpeeder:${scope}]`;
  const gated =
    (level: 'debug' | 'info') =>
    (...args: unknown[]): void => {
      if (isDebug()) {
        sink[level](prefix, ...args);
        options.onEvent?.(level, args);
      }
    };
  return {
    debug: gated('debug'),
    info: gated('info'),
    warn: (...args) => {
      sink.warn(prefix, ...args);
      options.onEvent?.('warn', args);
    },
    error: (...args) => {
      sink.error(prefix, ...args);
      options.onEvent?.('error', args);
    },
  };
}
