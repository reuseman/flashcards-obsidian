import type { Logger } from "./logger.js";

/**
 * Dev-flag-gated perf tracer.
 *
 * Enabled: each `span` measures `performance.now()` deltas and accumulates
 * into a per-label bucket. `finish()` emits ONE `[perf]` summary log line.
 *
 * Disabled: a true no-op. Every method is an unconditional return — zero
 * timing calls, zero allocations per span, no logger interaction.
 *
 * NOT for cross-run metrics: just "where did this sync spend its time?"
 */
export interface PerfTrace {
  span<T>(label: string, fn: () => Promise<T>): Promise<T>;
  span<T>(label: string, fn: () => T): T;
  childCounter(label: string): { add(ms: number): void };
  finish(): void;
}

interface Bucket {
  count: number;
  totalMs: number;
  maxMs: number;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  // one decimal place for seconds
  return `${(ms / 1000).toFixed(1)}s`;
}

class RealPerfTrace implements PerfTrace {
  private readonly buckets = new Map<string, Bucket>();
  private readonly startedAt: number;
  private finished = false;

  constructor(private readonly logger: Logger, private readonly rootLabel: string) {
    this.startedAt = performance.now();
  }

  private bucket(label: string): Bucket {
    let b = this.buckets.get(label);
    if (!b) {
      b = { count: 0, totalMs: 0, maxMs: 0 };
      this.buckets.set(label, b);
    }
    return b;
  }

  private record(label: string, ms: number): void {
    const b = this.bucket(label);
    b.count += 1;
    b.totalMs += ms;
    if (ms > b.maxMs) b.maxMs = ms;
  }

  span<T>(label: string, fn: () => Promise<T>): Promise<T>;
  span<T>(label: string, fn: () => T): T;
  span<T>(label: string, fn: () => T | Promise<T>): T | Promise<T> {
    const start = performance.now();
    const out = fn();
    if (out && typeof (out as Promise<T>).then === "function") {
      return (out as Promise<T>).then((v) => {
        this.record(label, performance.now() - start);
        return v;
      });
    }
    this.record(label, performance.now() - start);
    return out as T;
  }

  childCounter(label: string): { add(ms: number): void } {
    const b = this.bucket(label);
    return {
      add(ms: number) {
        b.count += 1;
        b.totalMs += ms;
        if (ms > b.maxMs) b.maxMs = ms;
      },
    };
  }

  finish(): void {
    if (this.finished) return;
    this.finished = true;
    const totalMs = performance.now() - this.startedAt;
    const parts: string[] = [];
    for (const [label, b] of this.buckets) {
      // Include max only when count > 1 and there's spread worth noting.
      // Keep format compact and stable: "label: TOTAL (xN[, max Mms])".
      const head = `${label}: ${formatMs(b.totalMs)} (x${b.count}`;
      const tail = b.count > 1 ? `, max ${formatMs(b.maxMs)})` : `)`;
      parts.push(head + tail);
    }
    const line = `[perf] ${this.rootLabel} ${formatMs(totalMs)} — ${parts.join(", ")}`;
    this.logger.info(line);
  }
}

class NoopPerfTrace implements PerfTrace {
  span<T>(label: string, fn: () => Promise<T>): Promise<T>;
  span<T>(label: string, fn: () => T): T;
  span<T>(_label: string, fn: () => T | Promise<T>): T | Promise<T> {
    return fn();
  }
  childCounter(): { add(ms: number): void } {
    return NOOP_COUNTER;
  }
  finish(): void {}
}

const NOOP_COUNTER = { add(_ms: number) {} };
const SHARED_NOOP = new NoopPerfTrace();

export function createPerfTrace(
  logger: Logger,
  enabled: boolean,
  rootLabel = "syncVault",
): PerfTrace {
  if (!enabled) return SHARED_NOOP;
  return new RealPerfTrace(logger, rootLabel);
}

export function createNoopPerfTrace(): PerfTrace {
  return SHARED_NOOP;
}
