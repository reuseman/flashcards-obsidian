import { describe, expect, it, vi } from "vitest";

import { syncVault } from "../../src/application/sync-vault.js";
import { AnkiConnectClient } from "../../src/adapters/anki/anki-connect-client.js";
import {
  ANKI_MODEL_BASIC,
  ANKI_MODEL_CLOZE,
  ANKI_MODEL_REMINDER,
  ANKI_MODEL_REVERSED,
} from "../../src/core/render/render-card.js";
import { DEFAULT_SETTINGS } from "../../src/core/config/settings.js";
import type { FlashcardsSettings } from "../../src/core/config/settings.js";
import { parseCardFrontmatter } from "../../src/core/sync/parse-card-frontmatter.js";
import { computeCueHash } from "../../src/core/edits/card-hash.js";
import type { MarkdownNote } from "../../src/application/ports.js";
import type { ObsidianMarkdownRepository } from "../../src/adapters/obsidian/obsidian-markdown-repository.js";
import { bootAllV2, makeFakeFetch, ok } from "../_utils/fake-fetch.js";

/**
 * Final-review fix #4 — `confirmRebinds` must thread through `syncVault`.
 *
 * `SyncVaultInput` (src/application/sync-vault.ts) has no `confirmRebinds`
 * field at all, so a vault-level sync can never offer the WI-11
 * cue-rephrase-rebind pairing to a caller-supplied confirmer — it always
 * falls through to the "no confirmer wired" default (decline), even when
 * the host app (Obsidian command) wires a confirmer for exactly this
 * purpose.
 *
 * Locked expectation: `syncVault` accepts `confirmRebinds` and forwards it
 * to every `syncNote` call. When a note has exactly one rephrased cue
 * (one atomic orphan + one atomic CREATE) and the confirmer accepts, the
 * pair collapses into a single scheduling-preserving UPDATE (same nid) —
 * mirroring the syncNote-level contract locked in
 * `sync-note-rebind.test.ts`.
 */

const ALL_MODELS = [ANKI_MODEL_BASIC, ANKI_MODEL_REVERSED, ANKI_MODEL_CLOZE, ANKI_MODEL_REMINDER];
const VAULT = "MyVault";
const NOTE_PATH = "notes/Vault rebind me.md";
const OLD_CUE = "What is the old vault question, precisely?";
const NEW_CUE = "What is the completely rephrased vault question?";
const FIRST_PARAGRAPH = "Some first paragraph relevant to the vault rebind.";

function settingsWith(
  overrides: Partial<FlashcardsSettings> = {},
): FlashcardsSettings {
  return { ...DEFAULT_SETTINGS, folderBasedDecks: false, ...overrides };
}

function makeNote(path: string, markdown: string): MarkdownNote {
  return {
    file: {} as MarkdownNote["file"],
    markdown,
    name: path.replace(/\.md$/, ""),
    path,
  };
}

function makeFakeRepo(notes: MarkdownNote[]): ObsidianMarkdownRepository {
  return {
    async getAllMarkdownNotes() {
      return notes;
    },
    async getActiveNote() {
      return notes[0] ?? null;
    },
    async saveNote(note: MarkdownNote, markdown: string) {
      note.markdown = markdown;
    },
  } as unknown as ObsidianMarkdownRepository;
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

/** Syncs the base fixture once via syncVault; returns the in-sync note. */
async function syncOnceViaVault(): Promise<{
  note: MarkdownNote;
  nid: number;
  blockId: string;
}> {
  const md = baseFixture(OLD_CUE);
  const note = makeNote(NOTE_PATH, md);
  const repository = makeFakeRepo([note]);
  const { fetch } = makeFakeFetch([
    ...bootAllV2(ALL_MODELS),
    ok(["Default"]),
    ok(88001), // addNote
  ]);

  await syncVault({
    ankiClient: new AnkiConnectClient({ fetch }),
    repository,
    settings: settingsWith(),
    vaultName: VAULT,
  });

  const entries = parseCardFrontmatter(note.markdown).entries;
  expect(entries).toHaveLength(1);
  expect(entries[0]?.nid).toBeDefined();
  return {
    note,
    nid: entries[0]!.nid!,
    blockId: entries[0]!.blockId,
  };
}

describe("syncVault — confirmRebinds threading (WI-11 at vault level)", () => {
  it("forwards a vault-level confirmRebinds to syncNote; accepted rebind collapses orphan+CREATE into a single update-in-place (same nid)", async () => {
    const { note, nid: oldNid, blockId: oldBlockId } = await syncOnceViaVault();

    // Rephrase the cue → next sync would otherwise produce one atomic orphan
    // + one atomic CREATE (the pairing precondition).
    note.markdown = note.markdown.replace(OLD_CUE, NEW_CUE);
    const repository = makeFakeRepo([note]);

    // Queue matches TODAY's actual behavior: confirmRebinds isn't threaded
    // at all, so it's never consulted; the orphan is retained (no
    // confirmDeletions wired, default decline), and the CREATE proceeds.
    const { calls, fetch } = makeFakeFetch([
      ...bootAllV2(ALL_MODELS),
      ok(["Default"]), // must NOT be reached once fixed (no addNote needed)
      ok(9999), // addNote — must NOT be reached once fixed
    ]);

    let rebindCallCount = 0;
    const confirmRebinds = vi.fn(async () => {
      rebindCallCount++;
      return true;
    });

    const result = await syncVault({
      ankiClient: new AnkiConnectClient({ fetch }),
      confirmRebinds,
      repository,
      settings: settingsWith({ confirmBeforeDelete: true }),
      vaultName: VAULT,
    } as Parameters<typeof syncVault>[0]);

    expect(result.failedNotes).toBe(0);
    expect(rebindCallCount).toBe(1);
    expect(calls.map((c) => c.action)).not.toContain("addNote");
    expect(calls.map((c) => c.action)).not.toContain("deleteNotes");
    expect(calls.map((c) => c.action)).toContain("updateNoteFields");
    const updateCall = calls.find((c) => c.action === "updateNoteFields");
    expect(updateCall?.params).toMatchObject({ note: { id: oldNid } });

    const entries = parseCardFrontmatter(note.markdown).entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.blockId).toBe(oldBlockId);
    expect(entries[0]?.nid).toBe(oldNid);
    expect(entries[0]?.cue).toBe(computeCueHash("basic", NEW_CUE));
  });
});
