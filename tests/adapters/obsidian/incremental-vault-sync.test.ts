import { describe, expect, it, vi } from "vitest";

import { prepareIncrementalVaultSync } from "../../../src/adapters/obsidian/incremental-vault-sync.js";
import type { AnkiGateway } from "../../../src/application/ports.js";
import { computeRenderedFieldsHash } from "../../../src/core/edits/card-hash.js";
import { ANKI_MODEL_BASIC } from "../../../src/core/render/render-card.js";

function createFixture() {
  const stored = new Map<string, string>();
  const adapter = {
    exists: vi.fn(async (path: string) => stored.has(path)),
    read: vi.fn(async (path: string) => stored.get(path)!),
    write: vi.fn(async (path: string, value: string) => {
      stored.set(path, value);
    }),
  };
  const descriptors = [
    { file: {}, mtime: 10, name: "Plain", path: "Plain.md", size: 20 },
    { file: {}, mtime: 11, name: "Cards", path: "Cards.md", size: 21 },
  ];
  const readMarkdownNote = vi.fn(async (descriptor: (typeof descriptors)[number]) => ({
    file: descriptor.file,
    markdown: descriptor.path === "Plain.md" ? "Just prose" : "Q::A",
    name: descriptor.name,
    path: descriptor.path,
  }));
  const repository = {
    listMarkdownNotes: vi.fn(async () => descriptors),
    readMarkdownNote,
  };

  return { adapter, descriptors, readMarkdownNote, repository, stored };
}

const results = [
  { notePath: "Plain.md", parsedCardCount: 0, status: "skipped" as const },
  { notePath: "Cards.md", parsedCardCount: 1, status: "ok" as const },
];

async function notePaths(notes: AsyncIterable<{ path: string }>): Promise<string[]> {
  const paths: string[] = [];
  for await (const note of notes) paths.push(note.path);
  return paths;
}

const liveFields = {
  Back: "<p>A</p>",
  Context: "",
  Front: "<p>Q</p>",
  Source: "source",
};

function createAnkiGateway(options: {
  fields?: Record<string, string>;
  nid?: number;
  tags?: string[];
} = {}) {
  const nid = options.nid ?? 1_788_000_000_001;
  const fields = options.fields ?? liveFields;
  const notesInfo = vi.fn(async () => [{
    cards: [2_788_000_000_001],
    fields: Object.fromEntries(
      Object.entries(fields).map(([name, value], order) => [
        name,
        { order, value },
      ]),
    ),
    modelName: ANKI_MODEL_BASIC,
    noteId: nid,
    tags: options.tags ?? ["obsidian"],
  }]);
  const cardsInfo = vi.fn(async () => [{
    cardId: 2_788_000_000_001,
    deckName: "Default",
    note: nid,
  }]);
  return {
    client: { cardsInfo, notesInfo } as unknown as AnkiGateway,
    cardsInfo,
    notesInfo,
  };
}

function cardCacheResult() {
  return {
    cacheCandidate: {
      atomicCues: [],
      cards: [{
        deckName: "Default",
        fieldsHash: computeRenderedFieldsHash(liveFields),
        modelName: ANKI_MODEL_BASIC,
        nid: 1_788_000_000_001,
        sourceTags: ["obsidian"],
      }],
    },
    lints: [],
    notePath: "Cards.md",
    parsedCardCount: 1,
    status: "ok" as const,
  };
}

describe("prepareIncrementalVaultSync", () => {
  it("skips a confirmed card-free note on the next vault sync", async () => {
    const fixture = createFixture();
    const first = await prepareIncrementalVaultSync({
      adapter: fixture.adapter,
      indexPath: ".obsidian/plugins/flashcards/vault-scan-index.json",
      repository: fixture.repository,
      settingsKey: "settings-a",
    });
    await first.finish(results);
    fixture.readMarkdownNote.mockClear();

    const second = await prepareIncrementalVaultSync({
      adapter: fixture.adapter,
      indexPath: ".obsidian/plugins/flashcards/vault-scan-index.json",
      repository: fixture.repository,
      settingsKey: "settings-a",
    });

    expect(await notePaths(second.notes)).toEqual(["Cards.md"]);
    expect(second.skippedUnchangedNoteCount).toBe(1);
    expect(fixture.readMarkdownNote).toHaveBeenCalledOnce();
  });

  it("reads a formerly card-free note again after the file changes", async () => {
    const fixture = createFixture();
    const first = await prepareIncrementalVaultSync({
      adapter: fixture.adapter,
      indexPath: "index.json",
      repository: fixture.repository,
      settingsKey: "settings-a",
    });
    await first.finish(results);
    fixture.descriptors[0]!.mtime = 12;

    const second = await prepareIncrementalVaultSync({
      adapter: fixture.adapter,
      indexPath: "index.json",
      repository: fixture.repository,
      settingsKey: "settings-a",
    });

    expect(await notePaths(second.notes)).toEqual([
      "Plain.md",
      "Cards.md",
    ]);
    expect(second.skippedUnchangedNoteCount).toBe(0);
  });

  it("invalidates card-free entries when synchronization settings change", async () => {
    const fixture = createFixture();
    const first = await prepareIncrementalVaultSync({
      adapter: fixture.adapter,
      indexPath: "index.json",
      repository: fixture.repository,
      settingsKey: "settings-a",
    });
    await first.finish(results);

    const second = await prepareIncrementalVaultSync({
      adapter: fixture.adapter,
      indexPath: "index.json",
      repository: fixture.repository,
      settingsKey: "settings-b",
    });

    expect(await notePaths(second.notes)).toHaveLength(2);
    expect(second.skippedUnchangedNoteCount).toBe(0);
  });

  it("falls back to a full scan when the disposable index is invalid", async () => {
    const fixture = createFixture();
    fixture.stored.set("index.json", "not json");

    const scan = await prepareIncrementalVaultSync({
      adapter: fixture.adapter,
      indexPath: "index.json",
      repository: fixture.repository,
      settingsKey: "settings-a",
    });

    expect(await notePaths(scan.notes)).toHaveLength(2);
    expect(scan.skippedUnchangedNoteCount).toBe(0);
  });

  it("does not skip a card-free note that produced a parser warning", async () => {
    const fixture = createFixture();
    const first = await prepareIncrementalVaultSync({
      adapter: fixture.adapter,
      indexPath: "index.json",
      repository: fixture.repository,
      settingsKey: "settings-a",
    });
    await first.finish([
      {
        lints: ["warn: malformed card syntax"],
        notePath: "Plain.md",
        parsedCardCount: 0,
        status: "skipped",
      },
      { ...results[1]!, lints: [] },
    ]);

    const second = await prepareIncrementalVaultSync({
      adapter: fixture.adapter,
      indexPath: "index.json",
      repository: fixture.repository,
      settingsKey: "settings-a",
    });

    expect(await notePaths(second.notes)).toHaveLength(2);
    expect(second.skippedUnchangedNoteCount).toBe(0);
  });

  it("skips an unchanged card note only after batched live verification", async () => {
    const fixture = createFixture();
    const first = await prepareIncrementalVaultSync({
      adapter: fixture.adapter,
      indexPath: "index.json",
      repository: fixture.repository,
      settingsKey: "settings-a",
    });
    await first.finish([
      { ...results[0]!, lints: [] },
      cardCacheResult(),
    ]);
    fixture.readMarkdownNote.mockClear();
    const anki = createAnkiGateway();

    const second = await prepareIncrementalVaultSync({
      adapter: fixture.adapter,
      ankiClient: anki.client,
      indexPath: "index.json",
      repository: fixture.repository,
      settingsKey: "settings-a",
    });

    expect(await notePaths(second.notes)).toEqual([]);
    expect(second.skippedUnchangedCardNoteCount).toBe(1);
    expect(second.skippedUnchangedNoteCount).toBe(2);
    expect(fixture.readMarkdownNote).not.toHaveBeenCalled();
    expect(anki.notesInfo).toHaveBeenCalledOnce();
    expect(anki.cardsInfo).toHaveBeenCalledOnce();
  });

  it("takes the full path when an unchanged card has live field drift", async () => {
    const fixture = createFixture();
    const first = await prepareIncrementalVaultSync({
      adapter: fixture.adapter,
      indexPath: "index.json",
      repository: fixture.repository,
      settingsKey: "settings-a",
    });
    await first.finish([
      { ...results[0]!, lints: [] },
      cardCacheResult(),
    ]);
    const anki = createAnkiGateway({
      fields: { ...liveFields, Front: "edited only in Anki" },
    });

    const second = await prepareIncrementalVaultSync({
      adapter: fixture.adapter,
      ankiClient: anki.client,
      indexPath: "index.json",
      repository: fixture.repository,
      settingsKey: "settings-a",
    });

    expect(await notePaths(second.notes)).toEqual(["Cards.md"]);
    expect(second.skippedUnchangedCardNoteCount).toBe(0);
  });

  it("preserves review tags but treats other Anki-only tags as drift", async () => {
    const fixture = createFixture();
    const first = await prepareIncrementalVaultSync({
      adapter: fixture.adapter,
      indexPath: "index.json",
      repository: fixture.repository,
      settingsKey: "settings-a",
    });
    await first.finish([
      { ...results[0]!, lints: [] },
      cardCacheResult(),
    ]);

    const reviewTags = createAnkiGateway({ tags: ["obsidian", "leech"] });
    const reviewScan = await prepareIncrementalVaultSync({
      adapter: fixture.adapter,
      ankiClient: reviewTags.client,
      indexPath: "index.json",
      repository: fixture.repository,
      settingsKey: "settings-a",
    });
    expect(await notePaths(reviewScan.notes)).toEqual([]);

    const authoredDrift = createAnkiGateway({
      tags: ["obsidian", "anki-only"],
    });
    const driftScan = await prepareIncrementalVaultSync({
      adapter: fixture.adapter,
      ankiClient: authoredDrift.client,
      indexPath: "index.json",
      repository: fixture.repository,
      settingsKey: "settings-a",
    });
    expect(await notePaths(driftScan.notes)).toEqual(["Cards.md"]);
  });
});
