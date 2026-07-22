import { describe, expect, it } from "vitest";

import { syncNote } from "../../src/application/sync-note.js";
import { AnkiConnectClient } from "../../src/adapters/anki/anki-connect-client.js";
import {
  ANKI_MODEL_BASIC,
  ANKI_MODEL_CLOZE,
  ANKI_MODEL_REVERSED,
} from "../../src/core/render/render-card.js";
import { DEFAULT_SETTINGS } from "../../src/core/config/settings.js";
import type { FlashcardsSettings } from "../../src/core/config/settings.js";
import { extractCardsFromMarkdown } from "../../src/core/parse/extract-cards.js";
import { parseCardFrontmatter } from "../../src/core/sync/parse-card-frontmatter.js";
import type { MarkdownNote } from "../../src/application/ports.js";
import type { ObsidianMarkdownRepository } from "../../src/adapters/obsidian/obsidian-markdown-repository.js";
import { bootAllV2, makeFakeFetch, ok } from "../_utils/fake-fetch.js";

/**
 * WI-13 — Golden B: mixed atomic note (spec §4.1-4.5, invariants I3/I4).
 *
 * ACCEPTANCE GATE, currently RED by design: the `test:` frontmatter atomic
 * syntax does not exist yet (WI-7..WI-12). This file locks the target
 * behaviour up front; keep it `describe.skip` until WI-10 wires the parser,
 * matcher, and writer changes it exercises, then unskip.
 *
 * Fixture anatomy (per brief):
 *   - `test: [title, "<cue>", reversed, cloze]` frontmatter key.
 *   - First paragraph carries a `==span==` (used by the `cloze` item only).
 *   - A second prose paragraph containing a legacy `::` separator AND a
 *     stray `==span==` — MUST NOT double-detect as legacy inline/cloze
 *     cards once suppression (§4.5) lands, because the note carries `test:`.
 *   - A fenced ```flashcard``` block (the documented atomic-note escape
 *     hatch) and a `#card` hashtag card — both remain active and anchored.
 *   - Trailing `## Related` content — must never leak into any card field.
 */

const ALL_MODELS = [ANKI_MODEL_BASIC, ANKI_MODEL_REVERSED, ANKI_MODEL_CLOZE];
const VAULT = "MyVault";
const NOTE_PATH = "notes/TCP basics.md";
const NOTE_TITLE = "TCP basics";

const CUE = "What guarantees delivery?";
const FIRST_PARAGRAPH =
  "TCP is a ==connection-oriented== protocol that guarantees delivery.";

const FRONTMATTER_LINES = [
  "test:",
  "  - title",
  `  - "${CUE}"`,
  "  - reversed",
  "  - cloze",
];

const BODY_LINES = [
  FIRST_PARAGRAPH,
  "",
  "Some legacy-looking prose lives here: Capital of France::Paris and a stray span like ==sky==.",
  "",
  "```flashcard",
  "front: What layer does TCP operate at?",
  "back: The transport layer.",
  "```",
  "",
  "What is UDP? #card",
  "Connectionless, unreliable datagram transport.",
  "",
  "## Related",
  "See also [[UDP deep dive]] and [RFC 793](https://www.rfc-editor.org/rfc/rfc793).",
  "",
];

function buildFixture(frontmatterLines: string[] = FRONTMATTER_LINES): string {
  return [
    "---",
    ...frontmatterLines,
    "---",
    "",
    ...BODY_LINES,
  ].join("\n");
}

const FIXTURE = buildFixture();

// ---------------------------------------------------------------------------
// Fake repository (mirrors golden-v1-retrocompat.test.ts)
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
    name: NOTE_TITLE,
    path: NOTE_PATH,
  };
}

function settingsWith(
  overrides: Partial<FlashcardsSettings> = {},
): FlashcardsSettings {
  return { ...DEFAULT_SETTINGS, folderBasedDecks: false, ...overrides };
}

// A generous, order-agnostic supply of `addNote` responses — this gate's
// point is to exercise extraction/plan/frontmatter behaviour, not to pin an
// exact Anki call count (which depends on matching logic not yet written).
function bootWithPlentyOfCreates(): ReturnType<typeof makeFakeFetch> {
  return makeFakeFetch([
    ...bootAllV2(ALL_MODELS),
    ok(["Default"]), // deckNames
    ...Array.from({ length: 20 }, (_, i) => ok(9000 + i)), // addNote x N
  ]);
}

function stripFrontmatter(markdown: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(markdown);
  if (!match) return markdown;
  return markdown.slice(match[0].length);
}

// ===========================================================================
// Golden gate — currently red; unskip in WI-10 (see file header).
// ===========================================================================

describe("golden atomic mixed note — WI-13 acceptance gate", () => {
  it("parses exactly the atomic + fenced + hashtag card set, no legacy inline/cloze doubles", () => {
    const { cards } = extractCardsFromMarkdown(FIXTURE, {
      notePath: NOTE_PATH,
      settings: settingsWith(),
    });

    // Expect exactly 6 cards: title, cue, reversed, cloze (atomic) + fenced + hashtag.
    expect(cards).toHaveLength(6);

    const titleCard = cards.find(
      (c) => c.kind === "basic" && c.front === NOTE_TITLE,
    );
    expect(titleCard).toBeDefined();
    expect(titleCard?.answer).toBe(FIRST_PARAGRAPH);

    const cueCard = cards.find((c) => c.kind === "basic" && c.front === CUE);
    expect(cueCard).toBeDefined();
    expect(cueCard?.answer).toBe(`${NOTE_TITLE}\n\n${FIRST_PARAGRAPH}`);

    const reversedCard = cards.find((c) => c.kind === "reversed");
    expect(reversedCard).toBeDefined();
    expect(reversedCard?.front).toBe(NOTE_TITLE);
    expect(reversedCard?.answer).toBe(FIRST_PARAGRAPH);

    const clozeCard = cards.find((c) => c.kind === "cloze");
    expect(clozeCard).toBeDefined();
    expect(clozeCard?.front).toBe(FIRST_PARAGRAPH);
    // Cloze back-composition contract: Text = first paragraph (with spans),
    // Extra = note title.
    expect(clozeCard?.answer).toBe(NOTE_TITLE);

    const fencedCard = cards.find(
      (c) => (c.source.syntax as string) === "fenced",
    );
    expect(fencedCard?.front).toBe("What layer does TCP operate at?");
    expect(fencedCard?.answer).toBe("The transport layer.");

    const hashtagCard = cards.find(
      (c) => (c.source.syntax as string) === "hashtag",
    );
    expect(hashtagCard?.front).toBe("What is UDP?");
    expect(hashtagCard?.answer).toBe(
      "Connectionless, unreliable datagram transport.",
    );

    // No legacy inline/cloze doubles: nothing sourced from the suppressed
    // paragraph scans should have survived (§4.5).
    const legacyInlineOrCloze = cards.filter((c) => {
      const syntax = c.source.syntax as string;
      return syntax === "inline" || syntax === "cloze";
    });
    expect(legacyInlineOrCloze).toEqual([]);

    // `## Related` content must never leak into any card field.
    for (const c of cards) {
      expect(c.front).not.toContain("Related");
      expect(c.answer).not.toContain("Related");
      expect(c.front).not.toContain("RFC 793");
      expect(c.answer).not.toContain("RFC 793");
    }
  });

  it("writes only the fenced + hashtag anchors to the body — atomic cards never touch it (I3)", async () => {
    const { repository, currentMarkdown } = makeFakeRepository(FIXTURE);
    const { calls, fetch } = bootWithPlentyOfCreates();

    await syncNote({
      ankiClient: new AnkiConnectClient({ fetch }),
      note: makeNote(FIXTURE),
      repository,
      settings: settingsWith(),
      vaultName: VAULT,
    });

    const before = stripFrontmatter(FIXTURE);
    const after = stripFrontmatter(currentMarkdown());

    // Stripping every v2 anchor token from the post-sync body must restore
    // the original body byte-for-byte — i.e. anchors are the ONLY body
    // mutation, and there are EXACTLY two of them (fenced + hashtag). Zero
    // anchors would mean an over-suppression regression.
    const anchorMatches = after.match(/\s?\^q-[abcdefghijkmnpqrstuvwxyz23456789]{4}/g) ?? [];
    expect(anchorMatches.length).toBe(2);

    const afterWithoutAnchors = after.replace(
      /\s?\^q-[abcdefghijkmnpqrstuvwxyz23456789]{4}/g,
      "",
    );
    expect(afterWithoutAnchors).toBe(before);

    // Tighten the cloze back-composition contract at the Anki payload level:
    // the addNote call for the Obsidian-Cloze model must carry the note
    // title in its Extra field.
    const clozeAddNote = calls.find(
      (c) =>
        c.action === "addNote" &&
        (c.params.note as { modelName?: string } | undefined)?.modelName ===
          ANKI_MODEL_CLOZE,
    );
    expect(clozeAddNote).toBeDefined();
    const clozeFields = (
      clozeAddNote?.params.note as { fields?: Record<string, string> }
    )?.fields;
    expect(clozeFields?.Extra).toContain(NOTE_TITLE);
  });

  it("writes `flashcards:` entries with a `cue` field for the 4 atomic cards only", async () => {
    const { repository, currentMarkdown } = makeFakeRepository(FIXTURE);
    const { fetch } = bootWithPlentyOfCreates();

    await syncNote({
      ankiClient: new AnkiConnectClient({ fetch }),
      note: makeNote(FIXTURE),
      repository,
      settings: settingsWith(),
      vaultName: VAULT,
    });

    const entries = parseCardFrontmatter(currentMarkdown()).entries as Array<{
      blockId: string;
      cue?: string;
      hash?: string;
      nid?: number;
    }>;

    expect(entries).toHaveLength(6);
    const withCue = entries.filter((e) => e.cue !== undefined);
    const withoutCue = entries.filter((e) => e.cue === undefined);
    expect(withCue).toHaveLength(4);
    expect(withoutCue).toHaveLength(2);
  });

  it("is idempotent — a second sync of the resulting note performs no writes and no Anki mutations", async () => {
    const { repository, saves, currentMarkdown } = makeFakeRepository(FIXTURE);

    await syncNote({
      ankiClient: new AnkiConnectClient({ fetch: bootWithPlentyOfCreates().fetch }),
      note: makeNote(FIXTURE),
      repository,
      settings: settingsWith(),
      vaultName: VAULT,
    });
    const afterFirst = currentMarkdown();
    const savesAfterFirst = saves.length;

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

  it("reordering the `test:` list is a sync no-op — identity is the cue, not position (I4)", async () => {
    const { repository, currentMarkdown } = makeFakeRepository(FIXTURE);

    await syncNote({
      ankiClient: new AnkiConnectClient({ fetch: bootWithPlentyOfCreates().fetch }),
      note: makeNote(FIXTURE),
      repository,
      settings: settingsWith(),
      vaultName: VAULT,
    });
    const inSync = currentMarkdown();

    // Reorder the `test:` list items (cue and reversed swapped) on the
    // now-in-sync note, leaving everything else — including the body and
    // the `flashcards:` map — untouched.
    const reordered = inSync.replace(
      new RegExp(
        `test:\\n(\\s*- title\\n)(\\s*- "${CUE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\n)(\\s*- reversed\\n)(\\s*- cloze\\n)`,
      ),
      "test:\n$1$3$2$4",
    );
    expect(reordered).not.toBe(inSync); // fixture precondition: reorder actually changed something.

    const { repository: repo2, saves: saves2 } = makeFakeRepository(reordered);
    const { calls, fetch } = makeFakeFetch([...bootAllV2(ALL_MODELS)]);

    const result = await syncNote({
      ankiClient: new AnkiConnectClient({ fetch }),
      note: makeNote(reordered),
      repository: repo2,
      settings: settingsWith(),
      vaultName: VAULT,
    });

    expect(result.status).toBe("ok");
    expect(saves2).toEqual([]);
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
