import { bench } from "vitest";

import { renderCardForAnki, type RenderContext } from "../../src/core/render/render-card.js";
import type { IdentifiedFlashcard } from "../../src/core/domain/card.js";

const ctx: RenderContext = {
  deckName: "Default",
  notePath: "bench/note.md",
  tags: ["obsidian", "bench"],
  vaultName: "BenchVault",
};

const basic: IdentifiedFlashcard = {
  answer:
    "An [[obsidian-note]] anchor with **bold** and `code` and a list:\n- item one\n- item two",
  deckName: "Default",
  front: "What is the *capital* of [[France]]?",
  kind: "basic",
  source: { endOffset: 0, line: 1, startOffset: 0, syntax: "inline" },
  tags: ["obsidian"],
  blockId: "abcd1234",
};

const cloze: IdentifiedFlashcard = {
  answer: "",
  deckName: "Default",
  front:
    "The mitochondrion is the {{c1::powerhouse}} of the cell, and ==ATP== is its currency.",
  kind: "cloze",
  source: { endOffset: 0, line: 1, startOffset: 0, syntax: "cloze" },
  tags: ["obsidian"],
  blockId: "efgh5678",
};

const benchOpts = { iterations: 200, warmupIterations: 20, time: 1000 };

bench(
  "render-card-basic",
  () => {
    renderCardForAnki(basic, ctx);
  },
  benchOpts,
);

bench(
  "render-card-cloze",
  () => {
    renderCardForAnki(cloze, ctx);
  },
  benchOpts,
);
