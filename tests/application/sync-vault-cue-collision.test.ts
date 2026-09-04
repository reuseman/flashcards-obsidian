import { describe, expect, it } from "vitest";

import { syncVault, type SyncVaultResult } from "../../src/application/sync-vault.js";
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
import type { MarkdownNote } from "../../src/application/ports.js";
import type { ObsidianMarkdownRepository } from "../../src/adapters/obsidian/obsidian-markdown-repository.js";
import { bootAllV2, makeFakeFetch, ok } from "../_utils/fake-fetch.js";

/**
 * WI-12 — cue-collision lint (design §4.8). Identical normalized cue
 * (trim, casefold, collapse whitespace) across DIFFERENT notes fires a
 * `warn` lint, VAULT-LEVEL SYNC ONLY — both cards still sync. A single-note
 * sync has no visibility into other notes' cues, so it must never fire it.
 *
 * Cue evidence is carried out of the first parse and may also come from an
 * unchanged note that the incremental cache verified without reading.
 */

const ALL_MODELS = [ANKI_MODEL_BASIC, ANKI_MODEL_REVERSED, ANKI_MODEL_CLOZE, ANKI_MODEL_REMINDER];
const VAULT = "MyVault";

// Same normalized cue ("what is chlorophyll?") via trim + casefold + collapsed
// whitespace, authored differently in each note.
const CUE_A = "What Is    Chlorophyll?";
const CUE_B = "  what is chlorophyll?  ";

const FIRST_PARAGRAPH_A =
  "Chlorophyll absorbs light energy to drive the reactions.";
const FIRST_PARAGRAPH_B =
  "Chlorophyll is the primary pigment in the light reactions.";

function note(cue: string, firstParagraph: string): string {
  return ["---", "test:", `  - "${cue}"`, "---", "", firstParagraph].join("\n");
}

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

function vaultLintsOf(result: SyncVaultResult): string[] {
  return (result as unknown as { lints?: string[] }).lints ?? [];
}

function noteLintsOf(result: unknown): string[] {
  return (result as { lints?: string[] }).lints ?? [];
}

function reversedNote(): string {
  return ["---", "test:", "  - reversed", "---", "", FIRST_PARAGRAPH_A].join(
    "\n",
  );
}

const CLOZE_PARAGRAPH = "The powerhouse of the cell is the ==mitochondria==.";

function clozeNote(): string {
  return ["---", "test:", "  - cloze", "---", "", CLOZE_PARAGRAPH].join("\n");
}

describe("cue collision — vault-level lint only (WI-12)", () => {
  it("fires the cue-collision warn for TWO REVERSED-kind cards from different notes sharing the same title (WI-12 fix — scope was basic-only)", async () => {
    // Same basename ("Chlorophyll") in two different folders ⇒ same derived
    // `reversed` front (the note title), which is the collision surface.
    const noteA = makeNote("folder-a/Chlorophyll.md", reversedNote());
    const noteB = makeNote("folder-b/Chlorophyll.md", reversedNote());
    const repository = makeFakeRepo([noteA, noteB]);
    const { fetch } = makeFakeFetch([
      ...bootAllV2(ALL_MODELS),
      ok(["Default"]),
      ok(4101),
      ...bootAllV2(ALL_MODELS),
      ok(["Default"]),
      ok(4102),
    ]);

    const result = await syncVault({
      ankiClient: new AnkiConnectClient({ fetch }),
      generateBlockId: seededGenerator(["q-cccc", "q-dddd"]),
      repository,
      settings: settingsWith(),
      vaultName: VAULT,
    });

    const warnLints = vaultLintsOf(result).filter(
      (l) => /warn/i.test(l) && /collision/i.test(l),
    );
    expect(warnLints.length).toBeGreaterThan(0);
    expect(
      warnLints.some(
        (l) =>
          l.includes("folder-a/Chlorophyll.md") &&
          l.includes("folder-b/Chlorophyll.md"),
      ),
    ).toBe(true);
  });

  it("does NOT fire the cue-collision lint for two CLOZE-kind cards from different notes sharing an identical first paragraph (cloze fronts are excluded from cue-collision scope)", async () => {
    const noteA = makeNote("a-cloze.md", clozeNote());
    const noteB = makeNote("b-cloze.md", clozeNote());
    const repository = makeFakeRepo([noteA, noteB]);
    const { fetch } = makeFakeFetch([
      ...bootAllV2(ALL_MODELS),
      ok(["Default"]),
      ok(4201),
      ...bootAllV2(ALL_MODELS),
      ok(["Default"]),
      ok(4202),
    ]);

    const result = await syncVault({
      ankiClient: new AnkiConnectClient({ fetch }),
      generateBlockId: seededGenerator(["q-eeee", "q-ffff"]),
      repository,
      settings: settingsWith(),
      vaultName: VAULT,
    });

    const collisionLints = vaultLintsOf(result).filter((l) =>
      /collision/i.test(l),
    );
    expect(collisionLints).toHaveLength(0);
  });

  it("fires a warn lint on SyncVaultResult when two different notes share a normalized cue; both cards still sync", async () => {
    const noteA = makeNote("a.md", note(CUE_A, FIRST_PARAGRAPH_A));
    const noteB = makeNote("b.md", note(CUE_B, FIRST_PARAGRAPH_B));
    const repository = makeFakeRepo([noteA, noteB]);
    const { calls, fetch } = makeFakeFetch([
      ...bootAllV2(ALL_MODELS),
      ok(["Default"]),
      ok(4001), // addNote for noteA's cue card
      ...bootAllV2(ALL_MODELS),
      ok(["Default"]),
      ok(4002), // addNote for noteB's cue card
    ]);

    const result = await syncVault({
      ankiClient: new AnkiConnectClient({ fetch }),
      generateBlockId: seededGenerator(["q-aaaa", "q-bbbb"]),
      repository,
      settings: settingsWith(),
      vaultName: VAULT,
    });

    // Both cards still sync — the lint never suppresses either card.
    const addNoteCalls = calls.filter((c) => c.action === "addNote");
    expect(addNoteCalls).toHaveLength(2);
    expect(result.totalCreates).toBe(2);
    expect(result.failedNotes).toBe(0);

    const warnLints = vaultLintsOf(result).filter((l) => /warn/i.test(l));
    expect(warnLints.length).toBeGreaterThan(0);
    expect(
      warnLints.some(
        (l) => l.includes("a.md") && l.includes("b.md"),
      ),
    ).toBe(true);
  });

  it("does NOT fire the cue-collision lint on a single-note `syncNote` call, even when the same cue would collide vault-wide", async () => {
    const mdA = note(CUE_A, FIRST_PARAGRAPH_A);
    const mdB = note(CUE_B, FIRST_PARAGRAPH_B);
    const noteA = makeNote("a.md", mdA);
    const noteB = makeNote("b.md", mdB);

    const repoA = {
      async getActiveNote() {
        return noteA;
      },
      async saveNote(n: MarkdownNote, markdown: string) {
        n.markdown = markdown;
      },
    } as unknown as ObsidianMarkdownRepository;
    const repoB = {
      async getActiveNote() {
        return noteB;
      },
      async saveNote(n: MarkdownNote, markdown: string) {
        n.markdown = markdown;
      },
    } as unknown as ObsidianMarkdownRepository;

    const { fetch: fetchA } = makeFakeFetch([
      ...bootAllV2(ALL_MODELS),
      ok(["Default"]),
      ok(5001),
    ]);
    const { fetch: fetchB } = makeFakeFetch([
      ...bootAllV2(ALL_MODELS),
      ok(["Default"]),
      ok(5002),
    ]);

    const resultA = await syncNote({
      ankiClient: new AnkiConnectClient({ fetch: fetchA }),
      generateBlockId: seededGenerator(["q-aaaa"]),
      note: noteA,
      repository: repoA,
      settings: settingsWith(),
      vaultName: VAULT,
    });
    const resultB = await syncNote({
      ankiClient: new AnkiConnectClient({ fetch: fetchB }),
      generateBlockId: seededGenerator(["q-bbbb"]),
      note: noteB,
      repository: repoB,
      settings: settingsWith(),
      vaultName: VAULT,
    });

    expect(resultA.status).toBe("ok");
    expect(resultB.status).toBe("ok");
    const collisionLintsA = noteLintsOf(resultA).filter((l) =>
      /collision/i.test(l),
    );
    const collisionLintsB = noteLintsOf(resultB).filter((l) =>
      /collision/i.test(l),
    );
    expect(collisionLintsA).toHaveLength(0);
    expect(collisionLintsB).toHaveLength(0);
  });

  it("detects a collision between a verified cached note and a parsed note", async () => {
    const noteB = makeNote("b.md", note(CUE_B, FIRST_PARAGRAPH_B));
    const repository = makeFakeRepo([noteB]);
    const { fetch } = makeFakeFetch([
      ...bootAllV2(ALL_MODELS),
      ok(["Default"]),
      ok(6001),
    ]);

    const result = await syncVault({
      ankiClient: new AnkiConnectClient({ fetch }),
      cachedAtomicCues: [{
        cues: ["what is chlorophyll?"],
        notePath: "cached/a.md",
      }],
      generateBlockId: seededGenerator(["q-bbbb"]),
      repository,
      settings: settingsWith(),
      vaultName: VAULT,
    });

    expect(result.lints).toContain(
      "warn: cue collision across notes — cached/a.md, b.md",
    );
  });
});
