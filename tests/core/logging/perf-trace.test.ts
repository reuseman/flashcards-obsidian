import { describe, expect, it, vi } from "vitest";

import {
  createNoopPerfTrace,
  createPerfTrace,
} from "../../../src/core/logging/perf-trace.js";
import type { Logger } from "../../../src/core/logging/logger.js";

function makeLogger(): { logger: Logger; info: ReturnType<typeof vi.fn>; debug: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn>; } {
  const info = vi.fn();
  const debug = vi.fn();
  const warn = vi.fn();
  const error = vi.fn();
  return {
    info,
    debug,
    warn,
    error,
    logger: { info, debug, warn, error },
  };
}

describe("perf-trace", () => {
  describe("createPerfTrace (enabled)", () => {
    it("span returns the inner value for sync functions", () => {
      const { logger } = makeLogger();
      const trace = createPerfTrace(logger, true);
      const result = trace.span("extract", () => 42);
      expect(result).toBe(42);
    });

    it("span returns the inner value for async functions", async () => {
      const { logger } = makeLogger();
      const trace = createPerfTrace(logger, true);
      const result = await trace.span("extract", async () => "abc");
      expect(result).toBe("abc");
    });

    it("finish emits exactly one info call with [perf] summary", () => {
      const { logger, info } = makeLogger();
      const trace = createPerfTrace(logger, true);
      trace.span("extract", () => 1);
      trace.span("anki.sync", () => 2);
      expect(info).not.toHaveBeenCalled();
      trace.finish();
      expect(info).toHaveBeenCalledTimes(1);
      const msg = String(info.mock.calls[0]![0]);
      expect(msg.startsWith("[perf] ")).toBe(true);
      expect(msg).toContain("extract:");
      expect(msg).toContain("anki.sync:");
    });

    it("childCounter accumulates totals and count, surfaced in finish output", () => {
      const { logger, info } = makeLogger();
      const trace = createPerfTrace(logger, true);
      const c = trace.childCounter("media.upload");
      c.add(100);
      c.add(120);
      c.add(80);
      trace.finish();
      const msg = String(info.mock.calls[0]![0]);
      expect(msg).toMatch(/media\.upload: 300ms \(x3/);
    });

    it("formats: 1500 ms as 1.5s, 80 ms as 80ms", () => {
      const { logger, info } = makeLogger();
      const trace = createPerfTrace(logger, true);
      const a = trace.childCounter("slow");
      a.add(1500);
      const b = trace.childCounter("fast");
      b.add(80);
      trace.finish();
      const msg = String(info.mock.calls[0]![0]);
      expect(msg).toContain("slow: 1.5s");
      expect(msg).toContain("fast: 80ms");
    });

    it("tracks span counts and max independently", () => {
      const { logger, info } = makeLogger();
      const trace = createPerfTrace(logger, true);
      trace.span("phase", () => 1);
      trace.span("phase", () => 1);
      trace.span("phase", () => 1);
      trace.finish();
      const msg = String(info.mock.calls[0]![0]);
      expect(msg).toMatch(/phase: .* \(x3/);
    });
  });

  describe("createNoopPerfTrace (disabled)", () => {
    it("span returns the inner value (sync)", () => {
      const trace = createNoopPerfTrace();
      expect(trace.span("x", () => 7)).toBe(7);
    });

    it("span returns the inner value (async)", async () => {
      const trace = createNoopPerfTrace();
      expect(await trace.span("x", async () => 9)).toBe(9);
    });

    it("logger is never called: finish does not emit", () => {
      const { logger, info, debug, warn, error } = makeLogger();
      // createPerfTrace(logger, false) returns the no-op
      const trace = createPerfTrace(logger, false);
      trace.span("x", () => 1);
      trace.childCounter("y").add(50);
      trace.finish();
      expect(info).not.toHaveBeenCalled();
      expect(debug).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    });
  });
});
