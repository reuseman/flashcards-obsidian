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
import { parseCardFrontmatter } from "../../src/core/sync/parse-card-frontmatter.js";
import type { MarkdownNote } from "../../src/application/ports.js";
import type { ObsidianMarkdownRepository } from "../../src/adapters/obsidian/obsidian-markdown-repository.js";
import { bootAllV2, makeFakeFetch, ok } from "../_utils/fake-fetch.js";

/**
 * WI-9 — anchorless, cue-bound identity for atomic (`test:`) cards.
 * Design §4.4, invariants I3/I4 (§7).
 *
 * These are application-level locks on the full `syncNote` pipeline —
 * narrower and more isolated than the (still `describe.skip`) WI-13 golden
 * gate `golden-atomic-mixed.test.ts`, which mixes atomic with fenced/hashtag
 * syntaxes. Every fixture here is atomic-only.
 *
 * Mechanism under test (none of it exists yet):
 *  - `insertCardAnchors` skips `syntax === "atomic"` cards entirely (I3):
 *    zero body edits, ever.
 *  - Atomic cards get their blockId assigned by a `cue` lookup against the
 *    note's `flashcards:` map BEFORE plan building (matching), not via
 *    body-anchor scanning.
 *  - `write-card-frontmatter` persists `cue` for atomic entries.
 */

const ALL_MODELS = [ANKI_MODEL_BASIC, ANKI_MODEL_REVERSED, ANKI_MODEL_CLOZE];
const VAULT = "MyVault";

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
      return makeNote(current, "notes/unused.md", "unused");
    },
    async saveNote(_note: MarkdownNote, markdown: string) {
      saves.push(markdown);
      current = markdown;
    },
  } as unknown as ObsidianMarkdownRepository;
  return { repository: repo, saves, currentMarkdown: () => current };
}

function makeNote(markdown: string, notePath: string, name: string): MarkdownNote {
  return {
    file: {} as MarkdownNote["file"],
    markdown,
    name,
    path: notePath,
  };
}

function settingsWith(
  overrides: Partial<FlashcardsSettings> = {},
): FlashcardsSettings {
  return { ...DEFAULT_SETTINGS, folderBasedDecks: false, ...overrides };
}

function stripFrontmatter(markdown: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(markdown);
  if (!match) return markdown;
  return markdown.slice(match[0].length);
}

function mutatingCalls(calls: Array<{ action: string }>): string[] {
  return calls
    .map((c) => c.action)
    .filter(
      (a) =>
        a === "addNote" ||
        a === "addNotes" ||
        a === "deleteNotes" ||
        a === "updateNoteFields",
    );
}

function bootWithCreates(n: number): ReturnType<typeof makeFakeFetch> {
  return makeFakeFetch([
    ...bootAllV2(ALL_MODELS),
    ok(["Default"]), // deckNames
    ...Array.from({ length: n }, (_, i) => ok(9000 + i)), // addNote x n
  ]);
}

// ===========================================================================
// I3 — no body writes for atomic cards.
// ===========================================================================

describe("syncNote — WI-9 I3: pure-atomic note never mutates the body", () => {
  it("only the `flashcards:` frontmatter block changes; the body is byte-identical", async () => {
    const NOTE_PATH = "notes/Single topic.md";
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
    const { fetch } = bootWithCreates(1);

    await syncNote({
      ankiClient: new AnkiConnectClient({ fetch }),
      note: makeNote(md, NOTE_PATH, "Single topic"),
      repository,
      settings: settingsWith(),
      vaultName: VAULT,
    });

    const before = stripFrontmatter(md);
    const after = stripFrontmatter(currentMarkdown());
    expect(after).toBe(before);
    expect(after).not.toMatch(/\^q-[abcdefghijkmnpqrstuvwxyz23456789]{4}/);
  });
});

// ===========================================================================
// I4 — reordering the `test:` list is a sync no-op.
// ===========================================================================

describe("syncNote — WI-9 I4: `test:` list reorder is a sync no-op", () => {
  it("reordering [title, cue] to [cue, title] after a first sync triggers zero further actions", async () => {
    const NOTE_PATH = "notes/Reorder me.md";
    const CUE = "What is the custom question?";
    const md = [
      "---",
      "test:",
      "  - title",
      `  - "${CUE}"`,
      "---",
      "",
      "A first paragraph about something specific.",
      "",
    ].join("\n");

    const { repository, currentMarkdown } = makeFakeRepository(md);
    const { fetch } = bootWithCreates(2);

    await syncNote({
      ankiClient: new AnkiConnectClient({ fetch }),
      note: makeNote(md, NOTE_PATH, "Reorder me"),
      repository,
      settings: settingsWith(),
      vaultName: VAULT,
    });
    const inSync = currentMarkdown();

    // Build the reordered `test:` list explicitly by swapping the two list
    // *lines* in place (same indentation, same trailing newline for both) —
    // safer than a whitespace-eating regex, which risks consuming the
    // newline of the preceding `test:` key line and corrupting the YAML.
    const lines = inSync.split("\n");
    const titleLineIdx = lines.findIndex((l) => l.trim() === "- title");
    const cueLineIdx = lines.findIndex((l) => l.trim() === `- "${CUE}"`);
    expect(titleLineIdx).toBeGreaterThan(-1);
    expect(cueLineIdx).toBeGreaterThan(-1);
    const reorderedLines = [...lines];
    reorderedLines[titleLineIdx] = lines[cueLineIdx]!;
    reorderedLines[cueLineIdx] = lines[titleLineIdx]!;
    const reordered = reorderedLines.join("\n");
    expect(reordered).not.toBe(inSync); // fixture sanity check

    // Sanity: the swap only touched the `test:` list, not `flashcards:`.
    // If it had eaten a newline and corrupted the YAML, this would either
    // throw or report a different set of atomic cards.
    expect(parseCardFrontmatter(reordered).entries).toEqual(
      parseCardFrontmatter(inSync).entries,
    );

    const { repository: repo2, saves: saves2 } = makeFakeRepository(reordered);
    const { calls, fetch: fetch2 } = makeFakeFetch([...bootAllV2(ALL_MODELS)]);

    const result = await syncNote({
      ankiClient: new AnkiConnectClient({ fetch: fetch2 }),
      note: makeNote(reordered, NOTE_PATH, "Reorder me"),
      repository: repo2,
      settings: settingsWith(),
      vaultName: VAULT,
    });

    expect(result.status).toBe("ok");
    expect(saves2).toEqual([]);
    expect(mutatingCalls(calls)).toEqual([]);
  });
});

// ===========================================================================
// Answer drift → UPDATE with same nid (cue unchanged, hash changed).
// ===========================================================================

describe("syncNote — WI-9: editing the first paragraph only is a hash-mismatch UPDATE, same nid", () => {
  it("preserves the card's nid across an answer-only edit", async () => {
    const NOTE_PATH = "notes/Drift.md";
    const md = [
      "---",
      "test:",
      "  - title",
      "---",
      "",
      "Original first paragraph.",
      "",
    ].join("\n");

    const { repository, currentMarkdown } = makeFakeRepository(md);
    const { fetch } = bootWithCreates(1);

    await syncNote({
      ankiClient: new AnkiConnectClient({ fetch }),
      note: makeNote(md, NOTE_PATH, "Drift"),
      repository,
      settings: settingsWith(),
      vaultName: VAULT,
    });
    const inSync = currentMarkdown();
    const nidBefore = parseCardFrontmatter(inSync).entries[0]?.nid;
    expect(nidBefore).toBeDefined();

    const drifted = inSync.replace(
      "Original first paragraph.",
      "Completely different first paragraph.",
    );

    const { calls, fetch: fetch2 } = makeFakeFetch([
      ...bootAllV2(ALL_MODELS),
      ok(true), // updateNoteFields
    ]);
    const { repository: repo2, currentMarkdown: after2 } = makeFakeRepository(drifted);

    const result = await syncNote({
      ankiClient: new AnkiConnectClient({ fetch: fetch2 }),
      note: makeNote(drifted, NOTE_PATH, "Drift"),
      repository: repo2,
      settings: settingsWith(),
      vaultName: VAULT,
    });

    expect(result.status).toBe("ok");
    expect(calls.map((c) => c.action)).toContain("updateNoteFields");
    expect(calls.map((c) => c.action)).not.toContain("addNote");
    expect(calls.map((c) => c.action)).not.toContain("deleteNotes");

    const nidAfter = parseCardFrontmatter(after2()).entries[0]?.nid;
    expect(nidAfter).toBe(nidBefore);

    // I3: matching must be cue-based, not body-anchor-based — no `^q-xxxx`
    // anchor may ever appear in the body for an atomic card.
    expect(stripFrontmatter(after2())).not.toMatch(
      /\^q-[abcdefghijkmnpqrstuvwxyz23456789]{4}/,
    );
  });
});

// ===========================================================================
// Cue rephrase (authored cue text change) → orphan + create, never a
// silent delete (WI-4 delete-safety flow).
// ===========================================================================

describe("syncNote — WI-9: rephrasing an authored cue orphans the old entry and creates a new card", () => {
  it("a changed authored cue string is a fresh CREATE; the old map entry survives as an undeleted orphan", async () => {
    const NOTE_PATH = "notes/Rephrase.md";
    const OLD_CUE = "What is the old question?";
    const NEW_CUE = "What is the new question?";
    const md = [
      "---",
      "test:",
      `  - "${OLD_CUE}"`,
      "---",
      "",
      "Some first paragraph.",
      "",
    ].join("\n");

    const { repository, currentMarkdown } = makeFakeRepository(md);
    const { fetch } = bootWithCreates(1);

    await syncNote({
      ankiClient: new AnkiConnectClient({ fetch }),
      note: makeNote(md, NOTE_PATH, "Rephrase"),
      repository,
      settings: settingsWith(),
      vaultName: VAULT,
    });
    const inSync = currentMarkdown();
    const oldNid = parseCardFrontmatter(inSync).entries[0]?.nid;
    expect(oldNid).toBeDefined();

    const rephrased = inSync.replace(OLD_CUE, NEW_CUE);

    const { calls, fetch: fetch2 } = makeFakeFetch([
      ...bootAllV2(ALL_MODELS),
      ok(["Default"]), // deckNames (only reached if a create happens)
      ok(9999), // addNote for the new cue
    ]);
    const { repository: repo2, currentMarkdown: after2 } = makeFakeRepository(rephrased);

    const result = await syncNote({
      ankiClient: new AnkiConnectClient({ fetch: fetch2 }),
      note: makeNote(rephrased, NOTE_PATH, "Rephrase"),
      repository: repo2,
      settings: settingsWith(), // confirmBeforeDelete: true, no confirmer injected
      vaultName: VAULT,
    });

    expect(result.status).toBe("ok");
    expect(calls.map((c) => c.action)).toContain("addNote");
    // Delete-safety: no confirmer wired ⇒ deletes are held back — never silent.
    expect(calls.map((c) => c.action)).not.toContain("deleteNotes");

    const entries = parseCardFrontmatter(after2()).entries;
    // The stale entry (still keyed by its old cue) must still carry its nid —
    // it was never silently dropped from the map.
    const staleEntry = entries.find((e) => e.nid === oldNid);
    expect(staleEntry).toBeDefined();
    expect(entries.length).toBeGreaterThanOrEqual(2);
  });
});

// ===========================================================================
// Title rename semantics.
// ===========================================================================

describe("syncNote — WI-9: title rename with a `title`/`reversed` item is treated as a cue rephrase", () => {
  it("renaming the note orphans the old `title` entry and creates a new one (front derives from title)", async () => {
    const OLD_PATH = "notes/Old name.md";
    const md = [
      "---",
      "test:",
      "  - title",
      "---",
      "",
      "Some first paragraph.",
      "",
    ].join("\n");

    const { repository, currentMarkdown } = makeFakeRepository(md);
    const { fetch } = bootWithCreates(1);

    await syncNote({
      ankiClient: new AnkiConnectClient({ fetch }),
      note: makeNote(md, OLD_PATH, "Old name"),
      repository,
      settings: settingsWith(),
      vaultName: VAULT,
    });
    const inSync = currentMarkdown();
    const oldNid = parseCardFrontmatter(inSync).entries[0]?.nid;
    expect(oldNid).toBeDefined();

    // Rename: same content, new note path/title — front (= title) changes,
    // so its cue changes too.
    const NEW_PATH = "notes/New name.md";
    const { calls, fetch: fetch2 } = makeFakeFetch([
      ...bootAllV2(ALL_MODELS),
      ok(["Default"]),
      ok(9999), // addNote for the new title
    ]);
    const { repository: repo2, currentMarkdown: after2 } = makeFakeRepository(inSync);

    await syncNote({
      ankiClient: new AnkiConnectClient({ fetch: fetch2 }),
      note: makeNote(inSync, NEW_PATH, "New name"),
      repository: repo2,
      settings: settingsWith(),
      vaultName: VAULT,
    });

    expect(calls.map((c) => c.action)).toContain("addNote");
    const entries = parseCardFrontmatter(after2()).entries;
    const staleEntry = entries.find((e) => e.nid === oldNid);
    expect(staleEntry).toBeDefined(); // orphan, not silently dropped
  });
});

describe("syncNote — WI-9: title rename with ONLY an authored-cue item is an ordinary UPDATE", () => {
  it("renaming the note does not change an authored cue's identity — same nid, hash changes (title moved into the back)", async () => {
    const CUE = "An authored question that never mentions the title";
    const OLD_PATH = "notes/Original title.md";
    const md = [
      "---",
      "test:",
      `  - "${CUE}"`,
      "---",
      "",
      "Some first paragraph.",
      "",
    ].join("\n");

    const { repository, currentMarkdown } = makeFakeRepository(md);
    const { fetch } = bootWithCreates(1);

    await syncNote({
      ankiClient: new AnkiConnectClient({ fetch }),
      note: makeNote(md, OLD_PATH, "Original title"),
      repository,
      settings: settingsWith(),
      vaultName: VAULT,
    });
    const inSync = currentMarkdown();
    const oldNid = parseCardFrontmatter(inSync).entries[0]?.nid;
    expect(oldNid).toBeDefined();

    const NEW_PATH = "notes/Renamed title.md";
    const { calls, fetch: fetch2 } = makeFakeFetch([
      ...bootAllV2(ALL_MODELS),
      ok(true), // updateNoteFields — the authored-cue card's back embeds the title
    ]);
    const { repository: repo2, currentMarkdown: after2 } = makeFakeRepository(inSync);

    await syncNote({
      ankiClient: new AnkiConnectClient({ fetch: fetch2 }),
      note: makeNote(inSync, NEW_PATH, "Renamed title"),
      repository: repo2,
      settings: settingsWith(),
      vaultName: VAULT,
    });

    // The cue itself is untouched by the rename → same nid, ordinary UPDATE.
    expect(calls.map((c) => c.action)).toContain("updateNoteFields");
    expect(calls.map((c) => c.action)).not.toContain("addNote");
    expect(calls.map((c) => c.action)).not.toContain("deleteNotes");

    const entries = parseCardFrontmatter(after2()).entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.nid).toBe(oldNid);

    // I3: the authored-cue card's identity is cue-based, not a body anchor
    // — no `^q-xxxx` anchor may ever appear in the body.
    expect(stripFrontmatter(after2())).not.toMatch(
      /\^q-[abcdefghijkmnpqrstuvwxyz23456789]{4}/,
    );
  });
});

// ===========================================================================
// `[title, reversed]` — distinct cue values, each matches its own card.
// ===========================================================================

describe("syncNote — WI-9: `[title, reversed]` produces two entries with distinct cues", () => {
  it("each item gets its own cue and each re-parse matches back to its own entry (idempotent)", async () => {
    const NOTE_PATH = "notes/Both directions.md";
    const md = [
      "---",
      "test:",
      "  - title",
      "  - reversed",
      "---",
      "",
      "Some first paragraph.",
      "",
    ].join("\n");

    const { repository, currentMarkdown } = makeFakeRepository(md);
    const { fetch } = bootWithCreates(2);

    await syncNote({
      ankiClient: new AnkiConnectClient({ fetch }),
      note: makeNote(md, NOTE_PATH, "Both directions"),
      repository,
      settings: settingsWith(),
      vaultName: VAULT,
    });
    const inSync = currentMarkdown();

    const entries = parseCardFrontmatter(inSync).entries as Array<{
      blockId: string;
      cue?: string;
      hash?: string;
      nid?: number;
    }>;
    expect(entries).toHaveLength(2);
    const cues = entries.map((e) => e.cue);
    expect(cues.every((c) => c !== undefined)).toBe(true);
    expect(new Set(cues).size).toBe(2); // distinct

    // Idempotent re-sync: each parsed card matches its own entry by cue —
    // zero further Anki mutations.
    const { calls, fetch: fetch2 } = makeFakeFetch([...bootAllV2(ALL_MODELS)]);
    const { repository: repo2, saves: saves2 } = makeFakeRepository(inSync);
    const result = await syncNote({
      ankiClient: new AnkiConnectClient({ fetch: fetch2 }),
      note: makeNote(inSync, NOTE_PATH, "Both directions"),
      repository: repo2,
      settings: settingsWith(),
      vaultName: VAULT,
    });

    expect(result.status).toBe("ok");
    expect(saves2).toEqual([]);
    expect(mutatingCalls(calls)).toEqual([]);
  });
});
