import { describe, expect, it } from "vitest";

import { syncNote, type SyncNoteResult } from "../../src/application/sync-note.js";
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
 * WI-12 — sync-time lints, `syncNote` aggregation surface (design §4.8,
 * item 5). Lints are collected per sync and exposed on the result (adapter-
 * consumable), never thrown, and never suppress unrelated cards.
 *
 * `SyncNoteResult` does not yet expose a `lints` field — accessed via a
 * defensive cast + `?? []` so assertions fail as real AssertionErrors.
 */

const ALL_MODELS = [ANKI_MODEL_BASIC, ANKI_MODEL_REVERSED, ANKI_MODEL_CLOZE];
const VAULT = "MyVault";
const NOTE_PATH = "notes/sample.md";
const NOTE_TITLE = "sample";

function settingsWith(
  overrides: Partial<FlashcardsSettings> = {},
): FlashcardsSettings {
  return { ...DEFAULT_SETTINGS, folderBasedDecks: false, ...overrides };
}

function makeNote(markdown: string): MarkdownNote {
  return {
    file: {} as MarkdownNote["file"],
    markdown,
    name: NOTE_TITLE,
    path: NOTE_PATH,
  };
}

function makeFakeRepository(initial: string): {
  repository: ObsidianMarkdownRepository;
  saves: string[];
} {
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
  return { repository: repo, saves };
}

function seededGenerator(ids: string[]): () => string {
  let i = 0;
  return () => ids[i++] ?? `q-zz${i}`;
}

function note(frontmatterLines: string[], bodyLines: string[]): string {
  return ["---", ...frontmatterLines, "---", "", ...bodyLines].join("\n");
}

function lintsOf(result: SyncNoteResult): string[] {
  return (result as unknown as { lints?: string[] }).lints ?? [];
}

interface SpyLogger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
  warnCalls: Array<{ message: string; data?: unknown }>;
  errorCalls: Array<{ message: string; data?: unknown }>;
}

function makeSpyLogger(): SpyLogger {
  const warnCalls: Array<{ message: string; data?: unknown }> = [];
  const errorCalls: Array<{ message: string; data?: unknown }> = [];
  return {
    debug: () => {},
    info: () => {},
    warn: (message: string, data?: unknown) => {
      warnCalls.push({ message, data });
    },
    error: (message: string, data?: unknown) => {
      errorCalls.push({ message, data });
    },
    warnCalls,
    errorCalls,
  };
}

const FIRST_PARAGRAPH =
  "Chlorophyll absorbs light energy to drive the reactions.";

describe("syncNote — atomic sync-time lints (WI-12)", () => {
  it("an invalid `test:` value with no other card syntax fires an error lint on the result, even on the skip path", async () => {
    const md = note(["test: true"], [FIRST_PARAGRAPH]);
    const { repository } = makeFakeRepository(md);
    const { calls, fetch } = makeFakeFetch([]);
    const logger = makeSpyLogger();

    const result = await syncNote({
      ankiClient: new AnkiConnectClient({ fetch }),
      logger,
      note: makeNote(md),
      repository,
      settings: settingsWith(),
      vaultName: VAULT,
    });

    // No cards anywhere in the note ⇒ skip, but the lint must still surface.
    expect(calls).toEqual([]);
    const errorLints = lintsOf(result).filter((l) => /error/i.test(l));
    expect(errorLints.length).toBeGreaterThan(0);
    expect(errorLints.some((l) => l.includes(NOTE_PATH))).toBe(true);

    const errorLogCalls = logger.errorCalls.filter((c) =>
      /test:|invalid/i.test(c.message),
    );
    expect(errorLogCalls.length).toBeGreaterThan(0);
  });

  it("cloze-without-spans drops only the cloze item; sibling `title` card still syncs, and a warn lint is aggregated", async () => {
    const noSpan = "No marked span in this paragraph whatsoever.";
    const md = note(["test:", "  - title", "  - cloze"], [noSpan]);
    const { repository } = makeFakeRepository(md);
    const { calls, fetch } = makeFakeFetch([
      ...bootAllV2(ALL_MODELS),
      ok(["Default"]),
      ok(3001), // addNote for the surviving `title` card only
    ]);
    const logger = makeSpyLogger();

    const result = await syncNote({
      ankiClient: new AnkiConnectClient({ fetch }),
      generateBlockId: seededGenerator(["q-aaaa"]),
      logger,
      note: makeNote(md),
      repository,
      settings: settingsWith(),
      vaultName: VAULT,
    });

    expect(result.status).toBe("ok");
    const addNoteCalls = calls.filter((c) => c.action === "addNote");
    expect(addNoteCalls).toHaveLength(1); // the cloze item never reached Anki

    const warnLints = lintsOf(result).filter((l) => /warn/i.test(l));
    expect(warnLints.length).toBeGreaterThan(0);
    expect(warnLints.some((l) => /cloze/i.test(l) && /span/i.test(l))).toBe(
      true,
    );

    const warnLogCalls = logger.warnCalls.filter((c) => /cloze/i.test(c.message));
    expect(warnLogCalls.length).toBeGreaterThan(0);
  });
});
