import { describe, expect, it } from "vitest";

import { syncNote } from "../../src/application/sync-note.js";
import { AnkiConnectClient } from "../../src/adapters/anki/anki-connect-client.js";
import {
  ANKI_MODEL_BASIC,
  ANKI_MODEL_REVERSED,
  ANKI_MODEL_CLOZE,
  ANKI_MODEL_REMINDER,
} from "../../src/core/render/render-card.js";
import { DEFAULT_SETTINGS } from "../../src/core/config/settings.js";
import type { FlashcardsSettings } from "../../src/core/config/settings.js";
import { computeCueHash } from "../../src/core/edits/card-hash.js";
import { parseCardFrontmatter } from "../../src/core/sync/parse-card-frontmatter.js";
import type { MarkdownNote } from "../../src/application/ports.js";
import type { ObsidianMarkdownRepository } from "../../src/adapters/obsidian/obsidian-markdown-repository.js";
import { bootAllV2, makeFakeFetch, ok } from "../_utils/fake-fetch.js";

/**
 * WI-11 — cue-rephrase rebind flow (spec §4.7, extends WI-4 delete-safety).
 *
 * Mechanism under test (none of it exists yet):
 *  - `syncNote` gains an optional `confirmRebinds?: (pending: PendingRebind[])
 *    => Promise<boolean>` seam, mirroring `confirmDeletions`.
 *  - When `buildSyncPlan` reports exactly one paired rebind for the note
 *    (see `tests/core/sync/build-sync-plan.test.ts`), `syncNote` offers it to
 *    `confirmRebinds` BEFORE the ordinary delete-safety gate runs on the
 *    paired orphan.
 *  - Confirmed → the paired CREATE+DELETE collapse into a single UPDATE of
 *    the orphan's `nid` (scheduling preserved): no `addNote`, no
 *    `deleteNotes`. The frontmatter keeps the orphan's `blockId`, its `cue`
 *    rewritten to match the new front.
 *  - Declined (or no confirmer wired — headless default) → falls through to
 *    the ordinary flow: the orphan enters `confirmDeletions`, the CREATE
 *    proceeds unconditionally.
 *
 * Fixture shape throughout: a note with exactly one atomic `test:` item,
 * rephrased between two syncs — the minimal case that produces exactly one
 * atomic orphan + one atomic CREATE (the pairing precondition).
 */

const ALL_MODELS = [ANKI_MODEL_BASIC, ANKI_MODEL_REVERSED, ANKI_MODEL_CLOZE, ANKI_MODEL_REMINDER];
const VAULT = "MyVault";
const NOTE_PATH = "notes/Rebind me.md";
const TITLE = "Rebind me";
const OLD_CUE = "What is the old question, precisely?";
const NEW_CUE = "What is the completely rephrased question?";
const FIRST_PARAGRAPH = "Some first paragraph relevant to the rebind flow.";

function settingsWith(
  overrides: Partial<FlashcardsSettings> = {},
): FlashcardsSettings {
  return { ...DEFAULT_SETTINGS, folderBasedDecks: false, ...overrides };
}

function makeNote(markdown: string, notePath: string, name: string): MarkdownNote {
  return {
    file: {} as MarkdownNote["file"],
    markdown,
    name,
    path: notePath,
  };
}

interface FakeRepoHandle {
  repository: ObsidianMarkdownRepository;
  currentMarkdown: () => string;
}

function makeFakeRepository(initial: string): FakeRepoHandle {
  let current = initial;
  const repo = {
    async getActiveNote() {
      return makeNote(current, NOTE_PATH, "unused");
    },
    async saveNote(_note: MarkdownNote, markdown: string) {
      current = markdown;
    },
  } as unknown as ObsidianMarkdownRepository;
  return { repository: repo, currentMarkdown: () => current };
}

function baseFixture(cue: string): string {
  return [
    "---",
    "test:",
    `  - "${cue}"`,
    "---",
    "",
    FIRST_PARAGRAPH,
    "",
  ].join("\n");
}

/** Sync the base fixture once and return the resulting in-sync markdown + nid. */
async function syncOnce(): Promise<{ markdown: string; nid: number }> {
  const md = baseFixture(OLD_CUE);
  const { repository, currentMarkdown } = makeFakeRepository(md);
  const { fetch } = makeFakeFetch([
    ...bootAllV2(ALL_MODELS),
    ok(["Default"]), // deckNames
    ok(4242424242), // addNote
  ]);

  await syncNote({
    ankiClient: new AnkiConnectClient({ fetch }),
    note: makeNote(md, NOTE_PATH, TITLE),
    repository,
    settings: settingsWith(),
    vaultName: VAULT,
  });

  const inSync = currentMarkdown();
  const nid = parseCardFrontmatter(inSync).entries[0]?.nid;
  expect(nid).toBeDefined();
  return { markdown: inSync, nid: nid! };
}

describe("syncNote — WI-11: confirmed rebind collapses orphan+CREATE into a single scheduling-preserving UPDATE", () => {
  it("no addNote/deleteNotes; one updateNoteFields targeting the old nid; frontmatter keeps the old blockId with the cue rewritten", async () => {
    const { markdown: inSync, nid: oldNid } = await syncOnce();
    const oldBlockId = parseCardFrontmatter(inSync).entries[0]?.blockId;
    expect(oldBlockId).toBeDefined();

    const rephrased = inSync.replace(OLD_CUE, NEW_CUE);

    // Queue matches TODAY's (pre-WI-11) actual behavior: confirmRebinds is
    // ignored, the orphan is retained (no confirmDeletions wired, default
    // decline), and the CREATE proceeds normally.
    const { calls, fetch } = makeFakeFetch([
      ...bootAllV2(ALL_MODELS),
      ok(["Default"]), // deckNames — must NOT be reached once implemented
      ok(9999), // addNote — must NOT be reached once implemented
    ]);
    const { repository, currentMarkdown } = makeFakeRepository(rephrased);

    let rebindCallCount = 0;
    const result = await syncNote({
      ankiClient: new AnkiConnectClient({ fetch }),
      confirmRebinds: async () => {
        rebindCallCount++;
        return true;
      },
      note: makeNote(rephrased, NOTE_PATH, TITLE),
      repository,
      settings: settingsWith({ confirmBeforeDelete: true }),
      vaultName: VAULT,
    } as Parameters<typeof syncNote>[0]);

    expect(result.status).toBe("ok");
    expect(rebindCallCount).toBe(1);
    expect(calls.map((c) => c.action)).not.toContain("addNote");
    expect(calls.map((c) => c.action)).not.toContain("deleteNotes");
    expect(calls.map((c) => c.action)).toContain("updateNoteFields");
    const updateCall = calls.find((c) => c.action === "updateNoteFields");
    expect(updateCall?.params).toMatchObject({ note: { id: oldNid } });

    const entries = parseCardFrontmatter(currentMarkdown()).entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.blockId).toBe(oldBlockId);
    expect(entries[0]?.nid).toBe(oldNid);
    expect(entries[0]?.cue).toBe(computeCueHash("basic", NEW_CUE));
  });
});

describe("syncNote — WI-11: declined rebind falls back to ordinary delete-safety (interaction: decline rebind then cancel delete)", () => {
  it("offers the pairing to confirmRebinds exactly once; declining routes the orphan through confirmDeletions; declining THAT too loses nothing and still creates the new card", async () => {
    const { markdown: inSync, nid: oldNid } = await syncOnce();
    const oldBlockId = parseCardFrontmatter(inSync).entries[0]?.blockId;

    const rephrased = inSync.replace(OLD_CUE, NEW_CUE);

    const { calls, fetch } = makeFakeFetch([
      ...bootAllV2(ALL_MODELS),
      ok(["Default"]), // deckNames
      ok(9999), // addNote
    ]);
    const { repository, currentMarkdown } = makeFakeRepository(rephrased);

    let rebindCallCount = 0;
    const capturedRebindPending: unknown[] = [];
    let deletionsCallCount = 0;

    const result = await syncNote({
      ankiClient: new AnkiConnectClient({ fetch }),
      confirmDeletions: async () => {
        deletionsCallCount++;
        return false; // cancel the delete too
      },
      confirmRebinds: async (pending: unknown[]) => {
        rebindCallCount++;
        capturedRebindPending.push(...pending);
        return false; // decline the rebind
      },
      note: makeNote(rephrased, NOTE_PATH, TITLE),
      repository,
      settings: settingsWith({ confirmBeforeDelete: true }),
      vaultName: VAULT,
    } as Parameters<typeof syncNote>[0]);

    expect(result.status).toBe("ok");

    // The confirm seam must have been offered the pairing exactly once, with
    // the orphan's identity and the new card's front.
    expect(rebindCallCount).toBe(1);
    expect(capturedRebindPending).toEqual([
      {
        blockId: oldBlockId,
        deckName: "Default",
        newFront: NEW_CUE,
        nid: oldNid,
      },
    ]);

    // Decline → ordinary delete-safety flow: the orphan must still be
    // offered to confirmDeletions.
    expect(deletionsCallCount).toBe(1);

    // Nothing lost: the CREATE proceeds regardless of either decision, and
    // declining the delete keeps the stale entry.
    expect(calls.map((c) => c.action)).toContain("addNote");
    expect(calls.map((c) => c.action)).not.toContain("deleteNotes");

    const entries = parseCardFrontmatter(currentMarkdown()).entries;
    expect(entries.some((e) => e.blockId === oldBlockId && e.nid === oldNid)).toBe(
      true,
    );
    expect(entries.length).toBeGreaterThanOrEqual(2);
  });
});

// NOTE: a "headless default (no confirmRebinds wired) ⇒ same net effect as
// declined" scenario is deliberately NOT encoded as its own application-level
// test here. Given today's code (confirmRebinds doesn't exist, so it's
// necessarily never wired), that scenario is bit-for-bit identical to the
// existing, already-passing regression lock in
// `sync-note-atomic-identity.test.ts` ("rephrasing an authored cue orphans
// the old entry and creates a new card") — asserting it again here would
// pass today for the wrong reason (nothing exercises new behavior) and
// violate the "tests must currently fail" rule. The confirmer-agnostic half
// of this requirement (pairing is DETECTED regardless of who's listening) is
// locked instead at the pure layer in `build-sync-plan.test.ts`, since
// `buildSyncPlan` has no notion of a confirmer at all.
