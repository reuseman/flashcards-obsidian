import { applyTextEdits } from "../../../src/core/edits/apply-text-edits.js";
import { computeCardHash } from "../../../src/core/edits/card-hash.js";
import { writeCardFrontmatter } from "../../../src/core/edits/write-card-frontmatter.js";
import type {
  Flashcard,
  IdentifiedFlashcard,
} from "../../../src/core/domain/card.js";

/**
 * Phase 4 slice 2 — frontmatter `flashcards:` map writes for v2 cards.
 *
 * Module under test (not yet implemented):
 *   src/core/edits/write-card-frontmatter.ts
 *
 * API:
 *   writeCardFrontmatter({ markdown, cards }): { edits: TextEdit[] }
 *
 * Behavior (locked):
 *  - YAML shape: object-form, `hash` field only:
 *        flashcards:
 *          q-7f3a: { hash: ab12cd34 }
 *  - Insert-only: if a map entry for the blockId already exists, no edit.
 *  - v1 numeric anchors (blockId is 13 digits, /^\d{13}$/) are skipped.
 *  - Indentation: 2 spaces.
 *  - Entry style: flow form `q-xxxx: { hash: <hash> }`, one line per card.
 *  - When `flashcards:` key is created, it is appended at the END of the
 *    existing frontmatter (preserves user-authored key ordering).
 *  - Entry ordering when multiple are added: insertion order = order of
 *    `cards` in the input.
 *  - Frontmatter whose non-`flashcards:` content is not parseable by
 *    `parseNoteMetadata` (e.g. block-style multi-line lists): we do NOT
 *    re-parse — we only check whether a `flashcards:` key exists and either
 *    add entries under it or append a new key at the end. The rest of the
 *    frontmatter is left byte-for-byte intact.
 *
 * NOT in this slice:
 *  - v1 backfill migration (slice 2b)
 *  - nid writing (Phase B)
 *  - orphan cleanup (slice 3)
 *  - Anki transport
 *  - scalar shorthand `q-xxxx: <nid>` (a future shape)
 */

function baseSource(): Flashcard["source"] {
  return { endOffset: 0, line: 1, startOffset: 0, syntax: "inline" };
}

function id(
  blockId: string,
  overrides: Partial<Flashcard> = {},
): IdentifiedFlashcard {
  return {
    answer: "A",
    front: "Q",
    kind: "basic",
    source: baseSource(),
    tags: [],
    ...overrides,
    blockId,
  };
}

describe("writeCardFrontmatter — creates frontmatter when none exists", () => {
  test("note with no `---` block → new frontmatter block prepended", () => {
    const md = "Question:: Answer ^q-abcd\n";
    const cards = [id("q-abcd", { front: "Question", answer: "Answer" })];
    const hash = computeCardHash(cards[0]!);

    const { edits } = writeCardFrontmatter({ cards, markdown: md });
    const applied = applyTextEdits(md, edits);

    expect(applied).toBe(
      [
        "---",
        "flashcards:",
        `  q-abcd: { hash: ${hash} }`,
        "---",
        "",
        "Question:: Answer ^q-abcd",
        "",
      ].join("\n"),
    );
  });

  test("empty note → frontmatter is the entire output", () => {
    const md = "";
    const cards = [id("q-abcd", { front: "Q", answer: "A" })];
    const hash = computeCardHash(cards[0]!);

    const { edits } = writeCardFrontmatter({ cards, markdown: md });
    const applied = applyTextEdits(md, edits);

    expect(applied).toContain("---\nflashcards:");
    expect(applied).toContain(`  q-abcd: { hash: ${hash} }`);
    // closing `---` present
    expect(applied.match(/^---$/gm)?.length).toBeGreaterThanOrEqual(2);
  });
});

describe("writeCardFrontmatter — adds `flashcards:` key under existing frontmatter", () => {
  test("frontmatter has other keys, no `flashcards:` → key appended at end", () => {
    const md = [
      "---",
      "tags: [foo, bar]",
      "cards-deck: MyDeck",
      "---",
      "",
      "Question:: Answer ^q-abcd",
      "",
    ].join("\n");
    const cards = [id("q-abcd", { front: "Question", answer: "Answer" })];
    const hash = computeCardHash(cards[0]!);

    const { edits } = writeCardFrontmatter({ cards, markdown: md });
    const applied = applyTextEdits(md, edits);

    expect(applied).toBe(
      [
        "---",
        "tags: [foo, bar]",
        "cards-deck: MyDeck",
        "flashcards:",
        `  q-abcd: { hash: ${hash} }`,
        "---",
        "",
        "Question:: Answer ^q-abcd",
        "",
      ].join("\n"),
    );
  });

  test("existing key order is preserved verbatim", () => {
    const md = [
      "---",
      "cards-deck: A",
      "tags: [x]",
      "title: Hello",
      "---",
      "",
      "Q:: A ^q-abcd",
    ].join("\n");
    const cards = [id("q-abcd", { front: "Q", answer: "A" })];

    const { edits } = writeCardFrontmatter({ cards, markdown: md });
    const applied = applyTextEdits(md, edits);

    // `flashcards:` is appended after `title: Hello`, not interleaved.
    const fm = applied.match(/^---\n([\s\S]*?)\n---/)![1]!;
    const keyOrder = fm
      .split("\n")
      .map((line) => /^([A-Za-z0-9_-]+):/.exec(line)?.[1])
      .filter(Boolean);
    expect(keyOrder).toEqual(["cards-deck", "tags", "title", "flashcards"]);
  });
});

describe("writeCardFrontmatter — adds entries under existing `flashcards:` key", () => {
  test("one existing entry → new entry added alongside; existing entry untouched", () => {
    const md = [
      "---",
      "flashcards:",
      "  q-old1: { hash: deadbeef }",
      "---",
      "",
      "Q1:: A1 ^q-old1",
      "",
      "Q2:: A2 ^q-new2",
      "",
    ].join("\n");
    const cards = [
      // Already present — must NOT be touched.
      id("q-old1", { front: "Q1", answer: "A1" }),
      // New — entry to add.
      id("q-new2", { front: "Q2", answer: "A2" }),
    ];
    const newHash = computeCardHash(cards[1]!);

    const { edits } = writeCardFrontmatter({ cards, markdown: md });
    const applied = applyTextEdits(md, edits);

    // Old entry preserved with its old (stale) hash — insert-only semantics.
    expect(applied).toContain("  q-old1: { hash: deadbeef }");
    // New entry written with the computed hash.
    expect(applied).toContain(`  q-new2: { hash: ${newHash} }`);
    // No duplicate entry for q-old1.
    expect(applied.match(/q-old1:/g)?.length).toBe(1);
  });

  test("indentation is 2 spaces for new entries", () => {
    const md = ["---", "flashcards:", "---", "", "Q:: A ^q-abcd"].join("\n");
    const cards = [id("q-abcd", { front: "Q", answer: "A" })];

    const { edits } = writeCardFrontmatter({ cards, markdown: md });
    const applied = applyTextEdits(md, edits);
    expect(applied).toMatch(/\n {2}q-abcd: \{ hash: [a-z2-9]{8} \}\n/);
  });
});

describe("writeCardFrontmatter — insert-only / idempotency", () => {
  test("entry already present → zero edits", () => {
    const cards = [id("q-abcd", { front: "Q", answer: "A" })];
    const hash = computeCardHash(cards[0]!);
    const md = [
      "---",
      "flashcards:",
      `  q-abcd: { hash: ${hash} }`,
      "---",
      "",
      "Q:: A ^q-abcd",
      "",
    ].join("\n");

    const { edits } = writeCardFrontmatter({ cards, markdown: md });
    expect(edits).toEqual([]);
  });

  test("existing entry with STALE hash is NOT overwritten (insert-only)", () => {
    // This is the locked semantics: stored hash represents the snapshot at last
    // persistent write. We never silently overwrite it from this code path —
    // sync/Anki paths own that responsibility.
    const cards = [id("q-abcd", { front: "Q-updated", answer: "A-updated" })];
    const md = [
      "---",
      "flashcards:",
      "  q-abcd: { hash: stalehsh }",
      "---",
    ].join("\n");

    const { edits } = writeCardFrontmatter({ cards, markdown: md });
    expect(edits).toEqual([]);
  });

  test("second call after applying first is a no-op", () => {
    const md = [
      "---",
      "tags: [t]",
      "---",
      "",
      "Q:: A ^q-abcd",
      "",
    ].join("\n");
    const cards = [id("q-abcd", { front: "Q", answer: "A" })];

    const first = writeCardFrontmatter({ cards, markdown: md });
    const afterFirst = applyTextEdits(md, first.edits);
    const second = writeCardFrontmatter({ cards, markdown: afterFirst });
    expect(second.edits).toEqual([]);
  });
});

describe("writeCardFrontmatter — v1 anchor skipping", () => {
  test("blockId is 13 digits → no edit", () => {
    const md = "Q:: A ^1700000000000\n";
    const cards = [id("1700000000000", { front: "Q", answer: "A" })];

    const { edits } = writeCardFrontmatter({ cards, markdown: md });
    expect(edits).toEqual([]);
  });

  test("mixed v1 + v2 → only the v2 card gets a frontmatter entry", () => {
    const md = [
      "Q1:: A1 ^1700000000000",
      "",
      "Q2:: A2 ^q-abcd",
      "",
    ].join("\n");
    const cards = [
      id("1700000000000", { front: "Q1", answer: "A1" }),
      id("q-abcd", { front: "Q2", answer: "A2" }),
    ];
    const v2Hash = computeCardHash(cards[1]!);

    const { edits } = writeCardFrontmatter({ cards, markdown: md });
    const applied = applyTextEdits(md, edits);

    expect(applied).toContain(`  q-abcd: { hash: ${v2Hash} }`);
    // v1 id must not appear in frontmatter.
    expect(applied).not.toMatch(/^\s*"?1700000000000"?:/m);
  });
});

describe("writeCardFrontmatter — multi-card single pass", () => {
  test("3 new v2 cards → all 3 entries written in input order", () => {
    const md = [
      "Q1:: A1 ^q-aaaa",
      "",
      "Q2:: A2 ^q-bbbb",
      "",
      "Q3:: A3 ^q-cccc",
      "",
    ].join("\n");
    const cards = [
      id("q-aaaa", { front: "Q1", answer: "A1" }),
      id("q-bbbb", { front: "Q2", answer: "A2" }),
      id("q-cccc", { front: "Q3", answer: "A3" }),
    ];

    const { edits } = writeCardFrontmatter({ cards, markdown: md });
    const applied = applyTextEdits(md, edits);

    // All three present.
    for (const c of cards) {
      const h = computeCardHash(c);
      expect(applied).toContain(`  ${c.blockId}: { hash: ${h} }`);
    }

    // Order: insertion order == input order.
    const idxA = applied.indexOf("q-aaaa:");
    const idxB = applied.indexOf("q-bbbb:");
    const idxC = applied.indexOf("q-cccc:");
    expect(idxA).toBeGreaterThan(-1);
    expect(idxA).toBeLessThan(idxB);
    expect(idxB).toBeLessThan(idxC);
  });
});

describe("writeCardFrontmatter — existing frontmatter shapes preserved", () => {
  test("frontmatter ending with a blank line", () => {
    const md = [
      "---",
      "tags: [a]",
      "",
      "---",
      "",
      "Q:: A ^q-abcd",
    ].join("\n");
    const cards = [id("q-abcd", { front: "Q", answer: "A" })];

    const { edits } = writeCardFrontmatter({ cards, markdown: md });
    const applied = applyTextEdits(md, edits);

    expect(applied).toContain("tags: [a]");
    expect(applied).toMatch(/flashcards:\n {2}q-abcd: \{ hash: [a-z2-9]{8} \}/);
    // Body remains.
    expect(applied).toContain("Q:: A ^q-abcd");
  });

  test("YAML flow list `tags: [a, b]` preserved verbatim", () => {
    const md = [
      "---",
      "tags: [a, b]",
      "---",
      "",
      "Q:: A ^q-abcd",
    ].join("\n");
    const cards = [id("q-abcd", { front: "Q", answer: "A" })];

    const { edits } = writeCardFrontmatter({ cards, markdown: md });
    const applied = applyTextEdits(md, edits);
    expect(applied).toContain("tags: [a, b]");
  });

  test("frontmatter at EOF without trailing newline", () => {
    const md = ["---", "tags: [a]", "---"].join("\n"); // no trailing newline
    const cards = [id("q-abcd", { front: "Q", answer: "A" })];

    const { edits } = writeCardFrontmatter({ cards, markdown: md });
    const applied = applyTextEdits(md, edits);

    expect(applied).toContain("tags: [a]");
    expect(applied).toContain("flashcards:");
    // Resulting frontmatter must still be closed.
    expect(applied.match(/^---$/gm)?.length).toBeGreaterThanOrEqual(2);
  });

  test("frontmatter with block-style multi-line list (unparseable by current parser) — rest is left intact", () => {
    // Locked decision: do not re-parse the rest of the frontmatter; only check
    // whether a `flashcards:` key exists. If not, append at end. Other lines
    // are byte-for-byte preserved.
    const md = [
      "---",
      "tags:",
      "  - foo",
      "  - bar",
      "---",
      "",
      "Q:: A ^q-abcd",
    ].join("\n");
    const cards = [id("q-abcd", { front: "Q", answer: "A" })];

    const { edits } = writeCardFrontmatter({ cards, markdown: md });
    const applied = applyTextEdits(md, edits);

    expect(applied).toContain("tags:\n  - foo\n  - bar");
    expect(applied).toMatch(/flashcards:\n {2}q-abcd: \{ hash: [a-z2-9]{8} \}/);
  });
});

describe("writeCardFrontmatter — apply-edits round-trip", () => {
  test("apply edits, re-run, get zero further edits", () => {
    const md = [
      "---",
      "tags: [a]",
      "---",
      "",
      "Q1:: A1 ^q-aaaa",
      "",
      "Q2:: A2 ^q-bbbb",
      "",
    ].join("\n");
    const cards = [
      id("q-aaaa", { front: "Q1", answer: "A1" }),
      id("q-bbbb", { front: "Q2", answer: "A2" }),
    ];

    const first = writeCardFrontmatter({ cards, markdown: md });
    expect(first.edits.length).toBeGreaterThan(0);
    const afterFirst = applyTextEdits(md, first.edits);

    const second = writeCardFrontmatter({ cards, markdown: afterFirst });
    expect(second.edits).toEqual([]);
  });
});

/**
 * WI-9 — writer emits `cue` for atomic entries only (design §4.4).
 *
 * Atomic cards are identified by `card.source.syntax === "atomic"`. Their
 * frontmatter entry gets a `cue` field (first 8 base32 chars of
 * sha256(kind + "\n" + front)) alongside `hash`, ordered `cue` before
 * `hash` per the brief's locked example. Anchored (non-atomic) entries are
 * untouched — no `cue` key ever appears for them.
 */
describe("writeCardFrontmatter — WI-9 `cue` field for atomic entries", () => {
  function atomicId(
    blockId: string,
    overrides: Partial<Flashcard> = {},
  ): IdentifiedFlashcard {
    return {
      answer: "A",
      front: "Q",
      kind: "basic",
      source: { endOffset: 0, line: 1, startOffset: 0, syntax: "atomic" },
      tags: [],
      ...overrides,
      blockId,
    };
  }

  test("atomic card entry gets a `cue` field ordered before `hash`", () => {
    const md = "Some body text.\n";
    const cards = [atomicId("q-ab3k", { front: "TCP basics", answer: "A paragraph." })];

    const { edits } = writeCardFrontmatter({ cards, markdown: md });
    const applied = applyTextEdits(md, edits);

    expect(applied).toMatch(
      /q-ab3k: \{ cue: [a-z2-9]{8}, hash: [a-z2-9]{8} \}/,
    );
  });

  test("anchored (non-atomic) entries never get a `cue` key, even alongside atomic ones", () => {
    const md = "Some body text.\n";
    const cards = [
      id("q-anch", { front: "Question", answer: "Answer" }),
      atomicId("q-ab3k", { front: "TCP basics", answer: "A paragraph." }),
    ];

    const { edits } = writeCardFrontmatter({ cards, markdown: md });
    const applied = applyTextEdits(md, edits);

    const anchoredLine = applied
      .split("\n")
      .find((line) => line.includes("q-anch:"));
    expect(anchoredLine).toBeDefined();
    expect(anchoredLine).not.toContain("cue:");
  });

  test("cue value for an atomic card is stable across re-parse (round-trip), not the fresh writer's per-call hash", () => {
    // Two writer calls for the *same* atomic card (same kind+front) must
    // produce the identical `cue` value — it is a pure function of
    // kind+front, not of anything positional or random.
    const cardA = atomicId("q-ab3k", { front: "TCP basics", answer: "First answer." });
    const cardB = atomicId("q-cd4m", { front: "TCP basics", answer: "Different answer." });

    const mdA = "Body A.\n";
    const mdB = "Body B.\n";
    const appliedA = applyTextEdits(
      mdA,
      writeCardFrontmatter({ cards: [cardA], markdown: mdA }).edits,
    );
    const appliedB = applyTextEdits(
      mdB,
      writeCardFrontmatter({ cards: [cardB], markdown: mdB }).edits,
    );

    const cueA = /cue: ([a-z2-9]{8})/.exec(appliedA)?.[1];
    const cueB = /cue: ([a-z2-9]{8})/.exec(appliedB)?.[1];
    expect(cueA).toBeDefined();
    // Same kind ("basic") + same front ("TCP basics") → same cue, despite
    // different blockId/answer/markdown context.
    expect(cueA).toBe(cueB);
  });
});
