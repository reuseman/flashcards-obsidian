import { format } from "prettier";

import type { MarkdownNote, MarkdownRepository } from "../../src/application/ports.js";
import { previewSyncPlan } from "../../src/application/preview-sync-plan.js";
import { prepareNoteSource } from "../../src/application/sync/prepare-note-source.js";
import { DEFAULT_SETTINGS } from "../../src/core/config/settings.js";
import { computeCardHash } from "../../src/core/edits/card-hash.js";
import { NoopLogger } from "../../src/core/logging/logger.js";
import { createNoopPerfTrace } from "../../src/core/logging/perf-trace.js";
import { extractCardsFromMarkdown } from "../../src/core/parse/extract-cards.js";

const TABLE = [
  "| Item | Detail   |",
  "| ---- | -------- |",
  "| test | ==word== |",
].join("\n");

const NOTE_PATH = "Tables.md";

test("formatting a synced table preserves its identity and produces no replacement or metadata write", async () => {
  const card = extractCardsFromMarkdown(TABLE, {
    notePath: NOTE_PATH,
    settings: DEFAULT_SETTINGS,
  }).cards[0]!;
  const markdown = [
    "---",
    "flashcards:",
    `  q-abcd: { nid: 123, hash: ${computeCardHash(card)} }`,
    "---",
    "",
    TABLE,
    "^q-abcd",
  ].join("\n");
  const formatted = await format(markdown, { parser: "markdown" });
  expect(formatted).toContain(`${TABLE}\n\n^q-abcd`);

  for (const input of [markdown, formatted]) {
    const preview = previewSyncPlan({
      generateBlockId: () => "q-efgh",
      markdown: input,
      notePath: NOTE_PATH,
      settings: DEFAULT_SETTINGS,
    });
    expect(preview.identifiedCards.map((identified) => identified.blockId)).toEqual(["q-abcd"]);
    expect(preview.plan).toEqual({ create: [], delete: [], update: [] });
    expect(preview.insertEdits).toEqual([]);
  }

  const note: MarkdownNote = { file: {}, markdown: formatted, name: "Tables", path: NOTE_PATH };
  const saves: string[] = [];
  const repository: MarkdownRepository = {
    getActiveNote: async () => note,
    getAllMarkdownNotes: async () => [note],
    saveNote: async (_note, saved) => { saves.push(saved); },
  };
  const prepared = await prepareNoteSource({
    generateBlockId: () => "q-efgh",
    logger: new NoopLogger(),
    note,
    repository,
    settings: DEFAULT_SETTINGS,
    trace: createNoopPerfTrace(),
  });
  expect(prepared.plan).toEqual({ create: [], delete: [], update: [] });
  expect(prepared.identityWritesApplied).toBe(0);
  expect(prepared.frontmatter.entries[0]?.nid).toBe(123);
  expect(saves).toEqual([]);
});
