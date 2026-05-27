import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { bench } from "vitest";

/**
 * Production media hashing path (see src/adapters/obsidian/media-resolver.ts):
 *   crypto.subtle.digest("SHA-1", bytes.buffer)
 * Mirror that here against the 1 MiB fixture.
 */
const here = dirname(fileURLToPath(import.meta.url));
const bytes = readFileSync(resolve(here, "_fixtures/1mb-binary.bin"));

bench(
  "sha1-1mb",
  async () => {
    const copy = new Uint8Array(bytes);
    await crypto.subtle.digest("SHA-1", copy.buffer);
  },
  { iterations: 100, warmupIterations: 10, time: 1000 },
);
