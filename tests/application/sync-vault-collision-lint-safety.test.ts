import { describe, expect, it, vi } from "vitest";

import type * as ExtractCardsModule from "../../src/core/parse/extract-cards.js";

/**
 * Final-review fix #3 — the cue-collision lint pass must be infallible.
 *
 * Cue evidence now comes from the main extraction rather than a second lint
 * pass. A pathological extraction throw is still isolated to its note, and
 * the remaining vault result must be returned normally.
 *
 * Locked expectation: a throwing extraction during the collision-lint pass
 * must NOT reject `syncVault` — the promise resolves, the poisoned note is
 * (already, via the per-note loop) marked `failed`, and every other note's
 * summary/totals are intact.
 */

const POISON_PATH = "poison.md";
const NORMAL_PATH = "normal.md";

vi.mock("../../src/core/parse/extract-cards.js", async (importOriginal) => {
  const actual = await importOriginal<typeof ExtractCardsModule>();
  return {
    ...actual,
    extractCardsFromMarkdown: (
      markdown: string,
      opts: { notePath: string; settings: unknown },
    ) => {
      if (opts.notePath === POISON_PATH) {
        throw new Error("simulated pathological extraction failure");
      }
      return actual.extractCardsFromMarkdown(
        markdown,
        opts as Parameters<typeof actual.extractCardsFromMarkdown>[1],
      );
    },
  };
});

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
import type { MarkdownNote } from "../../src/application/ports.js";
import type { ObsidianMarkdownRepository } from "../../src/adapters/obsidian/obsidian-markdown-repository.js";
import { bootAllV2, makeFakeFetch, ok } from "../_utils/fake-fetch.js";

const ALL_MODELS = [ANKI_MODEL_BASIC, ANKI_MODEL_REVERSED, ANKI_MODEL_CLOZE, ANKI_MODEL_REMINDER];
const VAULT = "MyVault";

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

function seededGenerator(ids: string[]): () => string {
  let i = 0;
  return () => ids[i++] ?? `q-zz${i}`;
}

const NORMAL_MARKDOWN = ["Q1::A1", ""].join("\n");
const POISON_MARKDOWN = ["Q2::A2", ""].join("\n");

describe("syncVault — cue extraction failure isolation", () => {
  it("resolves syncVault, keeps the poisoned note's `failed` status, and leaves the healthy note's totals intact", async () => {
    const normalNote = makeNote(NORMAL_PATH, NORMAL_MARKDOWN);
    const poisonNote = makeNote(POISON_PATH, POISON_MARKDOWN);
    const repository = makeFakeRepo([normalNote, poisonNote]);
    const { fetch } = makeFakeFetch([
      ...bootAllV2(ALL_MODELS),
      ok(["Default"]),
      ok(77001), // addNote for the healthy note
    ]);

    let result: Awaited<ReturnType<typeof syncVault>> | undefined;
    let threw: unknown;
    try {
      result = await syncVault({
        ankiClient: new AnkiConnectClient({ fetch }),
        generateBlockId: seededGenerator(["q-gggg"]),
        repository,
        settings: settingsWith(),
        vaultName: VAULT,
      });
    } catch (e) {
      threw = e;
    }

    expect(threw).toBeUndefined();
    expect(result).toBeDefined();
    expect(
      result?.perNote.find((r) => r.notePath === POISON_PATH)?.status,
    ).toBe("failed");
    expect(
      result?.perNote.find((r) => r.notePath === NORMAL_PATH)?.status,
    ).toBe("ok");
    expect(result?.totalCreates).toBe(1);
    expect(result?.noteCount).toBe(2);
  });
});
