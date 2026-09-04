import { describe, expect, it, vi } from "vitest";

import { syncNote } from "../../src/application/sync-note.js";
import type { SyncNoteInput } from "../../src/application/sync-note.js";
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
import type { MarkdownNote } from "../../src/application/ports.js";
import type { ObsidianMarkdownRepository } from "../../src/adapters/obsidian/obsidian-markdown-repository.js";
import { bootAllV2, makeFakeFetch, ok } from "../_utils/fake-fetch.js";

/**
 * Final-review fix #2 — zero-cards early return strands atomic orphans
 * (spec §4.2).
 *
 * `syncNote` returns `{ status: "skipped" }` the instant `cards.length === 0`
 * (src/application/sync-note.ts:117-127), BEFORE `buildSyncPlan` ever runs.
 * When a note that previously synced ONE atomic card is edited so the
 * `test:` grammar now yields zero cards — either the first paragraph is
 * removed (thin note) or the `test:` key itself is deleted — the
 * cue-bearing frontmatter entry (still carrying a live `nid`) is never
 * offered to `confirmDeletions`. The card silently rots in Anki with no
 * chance for the user to weigh in, violating delete-safety (WI-4).
 *
 * Locked scope decision: only notes whose frontmatter still has CUE-BEARING
 * entries with `nid`s proceed to plan-building on a zero-card extraction.
 * Legacy (never-had-a-cue) zero-card notes keep today's `"skipped"`
 * behavior untouched.
 */

const ALL_MODELS = [ANKI_MODEL_BASIC, ANKI_MODEL_REVERSED, ANKI_MODEL_CLOZE, ANKI_MODEL_REMINDER];
const VAULT = "MyVault";
const NOTE_PATH = "notes/Zero card orphan.md";
const TITLE = "Zero card orphan";
const CUE = "What warrants a card here, precisely?";
const FIRST_PARAGRAPH = "An answer paragraph backing the atomic cue card.";

function settingsWith(
  overrides: Partial<FlashcardsSettings> = {},
): FlashcardsSettings {
  return { ...DEFAULT_SETTINGS, folderBasedDecks: false, ...overrides };
}

function makeNote(markdown: string): MarkdownNote {
  return {
    file: {} as MarkdownNote["file"],
    markdown,
    name: TITLE,
    path: NOTE_PATH,
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
      return makeNote(current);
    },
    async saveNote(_note: MarkdownNote, markdown: string) {
      current = markdown;
    },
  } as unknown as ObsidianMarkdownRepository;
  return { repository: repo, currentMarkdown: () => current };
}

function withCueFixture(): string {
  return ["---", "test:", `  - "${CUE}"`, "---", "", FIRST_PARAGRAPH, ""].join(
    "\n",
  );
}

/** Sync the cue fixture once; return the resulting entry (blockId + nid). */
async function syncOnce(): Promise<{
  markdown: string;
  blockId: string;
  nid: number;
}> {
  const md = withCueFixture();
  const { repository, currentMarkdown } = makeFakeRepository(md);
  const { fetch } = makeFakeFetch([
    ...bootAllV2(ALL_MODELS),
    ok(["Default"]),
    ok(66001),
  ]);

  await syncNote({
    ankiClient: new AnkiConnectClient({ fetch }),
    note: makeNote(md),
    repository,
    settings: settingsWith(),
    vaultName: VAULT,
  });

  const inSync = currentMarkdown();
  const entry = parseCardFrontmatter(inSync).entries[0];
  expect(entry?.nid).toBeDefined();
  expect(entry?.blockId).toBeDefined();
  return { markdown: inSync, blockId: entry!.blockId, nid: entry!.nid! };
}

describe("syncNote — zero-cards early return must not strand atomic orphans (spec §4.2)", () => {
  it("removing the first paragraph (thin note, `test:` key retained) still offers the orphaned cue entry to confirmDeletions", async () => {
    const { markdown: inSync, blockId, nid } = await syncOnce();

    // Strip the first paragraph → `test:` key present, zero atomic cards
    // extracted ("thin" per extract-atomic-cards-lints.test.ts).
    const stripped = inSync.replace(`\n${FIRST_PARAGRAPH}\n`, "\n");

    const confirmDeletions = vi.fn(async () => false);
    const { repository } = makeFakeRepository(stripped);
    // No Anki responses queued at all: a correctly-gated decline must never
    // reach the network.
    const { calls, fetch } = makeFakeFetch([]);

    const result = await syncNote({
      ankiClient: new AnkiConnectClient({ fetch }),
      confirmDeletions,
      note: makeNote(stripped),
      repository,
      settings: settingsWith({ confirmBeforeDelete: true }),
      vaultName: VAULT,
    } as SyncNoteInput);

    expect(result.status).not.toBe("failed");
    expect(confirmDeletions).toHaveBeenCalledTimes(1);
    expect(confirmDeletions).toHaveBeenCalledWith([
      expect.objectContaining({ blockId, nid }),
    ]);
    // Declined → skip-safety, never a silent delete: zero Anki calls.
    expect(calls).toHaveLength(0);
  });

  it("removing the `test:` key entirely (paragraph retained) still offers the orphaned cue entry to confirmDeletions", async () => {
    const { markdown: inSync, blockId, nid } = await syncOnce();

    // Delete the `test:` key + its item, leaving the frontmatter's
    // `flashcards:` cue-bearing map entry (from the prior sync) intact and
    // the body paragraph untouched.
    const stripped = inSync
      .replace(/test:\n(\s*- .+\n)+/, "")
      .replace(/test: .*\n/, "");
    expect(stripped).not.toContain("test:");

    const confirmDeletions = vi.fn(async () => false);
    const { repository } = makeFakeRepository(stripped);
    const { calls, fetch } = makeFakeFetch([]);

    const result = await syncNote({
      ankiClient: new AnkiConnectClient({ fetch }),
      confirmDeletions,
      note: makeNote(stripped),
      repository,
      settings: settingsWith({ confirmBeforeDelete: true }),
      vaultName: VAULT,
    } as SyncNoteInput);

    expect(result.status).not.toBe("failed");
    expect(confirmDeletions).toHaveBeenCalledTimes(1);
    expect(confirmDeletions).toHaveBeenCalledWith([
      expect.objectContaining({ blockId, nid }),
    ]);
    expect(calls).toHaveLength(0);
  });
});
