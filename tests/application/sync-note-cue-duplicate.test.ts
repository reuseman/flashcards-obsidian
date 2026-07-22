import { describe, expect, it } from "vitest";

import { syncNote } from "../../src/application/sync-note.js";
import { AnkiConnectClient } from "../../src/adapters/anki/anki-connect-client.js";
import {
  ANKI_MODEL_BASIC,
  ANKI_MODEL_REVERSED,
  ANKI_MODEL_CLOZE,
} from "../../src/core/render/render-card.js";
import { DEFAULT_SETTINGS } from "../../src/core/config/settings.js";
import type { FlashcardsSettings } from "../../src/core/config/settings.js";
import { computeCueHash } from "../../src/core/edits/card-hash.js";
import { parseCardFrontmatter } from "../../src/core/sync/parse-card-frontmatter.js";
import type { PendingDeletion } from "../../src/core/sync/sync-plan.js";
import type { MarkdownNote } from "../../src/application/ports.js";
import type { ObsidianMarkdownRepository } from "../../src/adapters/obsidian/obsidian-markdown-repository.js";
import { bootAllV2, makeFakeFetch, ok } from "../_utils/fake-fetch.js";

/**
 * WI-9 fix (review finding #3) — hand-edited frontmatter can contain two
 * `flashcards:` entries under different blockIds that share the same `cue`
 * value (this is not something the writer ever produces itself, but nothing
 * currently guards against a human editing the block by hand).
 *
 * `sync-note.ts` builds `existingCueEntries` as:
 *   new Map(entries.filter(cue !== undefined).map(e => [e.cue, e]))
 * Map construction keeps the LAST write for a repeated key — so of the two
 * entries sharing a cue, the one that appears LATER in file order is the one
 * a re-parsed card matches. The earlier entry becomes an orphan: it must
 * never be silently deleted (WI-4 delete-safety) — it must flow through
 * `confirmDeletions`.
 */

const ALL_MODELS = [ANKI_MODEL_BASIC, ANKI_MODEL_REVERSED, ANKI_MODEL_CLOZE];
const VAULT = "MyVault";
const NOTE_PATH = "notes/Dup cue.md";
const TITLE = "Dup cue";
const FIRST_PARAGRAPH = "Some first paragraph about duplication handling.";

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

describe("syncNote — WI-9 fix: two frontmatter entries sharing one `cue` (hand-edited, last-in-file-order wins)", () => {
  it("matches the parsed card to the LATER entry (q-bbbb); the earlier entry (q-aaaa) is an unmatched orphan routed through confirmDeletions, never silently deleted", async () => {
    const cue = computeCueHash("basic", TITLE);
    const md = [
      "---",
      "test:",
      "  - title",
      "flashcards:",
      `  q-aaaa: { cue: ${cue}, hash: stalehashone, nid: 1111111111111 }`,
      `  q-bbbb: { cue: ${cue}, hash: stalehashtwo, nid: 2222222222222 }`,
      "---",
      "",
      FIRST_PARAGRAPH,
      "",
    ].join("\n");

    // Sanity: the hand fixture really does carry two distinct fm entries
    // sharing the same cue, before any pipeline logic runs on it.
    const rawEntries = parseCardFrontmatter(md).entries;
    expect(rawEntries).toHaveLength(2);
    expect(rawEntries.map((e) => e.cue)).toEqual([cue, cue]);

    const { repository, currentMarkdown } = makeFakeRepository(md);
    const { calls, fetch } = makeFakeFetch([
      ...bootAllV2(ALL_MODELS),
      ok(true), // updateNoteFields — the matched card's actual hash differs from the stale one
    ]);

    let confirmDeletionsCallCount = 0;
    const capturedPending: PendingDeletion[] = [];

    const result = await syncNote({
      ankiClient: new AnkiConnectClient({ fetch }),
      confirmDeletions: async (pending) => {
        confirmDeletionsCallCount++;
        capturedPending.push(...pending);
        return false; // never confirm — assert nothing is silently deleted
      },
      note: makeNote(md, NOTE_PATH, "Dup cue"),
      repository,
      settings: settingsWith({ confirmBeforeDelete: true }),
      vaultName: VAULT,
    });

    expect(result.status).toBe("ok");

    // The card matched q-bbbb (later in file order) — its update carries
    // q-bbbb's nid, not q-aaaa's.
    expect(calls.map((c) => c.action)).toContain("updateNoteFields");
    const updateCall = calls.find((c) => c.action === "updateNoteFields");
    expect(updateCall?.params).toMatchObject({ note: { id: 2222222222222 } });

    // The orphaned q-aaaa entry must have been offered to confirmDeletions —
    // never silently dropped.
    expect(confirmDeletionsCallCount).toBe(1);
    expect(capturedPending.map((p) => p.nid)).toContain(1111111111111);

    // No confirmer approval was given, so the delete must never have been
    // sent to Anki.
    expect(calls.map((c) => c.action)).not.toContain("deleteNotes");

    // Because the deletion was declined, the stale q-aaaa entry must still
    // be present in the saved frontmatter (never silently removed).
    const finalEntries = parseCardFrontmatter(currentMarkdown()).entries;
    expect(finalEntries.some((e) => e.blockId === "q-aaaa")).toBe(true);
  });
});
