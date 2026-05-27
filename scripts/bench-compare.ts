/**
 * CLI: diff `.perf-baseline.json` against `.perf-current.json`.
 * Exit 0 → no regressions; 1 → regression(s) or hardware mismatch / missing files.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  compareBenchmarks,
  formatRow,
  type BenchReport,
} from "./bench-compare-lib.ts";

const BASELINE = resolve(".perf-baseline.json");
const CURRENT = resolve(".perf-current.json");

if (!existsSync(BASELINE)) {
  console.error(
    `Missing ${BASELINE}. Capture one with:\n  npm run bench && npm run bench:baseline`,
  );
  process.exit(1);
}
if (!existsSync(CURRENT)) {
  console.error(`Missing ${CURRENT}. Run \`npm run bench\` first.`);
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(BASELINE, "utf8")) as BenchReport;
const current = JSON.parse(readFileSync(CURRENT, "utf8")) as BenchReport;

let result;
try {
  result = compareBenchmarks(baseline, current);
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

console.log(`Baseline: ${baseline.meta.gitSha}  (${baseline.meta.runAt})`);
console.log(`Current:  ${current.meta.gitSha}  (${current.meta.runAt})`);
console.log(`Hardware: ${current.meta.platform} / ${current.meta.cpuModel}`);
console.log("");
for (const row of result.rows) {
  console.log(formatRow(row));
}
console.log("");

if (result.status === "regressed") {
  console.error(`✗ ${result.regressions.length} regression(s): ${result.regressions.join(", ")}`);
  process.exit(1);
}
console.log("✓ no regressions");
