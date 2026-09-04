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
import type { MarkdownNote } from "../../src/application/ports.js";
import type { ObsidianMarkdownRepository } from "../../src/adapters/obsidian/obsidian-markdown-repository.js";
import { previewSyncPlan } from "../../src/application/preview-sync-plan.js";
import { bootAllV2, makeFakeFetch } from "../_utils/fake-fetch.js";

/**
 * WI-9 fix (review finding #1) — status-bar / plan-preview parity.
 *
 * `status-bar.ts` currently re-implements Phase A + Phase B planning
 * in-memory (insertCardAnchors + buildSyncPlan) WITHOUT the cue-match step
 * that `syncNote` runs for atomic cards. For an atomic-only note that is
 * already in sync, that duplicated path would report a perpetual CREATE
 * (no cue lookup ⇒ no blockId ⇒ treated as brand new every time).
 *
 * The fix: extract the anchor+cue-match+buildSyncPlan orchestration into a
 * single shared application-layer function, `previewSyncPlan`, consumed by
 * both `syncNote` and the status-bar adapter. It does not exist yet — this
 * test locks its expected shape and behavior via a dynamic import so the
 * red is an assertion failure (missing export), not a bare module-resolution
 * crash that would abort the whole test file.
 */

const ALL_MODELS = [ANKI_MODEL_BASIC, ANKI_MODEL_REVERSED, ANKI_MODEL_CLOZE, ANKI_MODEL_REMINDER];
const VAULT = "MyVault";
const NOTE_PATH = "notes/Preview parity.md";

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

describe("previewSyncPlan (application) — shared cue-matching preview path", () => {
  it("treats Obsidian block-style card metadata as existing, not new", () => {
    const md = [
      "---",
      "flashcards:",
      "  q-abcd:",
      "    nid: 1714056234891",
      "    hash: stalehash",
      "    sync: stalesync",
      "---",
      "",
      "What is parsed?:: An existing card. ^q-abcd",
    ].join("\n");

    const preview = previewSyncPlan({
      markdown: md,
      notePath: NOTE_PATH,
      settings: settingsWith(),
    });

    expect(preview.create).toBe(0);
    expect(preview.update).toBe(1);
    expect(preview.frontmatter.entries).toEqual([
      {
        blockId: "q-abcd",
        hash: "stalehash",
        nid: 1714056234891,
        sync: "stalesync",
      },
    ]);
  });

  it("surfaces parser warnings as sync-time lints", () => {
    const preview = previewSyncPlan({
      markdown: "The {1:answer is not closed.",
      notePath: NOTE_PATH,
      settings: settingsWith(),
    });

    expect(preview.lints).toEqual([
      expect.stringMatching(/Malformed cloze.*missing `}`/),
    ]);
  });

  it("reports zero pending create/update/delete for an already-synced atomic note", async () => {
    const md = [
      "---",
      "test:",
      "  - title",
      "---",
      "",
      "A first paragraph about something specific.",
      "",
    ].join("\n");

    const { repository, currentMarkdown } = makeFakeRepository(md);
    const { fetch } = makeFakeFetch([
      ...bootAllV2(ALL_MODELS),
      { body: { error: null, result: ["Default"] } },
      { body: { error: null, result: 9001 } },
    ]);

    await syncNote({
      ankiClient: new AnkiConnectClient({ fetch }),
      note: makeNote(md, NOTE_PATH, "Preview parity"),
      repository,
      settings: settingsWith(),
      vaultName: VAULT,
    });
    const inSync = currentMarkdown();

    interface PreviewSyncPlanModule {
      previewSyncPlan: (input: {
        markdown: string;
        notePath: string;
        settings: FlashcardsSettings;
      }) => { create: number; delete: number; update: number };
    }

    let previewMod: PreviewSyncPlanModule | null = null;
    try {
      const modulePath = "../../src/application/preview-sync-plan.js";
      previewMod = (await import(modulePath)) as unknown as PreviewSyncPlanModule;
    } catch (e) {
      expect.fail(
        `previewSyncPlan not yet implemented at src/application/preview-sync-plan.js ` +
          `(should extract the insertCardAnchors + cue-match + buildSyncPlan pipeline ` +
          `shared by syncNote and the status-bar adapter). Import error: ${String(e)}`,
      );
      return;
    }

    expect(typeof previewMod.previewSyncPlan).toBe("function");

    const preview = previewMod.previewSyncPlan({
      markdown: inSync,
      notePath: NOTE_PATH,
      settings: settingsWith(),
    });

    // Behavioral lock for once the function exists: an unchanged atomic note
    // must preview as fully in sync — zero pending actions of any kind. The
    // naive status-bar path (no cue matching) would instead report 1 pending
    // create forever, since it never resolves the atomic card's blockId.
    expect(preview.create).toBe(0);
    expect(preview.update).toBe(0);
    expect(preview.delete).toBe(0);
  });
});
