/**
 * Run vitest benchmarks and post-process the JSON into a stable shape
 * that includes hardware/git metadata. Writes `.perf-current.json`.
 *
 * Shape:
 *   {
 *     meta: { gitSha, nodeVersion, platform, cpuModel, runAt },
 *     benches: { "<bench-id>": { mean, stddev, samples } }
 *   }
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { cpus, platform } from "node:os";
import { resolve } from "node:path";

const RAW = resolve(".perf-current.raw.json");
const OUT = resolve(".perf-current.json");

if (existsSync(RAW)) unlinkSync(RAW);

const result = spawnSync(
  "npx",
  ["vitest", "bench", "--run", `--outputJson=${RAW}`],
  { stdio: "inherit", shell: false },
);
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
if (!existsSync(RAW)) {
  console.error(`vitest did not produce ${RAW}`);
  process.exit(1);
}

interface VitestBenchEntry {
  name: string;
  mean: number;
  sd: number;
  sampleCount: number;
}
interface VitestBenchJson {
  files: Array<{ groups: Array<{ benchmarks: VitestBenchEntry[] }> }>;
}

const raw = JSON.parse(readFileSync(RAW, "utf8")) as VitestBenchJson;
const benches: Record<string, { mean: number; stddev: number; samples: number }> = {};
for (const file of raw.files ?? []) {
  for (const group of file.groups ?? []) {
    for (const b of group.benchmarks ?? []) {
      benches[b.name] = { mean: b.mean, stddev: b.sd, samples: b.sampleCount };
    }
  }
}

function gitSha(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

const out = {
  meta: {
    gitSha: gitSha(),
    nodeVersion: process.version,
    platform: `${platform()}-${process.arch}`,
    cpuModel: cpus()[0]?.model ?? "unknown",
    runAt: new Date().toISOString(),
  },
  benches,
};

writeFileSync(OUT, JSON.stringify(out, null, 2));
unlinkSync(RAW);
console.log(`\nWrote ${OUT} (${Object.keys(benches).length} benches)`);
