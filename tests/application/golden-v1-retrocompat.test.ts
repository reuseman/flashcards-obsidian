import { describe, expect, it } from "vitest";

import { syncNote } from "../../src/application/sync-note.js";
import { AnkiConnectClient } from "../../src/adapters/anki/anki-connect-client.js";
import {
  ANKI_MODEL_BASIC,
  ANKI_MODEL_CLOZE,
  ANKI_MODEL_REMINDER,
  ANKI_MODEL_REVERSED,
} from "../../src/core/render/render-card.js";
import { DEFAULT_SETTINGS } from "../../src/core/config/settings.js";
import type { FlashcardsSettings } from "../../src/core/config/settings.js";
import { computeCardHash } from "../../src/core/edits/card-hash.js";
import { insertCardAnchors } from "../../src/core/edits/insert-card-anchors.js";
import { extractCardsFromMarkdown } from "../../src/core/parse/extract-cards.js";
import { parseCardFrontmatter } from "../../src/core/sync/parse-card-frontmatter.js";
import type { MarkdownNote } from "../../src/application/ports.js";
import type { ObsidianMarkdownRepository } from "../../src/adapters/obsidian/obsidian-markdown-repository.js";
import { bootAllV2, makeFakeFetch } from "../_utils/fake-fetch.js";

/**
 * WI-5 — Golden retrocompatibility / no-loss gate (spec §4.6, invariants
 * I1/I2 from §4.1).
 *
 * This is a CHARACTERIZATION GATE. It locks the safety contract: a v1-style
 * note that is already in sync must sync as a complete no-op — no Anki
 * creates, no deletes, no spurious updates, no anchor regeneration, no file
 * writes, and idempotent on re-run.
 *
 * If this test fails, that is a real card-loss / scheduling-loss bug in the
 * production sync path, not a test defect. Do not weaken it to pass.
 */

const ALL_MODELS = [ANKI_MODEL_BASIC, ANKI_MODEL_REVERSED, ANKI_MODEL_CLOZE, ANKI_MODEL_REMINDER];
const VAULT = "MyVault";
const NOTE_PATH = "notes/sample.md";

// Two v1 (13-digit) anchor ids. These doubly serve as the Anki nids: in the
// v1 model the 13-digit blockId IS the note id (see build-sync-plan rule B/C).
const V1_HASHTAG_ID = "1111111111111";
const V1_INLINE_ID = "2222222222222";

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

// ---------------------------------------------------------------------------
// Fixture builder
// ---------------------------------------------------------------------------
//
// A v1-style note containing BOTH:
//   (a) a legacy `#card` whose answer carries a v1 `^<13d>` anchor (v1 inline
//       placement on the answer line), and
//   (b) an inline `Q::A` card carrying a trailing v1 `^<13d>` anchor.
//
// The `flashcards:` map is keyed by those two 13-digit ids, each with the
// CORRECT current hash so the note starts "in sync". Hashes are computed via
// the project's pipeline (extract → insertCardAnchors → computeCardHash) so
// they always match the parsed content regardless of parse details.

const BODY = [
  "What is TCP? #card",
  `Connection-oriented transport. ^${V1_HASHTAG_ID}`,
  "",
  `Capital of France?::Paris ^${V1_INLINE_ID}`,
  "",
].join("\n");

/**
 * Parse the body the way `syncNote` phase A does (extract + insertCardAnchors)
 * and return blockId → hash for the in-sync frontmatter map.
 */
function correctHashesFor(bodyMarkdown: string): Map<string, string> {
  const { cards } = extractCardsFromMarkdown(bodyMarkdown, {
    notePath: NOTE_PATH,
    settings: settingsWith(),
  });
  const insert = insertCardAnchors({
    cards,
    generateBlockId: () => "q-zzzz",
    markdown: bodyMarkdown,
  });
  const byId = new Map<string, string>();
  for (const card of insert.cards) {
    byId.set(card.blockId, computeCardHash(card));
  }
  return byId;
}

function buildInSyncNote(): string {
  const hashes = correctHashesFor(BODY);
  const hashtagHash = hashes.get(V1_HASHTAG_ID);
  const inlineHash = hashes.get(V1_INLINE_ID);
  if (hashtagHash === undefined || inlineHash === undefined) {
    throw new Error(
      `fixture precondition: expected both v1 ids to parse; got ${[...hashes.keys()].join(",")}`,
    );
  }
  return [
    "---",
    "flashcards:",
    `  "${V1_HASHTAG_ID}": { hash: ${hashtagHash} }`,
    `  "${V1_INLINE_ID}": { hash: ${inlineHash} }`,
    "---",
    "",
    BODY,
  ].join("\n");
}

function fmKeys(markdown: string): string[] {
  return parseCardFrontmatter(markdown)
    .entries.map((e) => e.blockId)
    .sort();
}

function fmHashByKey(markdown: string): Map<string, string | undefined> {
  const m = new Map<string, string | undefined>();
  for (const e of parseCardFrontmatter(markdown).entries) {
    m.set(e.blockId, e.hash);
  }
  return m;
}

// ===========================================================================
// Golden gate
// ===========================================================================

describe("golden v1 retrocompat — in-sync v1 note", () => {
  it("performs zero Anki creates and zero deletes (note-id set unchanged)", async () => {
    const note = buildInSyncNote();
    const { repository } = makeFakeRepository(note);
    // Bootstrap chatter only — no addNote/deleteNotes/updateNoteFields queued.
    // If the plan is non-empty, executeSyncPlan will drain past this queue and
    // FakeFetch throws "no queued response", surfacing the loss.
    const { calls, fetch } = makeFakeFetch([...bootAllV2(ALL_MODELS)]);

    const result = await syncNote({
      ankiClient: new AnkiConnectClient({ fetch }),
      note: makeNote(note),
      repository,
      settings: settingsWith(),
      vaultName: VAULT,
    });

    expect(result.status).toBe("ok");
    const mutating = calls
      .map((c) => c.action)
      .filter(
        (a) =>
          a === "addNote" ||
          a === "addNotes" ||
          a === "deleteNotes" ||
          a === "updateNoteFields",
      );
    expect(mutating).toEqual([]);
  });

  it("preserves both v1 anchor ids — frontmatter map keys unchanged (I1)", async () => {
    const note = buildInSyncNote();
    const { repository, currentMarkdown } = makeFakeRepository(note);
    const { fetch } = makeFakeFetch([...bootAllV2(ALL_MODELS)]);

    const keysBefore = fmKeys(note);

    await syncNote({
      ankiClient: new AnkiConnectClient({ fetch }),
      note: makeNote(note),
      repository,
      settings: settingsWith(),
      vaultName: VAULT,
    });

    expect(keysBefore).toEqual([V1_HASHTAG_ID, V1_INLINE_ID].sort());
    expect(fmKeys(currentMarkdown())).toEqual(keysBefore);
    // No new v2 anchor was minted for either already-anchored card.
    expect(currentMarkdown()).not.toContain("^q-");
    expect(currentMarkdown()).toContain(`^${V1_HASHTAG_ID}`);
    expect(currentMarkdown()).toContain(`^${V1_INLINE_ID}`);
  });

  it("leaves stored content hashes unchanged for unmodified cards (I2)", async () => {
    const note = buildInSyncNote();
    const { repository, currentMarkdown } = makeFakeRepository(note);
    const { fetch } = makeFakeFetch([...bootAllV2(ALL_MODELS)]);

    const hashesBefore = fmHashByKey(note);

    await syncNote({
      ankiClient: new AnkiConnectClient({ fetch }),
      note: makeNote(note),
      repository,
      settings: settingsWith(),
      vaultName: VAULT,
    });

    const hashesAfter = fmHashByKey(currentMarkdown());
    expect(hashesAfter.get(V1_HASHTAG_ID)).toBe(hashesBefore.get(V1_HASHTAG_ID));
    expect(hashesAfter.get(V1_INLINE_ID)).toBe(hashesBefore.get(V1_INLINE_ID));
  });

  it("writes nothing to the file on a clean in-sync run", async () => {
    const note = buildInSyncNote();
    const { repository, saves } = makeFakeRepository(note);
    const { fetch } = makeFakeFetch([...bootAllV2(ALL_MODELS)]);

    const result = await syncNote({
      ankiClient: new AnkiConnectClient({ fetch }),
      note: makeNote(note),
      repository,
      settings: settingsWith(),
      vaultName: VAULT,
    });

    expect(result.status).toBe("ok");
    expect(result.identityWritesApplied).toBe(0);
    expect(result.writebackEditsApplied).toBe(0);
    expect(saves).toEqual([]);
  });

  it("is idempotent — a second sync produces no file writes and no Anki calls", async () => {
    const note = buildInSyncNote();
    const { repository, saves, currentMarkdown } = makeFakeRepository(note);

    // First sync.
    await syncNote({
      ankiClient: new AnkiConnectClient({
        fetch: makeFakeFetch([...bootAllV2(ALL_MODELS)]).fetch,
      }),
      note: makeNote(note),
      repository,
      settings: settingsWith(),
      vaultName: VAULT,
    });
    const afterFirst = currentMarkdown();
    const savesAfterFirst = saves.length;

    // Second sync on the resulting note.
    const { calls, fetch } = makeFakeFetch([...bootAllV2(ALL_MODELS)]);
    const result = await syncNote({
      ankiClient: new AnkiConnectClient({ fetch }),
      note: makeNote(afterFirst),
      repository,
      settings: settingsWith(),
      vaultName: VAULT,
    });

    expect(result.status).toBe("ok");
    expect(saves.length).toBe(savesAfterFirst);
    const mutating = calls
      .map((c) => c.action)
      .filter(
        (a) =>
          a === "addNote" ||
          a === "addNotes" ||
          a === "deleteNotes" ||
          a === "updateNoteFields",
      );
    expect(mutating).toEqual([]);
  });
});
