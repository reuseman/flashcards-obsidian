/**
 * Pure comparison logic for bench reports — tested in
 * tests/perf/bench-compare.test.ts. The CLI wrapper lives in
 * scripts/bench-compare.ts.
 */
export interface BenchMetric {
  mean: number;
  stddev: number;
  samples: number;
}

export interface BenchMeta {
  gitSha: string;
  nodeVersion: string;
  platform: string;
  cpuModel: string;
  runAt: string;
}

export interface BenchReport {
  meta: BenchMeta;
  benches: Record<string, BenchMetric>;
}

export type Verdict = "ok" | "REGRESSED >2σ" | "new" | "removed";

export interface CompareRow {
  name: string;
  baseline: BenchMetric | null;
  current: BenchMetric | null;
  deltaPct: number | null;
  verdict: Verdict;
}

export interface CompareResult {
  status: "ok" | "regressed";
  rows: CompareRow[];
  regressions: string[];
}

export function compareBenchmarks(
  baseline: BenchReport,
  current: BenchReport,
): CompareResult {
  if (
    baseline.meta.platform !== current.meta.platform ||
    baseline.meta.cpuModel !== current.meta.cpuModel
  ) {
    throw new Error(
      `different hardware — re-baseline.\n` +
        `  baseline: ${baseline.meta.platform} / ${baseline.meta.cpuModel}\n` +
        `  current:  ${current.meta.platform} / ${current.meta.cpuModel}`,
    );
  }

  const rows: CompareRow[] = [];
  const regressions: string[] = [];

  const names = new Set<string>([
    ...Object.keys(baseline.benches),
    ...Object.keys(current.benches),
  ]);
  for (const name of [...names].sort()) {
    const b = baseline.benches[name] ?? null;
    const c = current.benches[name] ?? null;

    if (b && !c) {
      rows.push({ name, baseline: b, current: null, deltaPct: null, verdict: "removed" });
      continue;
    }
    if (!b && c) {
      rows.push({ name, baseline: null, current: c, deltaPct: null, verdict: "new" });
      continue;
    }
    if (!b || !c) continue;

    const threshold = b.mean + 2 * b.stddev;
    const deltaPct = ((c.mean - b.mean) / b.mean) * 100;
    let verdict: Verdict = "ok";
    if (c.mean > threshold) {
      verdict = "REGRESSED >2σ";
      regressions.push(name);
    }
    rows.push({ name, baseline: b, current: c, deltaPct, verdict });
  }

  return {
    status: regressions.length === 0 ? "ok" : "regressed",
    rows,
    regressions,
  };
}

export function formatRow(row: CompareRow): string {
  const fmt = (m: BenchMetric | null): string =>
    m === null ? "—" : `${m.mean.toFixed(2)}ms ± ${m.stddev.toFixed(2)}ms`;
  const delta =
    row.deltaPct === null
      ? ""
      : `Δ ${row.deltaPct >= 0 ? "+" : ""}${row.deltaPct.toFixed(1)}%`;
  const tag = `[${row.verdict}]`;
  return `${row.name.padEnd(30)}  baseline ${fmt(row.baseline).padEnd(20)}  current ${fmt(row.current).padEnd(20)}  ${delta.padEnd(10)} ${tag}`;
}
