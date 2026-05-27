import type { DataAdapter } from "obsidian";
import {
  LOG_LEVEL_ORDER,
  formatLogLine,
  type LogLevel,
  type Logger,
} from "../../core/logging/logger.js";

const DEFAULT_MAX_BYTES = 1_000_000;

/**
 * Appends to a single rolling log file inside the plugin's config folder.
 *
 * Writes are serialised through `writeChain` so concurrent logger calls land
 * in order. Failures are swallowed (the logger must never crash the plugin).
 * When the file exceeds `maxBytes`, it's truncated to the last half on the
 * next append — a deliberately crude cap to avoid log-rotation complexity.
 */
export class ObsidianFileLogger implements Logger {
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly adapter: DataAdapter,
    private readonly path: string,
    private readonly minLevel: LogLevel = "info",
    private readonly maxBytes: number = DEFAULT_MAX_BYTES,
  ) {}

  private enabled(level: LogLevel): boolean {
    return LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[this.minLevel];
  }

  private enqueue(level: LogLevel, message: string, data?: unknown): void {
    if (!this.enabled(level)) return;
    const line = formatLogLine(level, message, data);
    this.writeChain = this.writeChain
      .then(() => this.append(line))
      .catch(() => {
        /* swallow — logger must never crash the host */
      });
  }

  private async append(line: string): Promise<void> {
    let existing = "";
    try {
      existing = await this.adapter.read(this.path);
    } catch {
      existing = "";
    }
    let next = existing + line;
    if (next.length > this.maxBytes) {
      next = next.slice(Math.floor(next.length / 2));
    }
    await this.adapter.write(this.path, next);
  }

  /** Flush any queued writes — call before plugin unload if you want to wait. */
  flush(): Promise<void> {
    return this.writeChain.catch(() => undefined);
  }

  debug(message: string, data?: unknown): void {
    this.enqueue("debug", message, data);
  }
  info(message: string, data?: unknown): void {
    this.enqueue("info", message, data);
  }
  warn(message: string, data?: unknown): void {
    this.enqueue("warn", message, data);
  }
  error(message: string, data?: unknown): void {
    this.enqueue("error", message, data);
  }
}
