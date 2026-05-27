import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { bench } from "vitest";

import { extractCardsFromMarkdown } from "../../src/core/parse/extract-cards.js";
import { DEFAULT_SETTINGS } from "../../src/core/config/settings.js";

const here = dirname(fileURLToPath(import.meta.url));
const inline = readFileSync(resolve(here, "_fixtures/50-inline-cards.md"), "utf8");
const cloze = readFileSync(resolve(here, "_fixtures/20-cloze-cards.md"), "utf8");

const opts = { notePath: "bench/note.md", settings: DEFAULT_SETTINGS };
const benchOpts = { iterations: 100, warmupIterations: 10, time: 1000 };

bench(
  "extract-cards-50-inline",
  () => {
    extractCardsFromMarkdown(inline, opts);
  },
  benchOpts,
);

bench(
  "extract-cards-20-cloze",
  () => {
    extractCardsFromMarkdown(cloze, opts);
  },
  benchOpts,
);
