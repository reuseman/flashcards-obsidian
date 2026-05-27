import { describe, expect, it } from "vitest";

import { compareBenchmarks, type BenchReport } from "../../scripts/bench-compare-lib.ts";

const META = {
  gitSha: "deadbeef",
  nodeVersion: "v22.0.0",
  platform: "linux-x64",
  cpuModel: "Intel(R) Xeon(R) Bench CPU @ 9.99GHz",
  runAt: "2026-01-01T00:00:00Z",
};

function report(benches: Record<string, { mean: number; stddev: number; samples: number }>, meta = META): BenchReport {
  return { meta, benches };
}

describe("compareBenchmarks", () => {
  it("returns ok for unchanged or improved benches", () => {
    const baseline = report({
      "extract-cards-50-inline": { mean: 4.0, stddev: 0.1, samples: 200 },
    });
    const current = report({
      "extract-cards-50-inline": { mean: 3.9, stddev: 0.1, samples: 200 },
    });
    const result = compareBenchmarks(baseline, current);
    expect(result.status).toBe("ok");
    expect(result.regressions).toHaveLength(0);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.verdict).toBe("ok");
  });

  it("flags regression when current > baseline.mean + 2 * baseline.stddev", () => {
    const baseline = report({
      "render-card-basic": { mean: 1.0, stddev: 0.05, samples: 200 },
    });
    // 1.0 + 2*0.05 = 1.10 ; 1.5 is well above the threshold.
    const current = report({
      "render-card-basic": { mean: 1.5, stddev: 0.05, samples: 200 },
    });
    const result = compareBenchmarks(baseline, current);
    expect(result.status).toBe("regressed");
    expect(result.regressions).toEqual(["render-card-basic"]);
    expect(result.rows[0]?.verdict).toBe("REGRESSED >2σ");
  });

  it("refuses to compare across different hardware", () => {
    const baseline = report(
      { "x": { mean: 1, stddev: 0.1, samples: 100 } },
      { ...META, cpuModel: "Different CPU" },
    );
    const current = report({ "x": { mean: 1, stddev: 0.1, samples: 100 } });
    expect(() => compareBenchmarks(baseline, current)).toThrow(/different hardware/i);
  });

  it("refuses to compare across different platforms", () => {
    const baseline = report(
      { "x": { mean: 1, stddev: 0.1, samples: 100 } },
      { ...META, platform: "darwin-arm64" },
    );
    const current = report({ "x": { mean: 1, stddev: 0.1, samples: 100 } });
    expect(() => compareBenchmarks(baseline, current)).toThrow(/different hardware/i);
  });

  it("treats missing baseline benches as new (not a regression)", () => {
    const baseline = report({
      "a": { mean: 1, stddev: 0.1, samples: 100 },
    });
    const current = report({
      "a": { mean: 1, stddev: 0.1, samples: 100 },
      "b": { mean: 2, stddev: 0.1, samples: 100 },
    });
    const result = compareBenchmarks(baseline, current);
    expect(result.status).toBe("ok");
    const bRow = result.rows.find((r) => r.name === "b");
    expect(bRow?.verdict).toBe("new");
  });
});
