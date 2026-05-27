import { describe, expect, it } from "vitest";

import { syncNote } from "../../src/application/sync-note.js";
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
 * Phase 7 slice 7a — `syncNote`.
 *
 * Module under test (does NOT yet exist):
 *   src/application/sync-note.ts
 *
 * Pipeline (locked):
 *   Phase A — local (no network):
 *     1. extractCardsFromMarkdown.
 *     2. 0 cards → return { status: "skipped" } with no network and no save.
 *     3. insertCardAnchors (with optional injected generator).
 *     4. apply anchor edits.
 *     5. writeCardFrontmatter on the anchored markdown.
 *     6. apply frontmatter edits.
 *     7. saveNote(note, markdown'') iff content changed.
 *
 *   Phase B — network:
 *     8. parseCardFrontmatter.
 *     9. buildSyncPlan (computeHash = computeCardHash).
 *    10. empty plan → status "ok", ankiResults possibly undefined.
 *    11. executeSyncPlan.
 *    12. writebackSyncResults.
 *    13. saveNote(note, markdown''') iff writeback emitted edits.
 *
 * Errors:
 *   - executeSyncPlan throws → status "failed", error captured, ankiResults undefined.
 *   - per-op failures inside ankiResults → status still "ok".
 *   - repository.saveNote errors → bubble.
 *
 * Both phase-A edit steps always run; both are idempotent.
 */

const ALL_MODELS = [ANKI_MODEL_BASIC, ANKI_MODEL_REVERSED, ANKI_MODEL_CLOZE];
const VAULT = "MyVault";
const NOTE_PATH = "notes/sample.md";

// ---------------------------------------------------------------------------
// Fake repository
// ---------------------------------------------------------------------------

interface FakeRepoHandle {
  repository: ObsidianMarkdownRepository;
  saves: string[]; // markdown contents passed to saveNote, in order
  currentMarkdown: () => string;
}

function makeFakeRepository(initial: string): FakeRepoHandle {
  let current = initial;
  const saves: string[] = [];
  const repo = {
    async getActiveNote() {
      return makeNote(current);
    },
    async saveNote(_note: MarkdownNote, markdown: string) {
      saves.push(markdown);
      current = markdown;
    },
  } as unknown as ObsidianMarkdownRepository;
  return { repository: repo, saves, currentMarkdown: () => current };
}

function makeNote(markdown: string): MarkdownNote {
  return {
    file: {} as MarkdownNote["file"],
    markdown,
    name: "sample",
    path: NOTE_PATH,
  };
}

// ---------------------------------------------------------------------------
// Deterministic blockId generator
// ---------------------------------------------------------------------------

function seededGenerator(ids: string[]): () => string {
  let i = 0;
  return () => {
    const next = ids[i] ?? `q-zz${i}`;
    i++;
    return next;
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TWO_CARDS = ["Q1::A1", "", "Q2::A2", ""].join("\n");

// Tests use NOTE_PATH = "notes/sample.md". With `folderBasedDecks: true`
// (the project default) the resolved deck would be "notes" and bootstrap
// would try `createDeck("notes")` — which the mocked AnkiConnect responses
// don't account for. Disable folder-based deck resolution by default so the
// resolved deck is `defaultDeck` ("Default"), present in the mocked
// `deckNames` response. Individual tests can override.
function settingsWith(overrides: Partial<FlashcardsSettings> = {}): FlashcardsSettings {
  return { ...DEFAULT_SETTINGS, folderBasedDecks: false, ...overrides };
}

// ===========================================================================
// Phase A — no cards / no-op
// ===========================================================================

describe("syncNote — phase A skip path", () => {
  it("returns skipped without touching repository or network when no cards parsed", async () => {
    const md = "Just a note with no flashcards.\n";
    const { repository, saves } = makeFakeRepository(md);
    const { calls, fetch } = makeFakeFetch([]);

    const result = await syncNote({
      ankiClient: new AnkiConnectClient({ fetch }),
      note: makeNote(md),
      repository,
      settings: settingsWith(),
      vaultName: VAULT,
    });

    expect(result.status).toBe("skipped");
    expect(result.parsedCardCount).toBe(0);
    expect(result.identityWritesApplied).toBe(0);
    expect(result.writebackEditsApplied).toBe(0);
    expect(saves).toEqual([]);
    expect(calls).toEqual([]);
  });
});

// ===========================================================================
// Full pipeline — first sync of a new note
// ===========================================================================

describe("syncNote — new note happy path", () => {
  it("writes anchors + frontmatter, calls Anki, writes back nids", async () => {
    const { repository, saves, currentMarkdown } = makeFakeRepository(TWO_CARDS);
    const { calls, fetch } = makeFakeFetch([
      ...bootAllV2(ALL_MODELS),
      ok(["Default"]), // deckNames
      ok(1001), // addNote #1
      ok(1002), // addNote #2
    ]);
    const generateBlockId = seededGenerator(["q-aaaa", "q-bbbb"]);

    const result = await syncNote({
      ankiClient: new AnkiConnectClient({ fetch }),
      generateBlockId,
      note: makeNote(TWO_CARDS),
      repository,
      settings: settingsWith(),
      vaultName: VAULT,
    });

    expect(result.status).toBe("ok");
    expect(result.parsedCardCount).toBe(2);
    expect(result.identityWritesApplied).toBeGreaterThan(0);
    expect(result.writebackEditsApplied).toBeGreaterThan(0);
    expect(result.ankiResults).toBeDefined();
    expect(result.ankiResults!.creates).toHaveLength(2);
    expect(result.ankiResults!.creates.every((c) => c.status === "ok")).toBe(true);

    // Anki call sequence: bootstrap (modelNames + 3 modelFieldNames) then 2 addNotes.
    expect(calls.map((c) => c.action)).toEqual([
      "modelNames",
      "modelFieldNames",
      "modelFieldNames",
      "modelFieldNames",
      "deckNames",
      "addNote",
      "addNote",
    ]);

    // Saves: one after phase-A edits, one after writeback.
    expect(saves.length).toBe(2);
    const finalMarkdown = currentMarkdown();
    expect(finalMarkdown).toContain("^q-aaaa");
    expect(finalMarkdown).toContain("^q-bbbb");
    expect(finalMarkdown).toMatch(/q-aaaa: \{ nid: 1001, hash: [a-z0-9]+ \}/);
    expect(finalMarkdown).toMatch(/q-bbbb: \{ nid: 1002, hash: [a-z0-9]+ \}/);
  });
});

// ===========================================================================
// Idempotency — second run on synced note
// ===========================================================================

describe("syncNote — idempotent second run", () => {
  it("makes no Anki calls and no saves when nothing changed", async () => {
    // Build a synced state by running once.
    const { repository, saves, currentMarkdown } = makeFakeRepository(TWO_CARDS);
    const firstFetch = makeFakeFetch([
      ...bootAllV2(ALL_MODELS),
      ok(["Default"]),
      ok(1001),
      ok(1002),
    ]);
    await syncNote({
      ankiClient: new AnkiConnectClient({ fetch: firstFetch.fetch }),
      generateBlockId: seededGenerator(["q-aaaa", "q-bbbb"]),
      note: makeNote(TWO_CARDS),
      repository,
      settings: settingsWith(),
      vaultName: VAULT,
    });
    const synced = currentMarkdown();
    const savesBefore = saves.length;

    // Now sync again — nothing should change, no Anki traffic.
    const { calls, fetch } = makeFakeFetch([
      ...bootAllV2(ALL_MODELS),
    ]);
    const result = await syncNote({
      ankiClient: new AnkiConnectClient({ fetch }),
      note: makeNote(synced),
      repository,
      settings: settingsWith(),
      vaultName: VAULT,
    });

    expect(result.status).toBe("ok");
    expect(result.identityWritesApplied).toBe(0);
    expect(result.writebackEditsApplied).toBe(0);
    expect(saves.length).toBe(savesBefore);
    // No addNote / updateNoteFields / deleteNotes calls.
    expect(calls.map((c) => c.action).filter((a) => a === "addNote" || a === "updateNoteFields" || a === "deleteNotes")).toEqual([]);
  });
});

// ===========================================================================
// Card content changed — UPDATE path
// ===========================================================================

describe("syncNote — card content changed", () => {
  it("emits an UPDATE op and writes back the new hash", async () => {
    const { repository, saves, currentMarkdown } = makeFakeRepository(TWO_CARDS);
    const firstFetch = makeFakeFetch([
      ...bootAllV2(ALL_MODELS),
      ok(["Default"]),
      ok(2001),
      ok(2002),
    ]);
    await syncNote({
      ankiClient: new AnkiConnectClient({ fetch: firstFetch.fetch }),
      generateBlockId: seededGenerator(["q-aaaa", "q-bbbb"]),
      note: makeNote(TWO_CARDS),
      repository,
      settings: settingsWith(),
      vaultName: VAULT,
    });
    // Mutate first card's answer.
    const synced = currentMarkdown();
    const edited = synced.replace("Q1::A1", "Q1::A1-changed");

    const { calls, fetch } = makeFakeFetch([
      ...bootAllV2(ALL_MODELS),
      ok(null), // updateNoteFields
    ]);
    const before = saves.length;

    const result = await syncNote({
      ankiClient: new AnkiConnectClient({ fetch }),
      note: makeNote(edited),
      repository,
      settings: settingsWith(),
      vaultName: VAULT,
    });

    expect(result.status).toBe("ok");
    expect(result.ankiResults!.updates).toHaveLength(1);
    expect(result.ankiResults!.creates).toHaveLength(0);
    expect(calls.map((c) => c.action)).toContain("updateNoteFields");
    // Writeback updated hash → one extra save after phase B.
    expect(saves.length).toBeGreaterThan(before);
  });
});

// ===========================================================================
// Card removed — DELETE path
// ===========================================================================

describe("syncNote — card removed", () => {
  it("emits a DELETE op and removes the frontmatter entry on writeback", async () => {
    const { repository, currentMarkdown } = makeFakeRepository(TWO_CARDS);
    const firstFetch = makeFakeFetch([
      ...bootAllV2(ALL_MODELS),
      ok(["Default"]),
      ok(3001),
      ok(3002),
    ]);
    await syncNote({
      ankiClient: new AnkiConnectClient({ fetch: firstFetch.fetch }),
      generateBlockId: seededGenerator(["q-aaaa", "q-bbbb"]),
      note: makeNote(TWO_CARDS),
      repository,
      settings: settingsWith(),
      vaultName: VAULT,
    });
    const synced = currentMarkdown();
    // Drop the second card entirely (anchor + entry left dangling for diff).
    const withoutSecond = synced.replace(/\nQ2::A2 \^q-bbbb\n/, "\n");

    const { calls, fetch } = makeFakeFetch([
      ...bootAllV2(ALL_MODELS),
      ok(null), // deleteNotes
    ]);

    const result = await syncNote({
      ankiClient: new AnkiConnectClient({ fetch }),
      note: makeNote(withoutSecond),
      repository,
      settings: settingsWith(),
      vaultName: VAULT,
    });

    expect(result.status).toBe("ok");
    expect(result.ankiResults!.deletes).toHaveLength(1);
    expect(result.ankiResults!.deletes[0]!.op.nid).toBe(3002);
    expect(calls.map((c) => c.action)).toContain("deleteNotes");
    expect(currentMarkdown()).not.toContain("q-bbbb");
  });
});

// ===========================================================================
// Bootstrap failure
// ===========================================================================

describe("syncNote — bootstrap failure", () => {
  it("returns status failed when modelNames throws, captures error, no ankiResults", async () => {
    const { repository } = makeFakeRepository(TWO_CARDS);
    const { fetch } = makeFakeFetch([
      { throws: new Error("connection refused") },
    ]);

    const result = await syncNote({
      ankiClient: new AnkiConnectClient({ fetch }),
      generateBlockId: seededGenerator(["q-aaaa", "q-bbbb"]),
      note: makeNote(TWO_CARDS),
      repository,
      settings: settingsWith(),
      vaultName: VAULT,
    });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("connection refused");
    expect(result.ankiResults).toBeUndefined();
  });
});

// ===========================================================================
// Partial failure — one create returns null
// ===========================================================================

describe("syncNote — partial create failure", () => {
  it("marks one op failed, status stays ok, only successful nid written to frontmatter", async () => {
    const { repository, currentMarkdown } = makeFakeRepository(TWO_CARDS);
    const { fetch } = makeFakeFetch([
      ...bootAllV2(ALL_MODELS),
      ok(["Default"]),
      ok(5001), // first addNote ok
      ok(null), // second returns null → failed
    ]);

    const result = await syncNote({
      ankiClient: new AnkiConnectClient({ fetch }),
      generateBlockId: seededGenerator(["q-aaaa", "q-bbbb"]),
      note: makeNote(TWO_CARDS),
      repository,
      settings: settingsWith(),
      vaultName: VAULT,
    });

    expect(result.status).toBe("ok");
    expect(result.ankiResults!.creates).toHaveLength(2);
    expect(result.ankiResults!.creates[0]!.status).toBe("ok");
    expect(result.ankiResults!.creates[1]!.status).toBe("failed");

    const final = currentMarkdown();
    expect(final).toMatch(/q-aaaa: \{ nid: 5001, hash: [a-z0-9]+ \}/);
    // Failed card stays with no nid (slice-2 insert-only entry, hash-only).
    expect(final).not.toMatch(/q-bbbb: \{ nid: \d+/);
  });
});

// ===========================================================================
// Deck creation on first sync
// ===========================================================================

describe("syncNote — deck bootstrap", () => {
  it("calls createDeck when the resolved deck does not exist", async () => {
    const { repository } = makeFakeRepository(TWO_CARDS);
    const { calls, fetch } = makeFakeFetch([
      ...bootAllV2(ALL_MODELS),
      ok([]), // no decks exist
      ok(1), // createDeck Default
      ok(7001),
      ok(7002),
    ]);

    await syncNote({
      ankiClient: new AnkiConnectClient({ fetch }),
      generateBlockId: seededGenerator(["q-aaaa", "q-bbbb"]),
      note: makeNote(TWO_CARDS),
      repository,
      settings: settingsWith({ folderBasedDecks: false }),
      vaultName: VAULT,
    });

    const actions = calls.map((c) => c.action);
    expect(actions).toContain("createDeck");
    const deckCalls = calls.filter((c) => c.action === "createDeck");
    expect(deckCalls).toHaveLength(1);
  });
});

// ===========================================================================
// Custom default deck propagation
// ===========================================================================

describe("syncNote — custom defaultDeck", () => {
  it("uses the configured defaultDeck for cards without explicit deck", async () => {
    const { repository } = makeFakeRepository(TWO_CARDS);
    const { calls, fetch } = makeFakeFetch([
      ...bootAllV2(ALL_MODELS),
      ok(["Custom"]),
      ok(8001),
      ok(8002),
    ]);

    await syncNote({
      ankiClient: new AnkiConnectClient({ fetch }),
      generateBlockId: seededGenerator(["q-aaaa", "q-bbbb"]),
      note: makeNote(TWO_CARDS),
      repository,
      settings: settingsWith({ defaultDeck: "Custom", folderBasedDecks: false }),
      vaultName: VAULT,
    });

    const addNoteCalls = calls.filter((c) => c.action === "addNote");
    expect(addNoteCalls).toHaveLength(2);
    for (const c of addNoteCalls) {
      const note = (c.params as { note: { deckName: string } }).note;
      expect(note.deckName).toBe("Custom");
    }
  });
});

// ===========================================================================
// Seeded generator determinism
// ===========================================================================

describe("syncNote — generator injection", () => {
  it("produces predictable anchors when generateBlockId is seeded", async () => {
    const { repository, currentMarkdown } = makeFakeRepository(TWO_CARDS);
    const { fetch } = makeFakeFetch([
      ...bootAllV2(ALL_MODELS),
      ok(["Default"]),
      ok(9001),
      ok(9002),
    ]);

    await syncNote({
      ankiClient: new AnkiConnectClient({ fetch }),
      generateBlockId: seededGenerator(["q-zzz1", "q-zzz2"]),
      note: makeNote(TWO_CARDS),
      repository,
      settings: settingsWith(),
      vaultName: VAULT,
    });

    // The seeded generator emits invalid charset for V2 — we still expect
    // them to be inserted because insertCardAnchors does not re-validate
    // generator output. Just verify the substring appears.
    const final = currentMarkdown();
    expect(final).toContain("^q-zzz1");
    expect(final).toContain("^q-zzz2");
  });
});
