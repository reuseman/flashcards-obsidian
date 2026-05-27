import { describe, expect, it } from "vitest";

import { syncVault } from "../../src/application/sync-vault.js";
import { AnkiConnectClient } from "../../src/adapters/anki/anki-connect-client.js";
import {
  ANKI_MODEL_BASIC,
  ANKI_MODEL_CLOZE,
  ANKI_MODEL_REVERSED,
} from "../../src/adapters/anki/render-card.js";
import { DEFAULT_SETTINGS } from "../../src/core/config/settings.js";
import type { FlashcardsSettings } from "../../src/core/config/settings.js";
import type {
  MarkdownNote,
  ObsidianMarkdownRepository,
} from "../../src/adapters/obsidian/obsidian-markdown-repository.js";
import { bootAllV2, makeFakeFetch, ok } from "../_utils/fake-fetch.js";

/**
 * Phase 7 slice 7b — pure module `sync-vault.ts`.
 *
 * Module under test (does NOT yet exist):
 *   src/application/sync-vault.ts
 *
 * Contract:
 *   - Enumerates notes via repository.getAllMarkdownNotes() (slice 7b adds this method).
 *   - SEQUENTIAL per-note `syncNote` calls; vault order = repo order.
 *   - onProgress invoked AFTER each note completes (locked: no leading 0/total call).
 *   - Per-note throws are caught; note recorded as `failed`, vault continues.
 *   - Aggregates totals from ankiResults arrays counting only `status === "ok"` ops.
 */

const ALL_MODELS = [ANKI_MODEL_BASIC, ANKI_MODEL_REVERSED, ANKI_MODEL_CLOZE];
const VAULT = "MyVault";

const TWO_CARDS = ["Q1::A1", "", "Q2::A2", ""].join("\n");
const ONE_CARD = ["Q1::A1", ""].join("\n");

function settingsWith(
  overrides: Partial<FlashcardsSettings> = {},
): FlashcardsSettings {
  return { ...DEFAULT_SETTINGS, folderBasedDecks: false, ...overrides };
}

function makeNote(path: string, markdown: string): MarkdownNote {
  return {
    file: {} as MarkdownNote["file"],
    markdown,
    name: path.replace(/\.md$/, "").split("/").pop() ?? path,
    path,
  };
}

interface FakeRepoHandle {
  repository: ObsidianMarkdownRepository;
  saves: Array<{ path: string; markdown: string }>;
}

function makeFakeRepo(notes: MarkdownNote[]): FakeRepoHandle {
  const saves: Array<{ path: string; markdown: string }> = [];
  const repo = {
    async getAllMarkdownNotes() {
      return notes;
    },
    async getActiveNote() {
      return notes[0] ?? null;
    },
    async saveNote(note: MarkdownNote, markdown: string) {
      saves.push({ path: note.path, markdown });
      note.markdown = markdown;
    },
  } as unknown as ObsidianMarkdownRepository;
  return { repository: repo, saves };
}

function seededGenerator(ids: string[]): () => string {
  let i = 0;
  return () => {
    const next = ids[i] ?? `q-zz${i}`;
    i++;
    return next;
  };
}

// A repo whose saveNote throws for a specific path — used to force syncNote
// to genuinely throw (bootstrap errors are caught internally by syncNote and
// become `status: "failed"`; the only path that bubbles is repository errors).
function makeThrowingRepo(
  notes: MarkdownNote[],
  throwForPath: string,
): FakeRepoHandle {
  const saves: Array<{ path: string; markdown: string }> = [];
  const repo = {
    async getAllMarkdownNotes() {
      return notes;
    },
    async getActiveNote() {
      return notes[0] ?? null;
    },
    async saveNote(note: MarkdownNote, markdown: string) {
      if (note.path === throwForPath) {
        throw new Error(`save failed for ${note.path}`);
      }
      saves.push({ path: note.path, markdown });
      note.markdown = markdown;
    },
  } as unknown as ObsidianMarkdownRepository;
  return { repository: repo, saves };
}

// ===========================================================================

describe("syncVault — empty vault", () => {
  it("returns zeroed result and makes no syncNote calls", async () => {
    const { repository } = makeFakeRepo([]);
    const { calls, fetch } = makeFakeFetch([]);

    const result = await syncVault({
      ankiClient: new AnkiConnectClient({ fetch }),
      repository,
      settings: settingsWith(),
      vaultName: VAULT,
    });

    expect(result.noteCount).toBe(0);
    expect(result.totalCreates).toBe(0);
    expect(result.totalUpdates).toBe(0);
    expect(result.totalDeletes).toBe(0);
    expect(result.failedNotes).toBe(0);
    expect(result.perNote).toEqual([]);
    expect(calls).toEqual([]);
  });
});

// ===========================================================================

describe("syncVault — single note with 2 creates", () => {
  it("aggregates totalCreates from the note's ankiResults", async () => {
    const note = makeNote("a.md", TWO_CARDS);
    const { repository } = makeFakeRepo([note]);
    const { fetch } = makeFakeFetch([
      ...bootAllV2(ALL_MODELS),
      ok(["Default"]),
      ok(1001),
      ok(1002),
    ]);

    const result = await syncVault({
      ankiClient: new AnkiConnectClient({ fetch }),
      generateBlockId: seededGenerator(["q-aaaa", "q-bbbb"]),
      repository,
      settings: settingsWith(),
      vaultName: VAULT,
    });

    expect(result.noteCount).toBe(1);
    expect(result.totalCreates).toBe(2);
    expect(result.totalUpdates).toBe(0);
    expect(result.totalDeletes).toBe(0);
    expect(result.failedNotes).toBe(0);
    expect(result.perNote).toHaveLength(1);
    expect(result.perNote[0]!.status).toBe("ok");
  });
});

// ===========================================================================

describe("syncVault — sequential ordering", () => {
  it("processes notes one at a time; second note's Anki calls follow the first's", async () => {
    const noteA = makeNote("a.md", ONE_CARD);
    const noteB = makeNote("b.md", ONE_CARD);
    const { repository } = makeFakeRepo([noteA, noteB]);

    // 4 responses each (bootstrap + 1 addNote per note). If processing were
    // parallel both notes would start their bootstrap before either finished,
    // but the fake-fetch queue is shared. Sequential order = bootstrap-A,
    // create-A, bootstrap-B, create-B.
    const { calls, fetch } = makeFakeFetch([
      ...bootAllV2(ALL_MODELS),
      ok(["Default"]),
      ok(1001),
      ...bootAllV2(ALL_MODELS),
      ok(["Default"]),
      ok(1002),
    ]);

    await syncVault({
      ankiClient: new AnkiConnectClient({ fetch }),
      generateBlockId: seededGenerator(["q-aaaa", "q-bbbb"]),
      repository,
      settings: settingsWith(),
      vaultName: VAULT,
    });

    const actions = calls.map((c) => c.action);
    expect(actions).toEqual([
      "modelNames",
      "modelFieldNames",
      "modelFieldNames",
      "modelFieldNames",
      "deckNames",
      "addNote",
      "modelNames",
      "modelFieldNames",
      "modelFieldNames",
      "modelFieldNames",
      "deckNames",
      "addNote",
    ]);
  });
});

// ===========================================================================

describe("syncVault — per-note throw is isolated", () => {
  it("records failed note, continues with the rest", async () => {
    // saveNote throws for a.md (Phase A always saves on first sync since
    // anchors+frontmatter get inserted). b.md proceeds normally.
    const noteA = makeNote("a.md", ONE_CARD);
    const noteB = makeNote("b.md", ONE_CARD);
    const { repository } = makeThrowingRepo([noteA, noteB], "a.md");
    // a.md fails before any Anki call; b.md still bootstraps + creates.
    const { fetch } = makeFakeFetch([
      ...bootAllV2(ALL_MODELS),
      ok(["Default"]),
      ok(2002),
    ]);

    const result = await syncVault({
      ankiClient: new AnkiConnectClient({ fetch }),
      generateBlockId: seededGenerator(["q-aaaa", "q-bbbb"]),
      repository,
      settings: settingsWith(),
      vaultName: VAULT,
    });

    expect(result.noteCount).toBe(2);
    expect(result.failedNotes).toBe(1);
    expect(result.perNote).toHaveLength(2);
    const failed = result.perNote.find((r) => r.notePath === "a.md");
    const okNote = result.perNote.find((r) => r.notePath === "b.md");
    expect(failed!.status).toBe("failed");
    expect(failed!.error).toContain("save failed");
    expect(okNote!.status).toBe("ok");
    expect(result.totalCreates).toBe(1);
  });
});

// ===========================================================================

describe("syncVault — mixed outcomes sum correctly", () => {
  it("sums creates across notes correctly", async () => {
    // Two notes, each with 2 new cards on first sync → 4 creates total.
    const noteA = makeNote("a.md", TWO_CARDS);
    const noteB = makeNote("b.md", TWO_CARDS);
    const { repository } = makeFakeRepo([noteA, noteB]);
    const { fetch } = makeFakeFetch([
      // note A
      ...bootAllV2(ALL_MODELS),
      ok(["Default"]),
      ok(1001),
      ok(1002),
      // note B
      ...bootAllV2(ALL_MODELS),
      ok(["Default"]),
      ok(1003),
      ok(1004),
    ]);

    const result = await syncVault({
      ankiClient: new AnkiConnectClient({ fetch }),
      generateBlockId: seededGenerator([
        "q-aaaa",
        "q-bbbb",
        "q-cccc",
        "q-dddd",
      ]),
      repository,
      settings: settingsWith(),
      vaultName: VAULT,
    });

    expect(result.noteCount).toBe(2);
    expect(result.totalCreates).toBe(4);
    expect(result.totalUpdates).toBe(0);
    expect(result.totalDeletes).toBe(0);
    expect(result.failedNotes).toBe(0);
  });
});

// ===========================================================================

describe("syncVault — onProgress", () => {
  it("invokes once per note, after completion, in order, with correct (current,total,path)", async () => {
    const noteA = makeNote("a.md", ONE_CARD);
    const noteB = makeNote("b.md", ONE_CARD);
    const { repository } = makeFakeRepo([noteA, noteB]);
    const { fetch } = makeFakeFetch([
      ...bootAllV2(ALL_MODELS),
      ok(["Default"]),
      ok(1001),
      ...bootAllV2(ALL_MODELS),
      ok(["Default"]),
      ok(1002),
    ]);

    const progress: Array<[number, number, string]> = [];
    await syncVault({
      ankiClient: new AnkiConnectClient({ fetch }),
      generateBlockId: seededGenerator(["q-aaaa", "q-bbbb"]),
      onProgress: (current, total, path) => {
        progress.push([current, total, path]);
      },
      repository,
      settings: settingsWith(),
      vaultName: VAULT,
    });

    // Locked: exactly one callback per note, AFTER it completes. No leading
    // (0, total, ...) call.
    expect(progress).toEqual([
      [1, 2, "a.md"],
      [2, 2, "b.md"],
    ]);
  });
});

// ===========================================================================

describe("syncVault — dependency threading", () => {
  it("threads generateBlockId and vaultName through to syncNote for every note", async () => {
    const noteA = makeNote("a.md", ONE_CARD);
    const noteB = makeNote("b.md", ONE_CARD);
    const { repository } = makeFakeRepo([noteA, noteB]);
    const { calls, fetch } = makeFakeFetch([
      ...bootAllV2(ALL_MODELS),
      ok(["Default"]),
      ok(1001),
      ...bootAllV2(ALL_MODELS),
      ok(["Default"]),
      ok(1002),
    ]);

    await syncVault({
      ankiClient: new AnkiConnectClient({ fetch }),
      generateBlockId: seededGenerator(["q-aaaa", "q-bbbb"]),
      repository,
      settings: settingsWith(),
      vaultName: "ThreadedVault",
    });

    // Each addNote should carry the vault name in the Source field path.
    const addNoteCalls = calls.filter((c) => c.action === "addNote");
    expect(addNoteCalls).toHaveLength(2);
    for (const c of addNoteCalls) {
      const note = (c.params as { note: { fields: Record<string, string> } })
        .note;
      const source = note.fields["Source"];
      expect(source).toBeDefined();
      expect(source).toContain("ThreadedVault");
    }

    // Final markdown contains the seeded ids — proof generateBlockId was
    // threaded through.
    expect(noteA.markdown).toContain("^q-aaaa");
    expect(noteB.markdown).toContain("^q-bbbb");
  });
});

// ===========================================================================

describe("syncVault — resolveLink threading", () => {
  it("threads resolveLink through to every note's syncNote → addNote Front", async () => {
    const noteA = makeNote("a.md", ["see [[Note]]::A1", ""].join("\n"));
    const noteB = makeNote("b.md", ["check [[Note]]::A2", ""].join("\n"));
    const { repository } = makeFakeRepo([noteA, noteB]);
    const { calls, fetch } = makeFakeFetch([
      ...bootAllV2(ALL_MODELS),
      ok(["Default"]),
      ok(5001),
      ...bootAllV2(ALL_MODELS),
      ok(["Default"]),
      ok(5002),
    ]);

    await syncVault({
      ankiClient: new AnkiConnectClient({ fetch }),
      generateBlockId: seededGenerator(["q-aaaa", "q-bbbb"]),
      repository,
      resolveLink: (target: string) => `${target}.md`,
      settings: settingsWith(),
      vaultName: VAULT,
    });

    const addNoteCalls = calls.filter((c) => c.action === "addNote");
    expect(addNoteCalls).toHaveLength(2);
    for (const c of addNoteCalls) {
      const note = (c.params as { note: { fields: Record<string, string> } })
        .note;
      expect(note.fields.Front).toContain(
        `<a href="obsidian://open?vault=${VAULT}&amp;file=Note.md">Note</a>`,
      );
      expect(note.fields.Front).not.toContain("[[Note]]");
    }
  });
});
