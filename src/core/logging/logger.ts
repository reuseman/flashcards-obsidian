export type LogLevel = "debug" | "info" | "warn" | "error";

export const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export interface Logger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

export class NoopLogger implements Logger {
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
}

export class ConsoleLogger implements Logger {
  constructor(private readonly minLevel: LogLevel = "info") {}

  private enabled(level: LogLevel): boolean {
    return LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[this.minLevel];
  }

  debug(message: string, data?: unknown): void {
    if (this.enabled("debug")) console.log("[Flashcards][DEBUG]", message, data ?? "");
  }
  info(message: string, data?: unknown): void {
    if (this.enabled("info")) console.log("[Flashcards][INFO]", message, data ?? "");
  }
  warn(message: string, data?: unknown): void {
    if (this.enabled("warn")) console.warn("[Flashcards][WARN]", message, data ?? "");
  }
  error(message: string, data?: unknown): void {
    if (this.enabled("error")) console.error("[Flashcards][ERROR]", message, data ?? "");
  }
}

/**
 * Fans out each call to every wrapped logger. Useful for emitting to both
 * console and file at the same min-level.
 */
export class CompositeLogger implements Logger {
  constructor(private readonly loggers: readonly Logger[]) {}

  debug(message: string, data?: unknown): void {
    for (const l of this.loggers) l.debug(message, data);
  }
  info(message: string, data?: unknown): void {
    for (const l of this.loggers) l.info(message, data);
  }
  warn(message: string, data?: unknown): void {
    for (const l of this.loggers) l.warn(message, data);
  }
  error(message: string, data?: unknown): void {
    for (const l of this.loggers) l.error(message, data);
  }
}

/**
 * Formats a log line for file output: ISO timestamp, level, message, and
 * stringified data (if present). One line per call. JSON.stringify is wrapped
 * in try/catch so a circular structure can't crash the logger.
 */
export function formatLogLine(
  level: LogLevel,
  message: string,
  data?: unknown,
): string {
  const ts = new Date().toISOString();
  const head = `${ts} [${level.toUpperCase()}] ${message}`;
  if (data === undefined) return `${head}\n`;
  let payload: string;
  try {
    payload = typeof data === "string" ? data : JSON.stringify(data);
  } catch {
    payload = "[unserializable]";
  }
  return `${head} ${payload}\n`;
}
