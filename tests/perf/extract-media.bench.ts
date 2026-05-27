import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { bench } from "vitest";

import { extractMedia } from "../../src/core/render/extract-media.js";

const here = dirname(fileURLToPath(import.meta.url));
const media = readFileSync(resolve(here, "_fixtures/media-mixed.md"), "utf8");

bench(
  "extract-media-mixed",
  () => {
    extractMedia(media);
  },
  { iterations: 200, warmupIterations: 20, time: 1000 },
);
