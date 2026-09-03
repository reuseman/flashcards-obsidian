import { describe, expect, it, vi } from "vitest";

import { prepareIncrementalVaultSync } from "../../../src/adapters/obsidian/incremental-vault-sync.js";

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

    expect(second.notes.map((note) => note.path)).toEqual(["Cards.md"]);
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

    expect(second.notes.map((note) => note.path)).toEqual([
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

    expect(second.notes).toHaveLength(2);
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

    expect(scan.notes).toHaveLength(2);
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

    expect(second.notes).toHaveLength(2);
    expect(second.skippedUnchangedNoteCount).toBe(0);
  });
});
