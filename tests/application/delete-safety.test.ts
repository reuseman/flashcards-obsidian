import { describe, expect, it, vi } from "vitest";

import { syncNote } from "../../src/application/sync-note.js";
import type { SyncNoteInput } from "../../src/application/sync-note.js";
import { AnkiConnectClient } from "../../src/adapters/anki/anki-connect-client.js";
import {
  ANKI_MODEL_BASIC,
  ANKI_MODEL_CLOZE,
  ANKI_MODEL_REVERSED,
} from "../../src/core/render/render-card.js";
import { DEFAULT_SETTINGS } from "../../src/core/config/settings.js";
import type { FlashcardsSettings } from "../../src/core/config/settings.js";
import type { MarkdownNote } from "../../src/application/ports.js";
import type { ObsidianMarkdownRepository } from "../../src/adapters/obsidian/obsidian-markdown-repository.js";
import { bootAllV2, makeFakeFetch, ok } from "../_utils/fake-fetch.js";

/**
 * WI-4 — delete-safety (spec §4.5).
 *
 * Locks the CORE gating contract: a sync must never SILENTLY delete an Anki
 * card. Behaviour matrix:
 *
 *   confirmBeforeDelete | confirmer        | deletes happen?
 *   --------------------+-----------------+----------------
 *   true                | returns true    | yes
 *   true                | returns false   | no (creates/updates still apply)
 *   true                | undefined       | no (safe default), logged
 *   false               | (not consulted) | yes
 *
 * The Obsidian confirmation Modal lives in the adapter layer and is OUT OF
 * SCOPE here. These tests exercise only the injectable confirmer seam on
 * `syncNote`.
 *
 * Seam chosen (NOT YET IMPLEMENTED — these tests are red):
 *   - `FlashcardsSettings.confirmBeforeDelete: boolean` (default `true`).
 *   - `SyncNoteInput.confirmDeletions?: (pending) => Promise<boolean>`.
 *   - `PendingDeletion` carries at least `{ blockId, nid }` (the only card
 *     identity reliably available at delete time — see report note on the
 *     missing front-snippet).
 */

const ALL_MODELS = [ANKI_MODEL_BASIC, ANKI_MODEL_REVERSED, ANKI_MODEL_CLOZE];
const VAULT = "MyVault";
const NOTE_PATH = "notes/sample.md";

// ---------------------------------------------------------------------------
// Fake repository (mirrors tests/application/sync-note.test.ts)
// ---------------------------------------------------------------------------

interface FakeRepoHandle {
  repository: ObsidianMarkdownRepository;
  saves: string[];
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

function settingsWith(
  overrides: Partial<FlashcardsSettings> = {},
): FlashcardsSettings {
  return { ...DEFAULT_SETTINGS, folderBasedDecks: false, ...overrides };
}

function seededGenerator(ids: string[]): () => string {
  let i = 0;
  return () => {
    const next = ids[i] ?? `q-zz${i}`;
    i++;
    return next;
  };
}

// ---------------------------------------------------------------------------
// `confirmDeletions` is the proposed (not-yet-existing) seam on SyncNoteInput.
// Define its shape locally so the test file type-checks even before src/ grows
// the field, and thread it through a loose cast rather than tightening the
// strict `SyncNoteInput` interface.
// ---------------------------------------------------------------------------

interface PendingDeletionShape {
  blockId: string;
  nid: number;
}
type Confirmer = (pending: PendingDeletionShape[]) => Promise<boolean>;

function runSync(
  input: SyncNoteInput,
  confirmDeletions?: Confirmer,
): ReturnType<typeof syncNote> {
  const withConfirmer = {
    ...input,
    ...(confirmDeletions ? { confirmDeletions } : {}),
  } as SyncNoteInput;
  return syncNote(withConfirmer);
}

// ---------------------------------------------------------------------------
// Fixture: a 3-card note that is FIRST brought in sync, then mutated so that
// the next sync would CREATE one card, UPDATE one card, and DELETE one card.
//
//   q-aaaa (Q1::A1)  -> kept, content unchanged  -> no-op
//   q-bbbb (Q2::A2)  -> answer edited            -> UPDATE
//   q-cccc (Q3::A3)  -> removed from the note    -> DELETE
//   (new) Q4::A4     -> added to the note        -> CREATE
//
// This makes "cancel skips only the delete" a meaningful assertion: the create
// and the update must still flow to Anki.
// ---------------------------------------------------------------------------

const THREE_CARDS = ["Q1::A1", "", "Q2::A2", "", "Q3::A3", ""].join("\n");

const DELETE_NID = 3003;
const UPDATE_NID = 3002;

/**
 * Run a first sync of THREE_CARDS, returning the synced markdown plus the
 * mutated markdown (create + update + delete pending against it).
 */
async function buildPendingState(): Promise<{
  synced: string;
  mutated: string;
}> {
  const { repository, currentMarkdown } = makeFakeRepository(THREE_CARDS);
  const { fetch } = makeFakeFetch([
    ...bootAllV2(ALL_MODELS),
    ok(["Default"]),
    ok(3001), // q-aaaa
    ok(UPDATE_NID), // q-bbbb
    ok(DELETE_NID), // q-cccc
  ]);
  await syncNote({
    ankiClient: new AnkiConnectClient({ fetch }),
    generateBlockId: seededGenerator(["q-aaaa", "q-bbbb", "q-cccc"]),
    note: makeNote(THREE_CARDS),
    repository,
    settings: settingsWith(),
    vaultName: VAULT,
  });
  const synced = currentMarkdown();

  // Mutate: edit card 2's answer, drop card 3 entirely, add a 4th card.
  // WI-1: identity anchors are own-line, so card 3's block is `Q3::A3\n^q-cccc`.
  let mutated = synced.replace("Q2::A2", "Q2::A2-changed");
  mutated = mutated.replace(/\nQ3::A3\n\^q-cccc\n/, "\n");
  mutated = `${mutated}\nQ4::A4\n`;

  return { synced, mutated };
}

// ===========================================================================
// 1. confirm true → delete proceeds (plus create + update)
// ===========================================================================

describe("syncNote — delete-safety: confirmBeforeDelete true, confirmer accepts", () => {
  it("sends deleteNotes and also applies the pending create and update", async () => {
    const { mutated } = await buildPendingState();
    const { repository } = makeFakeRepository(mutated);
    const { calls, fetch } = makeFakeFetch([
      ...bootAllV2(ALL_MODELS),
      ok(["Default"]),
      ok(4004), // addNote for new Q4
      ok(null), // updateNoteFields for Q2
      ok(null), // deleteNotes for Q3
    ]);
    const confirmer: Confirmer = vi.fn(async () => true);

    const result = await runSync(
      {
        ankiClient: new AnkiConnectClient({ fetch }),
        generateBlockId: seededGenerator(["q-dddd"]),
        note: makeNote(mutated),
        repository,
        settings: settingsWith({
          confirmBeforeDelete: true,
        } as Partial<FlashcardsSettings>),
        vaultName: VAULT,
      },
      confirmer,
    );

    expect(result.status).toBe("ok");
    const actions = calls.map((c) => c.action);
    expect(actions).toContain("deleteNotes");
    expect(actions).toContain("addNote");
    expect(actions).toContain("updateNoteFields");
    expect(result.ankiResults!.deletes).toHaveLength(1);
    expect(result.ankiResults!.deletes[0]!.op.nid).toBe(DELETE_NID);
    expect(result.ankiResults!.creates).toHaveLength(1);
    expect(result.ankiResults!.updates).toHaveLength(1);
    // Seam proof: the confirmer was actually consulted (gating is wired).
    expect(confirmer).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// 2. confirm false → NO delete, but create + update still applied
// ===========================================================================

describe("syncNote — delete-safety: confirmBeforeDelete true, confirmer cancels", () => {
  it("skips deleteNotes entirely but still applies the pending create and update", async () => {
    const { mutated } = await buildPendingState();
    const { repository } = makeFakeRepository(mutated);
    // No deleteNotes response queued — if a delete is attempted, FakeFetch
    // throws "no queued response", surfacing the leak.
    const { calls, fetch } = makeFakeFetch([
      ...bootAllV2(ALL_MODELS),
      ok(["Default"]),
      ok(4004), // addNote for new Q4
      ok(null), // updateNoteFields for Q2
    ]);
    const confirmer: Confirmer = vi.fn(async () => false);

    const result = await runSync(
      {
        ankiClient: new AnkiConnectClient({ fetch }),
        generateBlockId: seededGenerator(["q-dddd"]),
        note: makeNote(mutated),
        repository,
        settings: settingsWith({
          confirmBeforeDelete: true,
        } as Partial<FlashcardsSettings>),
        vaultName: VAULT,
      },
      confirmer,
    );

    expect(result.status).toBe("ok");
    const actions = calls.map((c) => c.action);
    expect(actions).not.toContain("deleteNotes");
    expect(actions).toContain("addNote");
    expect(actions).toContain("updateNoteFields");
    // The create and update were applied; the delete was skipped, not executed.
    expect(result.ankiResults!.creates).toHaveLength(1);
    expect(result.ankiResults!.updates).toHaveLength(1);
    expect(
      result.ankiResults!.deletes.filter((d) => d.status === "ok"),
    ).toHaveLength(0);
  });
});

// ===========================================================================
// 3. setting on, NO confirmer wired → safe default = skip delete + log
// ===========================================================================

describe("syncNote — delete-safety: confirmBeforeDelete true, no confirmer wired", () => {
  it("does not delete (safe default) and logs the pending deletion", async () => {
    const { mutated } = await buildPendingState();
    const { repository } = makeFakeRepository(mutated);
    const { calls, fetch } = makeFakeFetch([
      ...bootAllV2(ALL_MODELS),
      ok(["Default"]),
      ok(4004), // addNote for new Q4
      ok(null), // updateNoteFields for Q2
    ]);
    const logged: { message: string; data?: unknown }[] = [];
    const logger = {
      debug: () => {},
      info: (message: string, data?: unknown) => logged.push({ message, data }),
      warn: (message: string, data?: unknown) => logged.push({ message, data }),
      error: () => {},
    };

    const result = await runSync({
      ankiClient: new AnkiConnectClient({ fetch }),
      generateBlockId: seededGenerator(["q-dddd"]),
      logger,
      note: makeNote(mutated),
      repository,
      settings: settingsWith({
        confirmBeforeDelete: true,
      } as Partial<FlashcardsSettings>),
      vaultName: VAULT,
    });

    expect(result.status).toBe("ok");
    expect(calls.map((c) => c.action)).not.toContain("deleteNotes");
    // The deletion is exposed: a log entry references the skipped delete and
    // its card identity (nid).
    const deleteLog = logged.find(
      (l) => /delet/i.test(l.message) && JSON.stringify(l.data ?? "").includes(String(DELETE_NID)),
    );
    expect(deleteLog).toBeDefined();
  });
});

// ===========================================================================
// 4. setting off → delete unconditional, confirmer never consulted
// ===========================================================================

describe("syncNote — delete-safety: confirmBeforeDelete false", () => {
  it("sends deleteNotes without consulting any confirmer", async () => {
    const { mutated } = await buildPendingState();
    const { repository } = makeFakeRepository(mutated);
    const { calls, fetch } = makeFakeFetch([
      ...bootAllV2(ALL_MODELS),
      ok(["Default"]),
      ok(4004), // addNote for new Q4
      ok(null), // updateNoteFields for Q2
      ok(null), // deleteNotes for Q3
    ]);
    const confirmer: Confirmer = vi.fn(async () => true);

    const result = await runSync(
      {
        ankiClient: new AnkiConnectClient({ fetch }),
        generateBlockId: seededGenerator(["q-dddd"]),
        note: makeNote(mutated),
        repository,
        settings: settingsWith({
          confirmBeforeDelete: false,
        } as Partial<FlashcardsSettings>),
        vaultName: VAULT,
      },
      confirmer,
    );

    expect(result.status).toBe("ok");
    expect(calls.map((c) => c.action)).toContain("deleteNotes");
    expect(result.ankiResults!.deletes).toHaveLength(1);
    expect(confirmer).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 5. confirmer receives the pending deletions with card identity
// ===========================================================================

describe("syncNote — delete-safety: confirmer payload", () => {
  it("invokes the confirmer with the pending deletion's blockId and nid", async () => {
    const { mutated } = await buildPendingState();
    const { repository } = makeFakeRepository(mutated);
    const { fetch } = makeFakeFetch([
      ...bootAllV2(ALL_MODELS),
      ok(["Default"]),
      ok(4004), // addNote for new Q4
      ok(null), // updateNoteFields for Q2
      ok(null), // deleteNotes for Q3
    ]);
    let received: PendingDeletionShape[] | undefined;
    const confirmer: Confirmer = async (pending) => {
      received = pending;
      return true;
    };

    await runSync(
      {
        ankiClient: new AnkiConnectClient({ fetch }),
        generateBlockId: seededGenerator(["q-dddd"]),
        note: makeNote(mutated),
        repository,
        settings: settingsWith({
          confirmBeforeDelete: true,
        } as Partial<FlashcardsSettings>),
        vaultName: VAULT,
      },
      confirmer,
    );

    expect(received).toBeDefined();
    expect(received).toHaveLength(1);
    expect(received![0]!.blockId).toBe("q-cccc");
    expect(received![0]!.nid).toBe(DELETE_NID);
  });
});

// ===========================================================================
// 6. default setting value
// ===========================================================================

describe("settings — confirmBeforeDelete default", () => {
  it("defaults confirmBeforeDelete to true in DEFAULT_SETTINGS", () => {
    expect(
      (DEFAULT_SETTINGS as unknown as Record<string, unknown>)
        .confirmBeforeDelete,
    ).toBe(true);
  });
});
