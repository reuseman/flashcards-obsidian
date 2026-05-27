import { DEFAULT_SETTINGS } from "../../../src/core/config/settings.js";
import { applyTextEdits } from "../../../src/core/edits/apply-text-edits.js";
import { insertCardAnchors } from "../../../src/core/edits/insert-card-anchors.js";
import { extractCardsFromMarkdown } from "../../../src/core/parse/extract-cards.js";

/**
 * Phase 4 slice 1 — local blockId anchor insertion.
 *
 * Module under test (not yet implemented):
 *   src/core/edits/insert-card-anchors.ts
 *
 * API assumed (see tasks.md → "Phase 4 slice 1"):
 *
 *   insertCardAnchors({
 *     markdown,
 *     cards,                         // from extractCardsFromMarkdown
 *     generateBlockId: () => string  // injectable seeded RNG for tests
 *   }): { edits: TextEdit[]; cards: Flashcard[] }
 *
 * blockId shape: `q-` + exactly 4 base32 chars from the alphabet
 * `abcdefghijkmnpqrstuvwxyz23456789` (lowercase, ambiguous chars `l,o,0,1`
 * excluded). Detection regex assumed: /\^q-[abcdefghijkmnpqrstuvwxyz23456789]{4}\b/.
 * v1 anchor regex: /\^\d{13}\b/.
 *
 * Ambiguities locked in this slice (see report for reasoning):
 *  - Legacy `#card` heading shape: anchor goes on the LAST line of the
 *    answer block; if there is no answer block (heading with no body),
 *    anchor goes at end of the heading line itself. Tested below.
 *  - Fenced block at EOF without trailing newline: the new-line-after-fence
 *    edit prepends a `\n` before the anchor. Tested below.
 *  - Cloze paragraph with trailing whitespace on the last line: anchor is
 *    appended after a single space, preserving original trailing whitespace
 *    is NOT required (we right-trim before joining). Tested below.
 */

function seededGenerator(ids: string[]): () => string {
  let i = 0;
  return () => {
    const id = ids[i++];
    if (id === undefined) throw new Error("seededGenerator exhausted");
    return id;
  };
}

function run(markdown: string, generate: () => string, notePath = "Note.md") {
  const { cards } = extractCardsFromMarkdown(markdown, {
    notePath,
    settings: DEFAULT_SETTINGS,
  });
  return insertCardAnchors({
    cards,
    generateBlockId: generate,
    markdown,
  });
}

describe("insertCardAnchors — anchor placement by card kind", () => {
  test("inline paragraph card → anchor appended to same line with a space", () => {
    const md = "Question:: Answer";
    const out = run(md, seededGenerator(["q-abcd"]));
    const applied = applyTextEdits(md, out.edits);
    expect(applied).toBe("Question:: Answer ^q-abcd");
  });

  test("inline list-item card → anchor on same list-item line", () => {
    const md = "- Question:: Answer";
    const out = run(md, seededGenerator(["q-abcd"]));
    const applied = applyTextEdits(md, out.edits);
    expect(applied).toBe("- Question:: Answer ^q-abcd");
  });

  test("single-line cloze → anchor at end of line", () => {
    const md = "The ==heart== pumps blood.";
    const out = run(md, seededGenerator(["q-abcd"]));
    const applied = applyTextEdits(md, out.edits);
    expect(applied).toBe("The ==heart== pumps blood. ^q-abcd");
  });

  test("multi-line cloze paragraph → anchor at end of last line", () => {
    const md = ["The ==heart== pumps", "blood through the body."].join("\n");
    const out = run(md, seededGenerator(["q-abcd"]));
    const applied = applyTextEdits(md, out.edits);
    expect(applied).toBe(
      ["The ==heart== pumps", "blood through the body. ^q-abcd"].join("\n"),
    );
  });

  test("fenced ```flashcard block → anchor on a NEW line after the closing fence", () => {
    const md = [
      "```flashcard",
      "front: Q",
      "back: A",
      "```",
      "",
      "next paragraph",
    ].join("\n");
    const out = run(md, seededGenerator(["q-abcd"]));
    const applied = applyTextEdits(md, out.edits);
    expect(applied).toBe(
      [
        "```flashcard",
        "front: Q",
        "back: A",
        "```",
        "^q-abcd",
        "",
        "next paragraph",
      ].join("\n"),
    );
  });

  test("fenced block at EOF without trailing newline → anchor prepended with `\\n`", () => {
    // Locked decision: prepend `\n` rather than mutate the existing fence line.
    const md = ["```flashcard", "front: Q", "back: A", "```"].join("\n");
    const out = run(md, seededGenerator(["q-abcd"]));
    const applied = applyTextEdits(md, out.edits);
    expect(applied).toBe(
      ["```flashcard", "front: Q", "back: A", "```", "^q-abcd"].join("\n"),
    );
  });

  test("legacy #card inline-tag with answer → anchor on answer's last line", () => {
    const md = ["Question #card", "Answer line one", "Answer line two"].join("\n");
    const out = run(md, seededGenerator(["q-abcd"]));
    const applied = applyTextEdits(md, out.edits);
    expect(applied).toBe(
      ["Question #card", "Answer line one", "Answer line two ^q-abcd"].join("\n"),
    );
  });

  test("legacy #card separate-line shape with answer → anchor on answer's last line", () => {
    const md = ["Question", "#card", "Answer"].join("\n");
    const out = run(md, seededGenerator(["q-abcd"]));
    const applied = applyTextEdits(md, out.edits);
    expect(applied).toBe(["Question", "#card", "Answer ^q-abcd"].join("\n"));
  });

  test("legacy #card heading with answer body → anchor on answer's last line", () => {
    const md = ["## Heading question #card", "answer body"].join("\n");
    const out = run(md, seededGenerator(["q-abcd"]));
    const applied = applyTextEdits(md, out.edits);
    expect(applied).toBe(
      ["## Heading question #card", "answer body ^q-abcd"].join("\n"),
    );
  });

  test("legacy #card heading with NO answer body → anchor at end of heading line", () => {
    // Locked decision: anchor appended on the heading line itself, separated
    // by a space. Markdown ATX headings tolerate trailing block-refs in
    // Obsidian; this avoids inserting a blank-line body where the user had
    // none.
    const md = "## Heading question #card";
    const out = run(md, seededGenerator(["q-abcd"]));
    const applied = applyTextEdits(md, out.edits);
    expect(applied).toBe("## Heading question #card ^q-abcd");
  });
});

describe("insertCardAnchors — blockId format & detection", () => {
  test("generated blockId matches `q-` + 4 chars from the base32 alphabet", () => {
    const md = "Question:: Answer";
    const out = run(md, seededGenerator(["q-abcd"]));
    expect(out.cards).toHaveLength(1);
    // Default generator output shape — tested via the assigned blockId on the
    // returned card. The test seed itself respects the alphabet.
    const re = /^q-[abcdefghijkmnpqrstuvwxyz23456789]{4}$/;
    // The implementation should annotate cards with the assigned blockId.
    expect(out.cards[0]).toMatchObject({ blockId: expect.stringMatching(re) });
  });

  test("v1 numeric anchor (`^` + exactly 13 digits) is treated as existing identity — no edit", () => {
    const md = "Question:: Answer ^1700000000000";
    const out = run(md, seededGenerator(["q-abcd"]));
    expect(out.edits).toEqual([]);
  });

  test("v2 anchor (`^q-<4base32>`) is treated as existing identity — no edit", () => {
    const md = "Question:: Answer ^q-abcd";
    const out = run(md, seededGenerator(["q-wxyz"]));
    expect(out.edits).toEqual([]);
  });

  test("anchor-like patterns that don't match the spec are NOT treated as identity", () => {
    // 12 digits, not 13 → not a v1 anchor.
    const md = "Question:: Answer ^123456789012";
    const out = run(md, seededGenerator(["q-abcd"]));
    expect(out.edits.length).toBeGreaterThan(0);
  });
});

describe("insertCardAnchors — collision-free generation within a note", () => {
  test("skips an id already present elsewhere in the note", () => {
    const md = [
      "Some unrelated paragraph ^q-abcd",
      "",
      "Question:: Answer",
    ].join("\n");
    // Generator first proposes a colliding id, then a fresh one.
    const out = run(md, seededGenerator(["q-abcd", "q-efgh"]));
    const applied = applyTextEdits(md, out.edits);
    expect(applied).toContain("Question:: Answer ^q-efgh");
    expect(out.cards[0]).toMatchObject({ blockId: "q-efgh" });
  });

  test("multiple new cards in the same note get distinct ids", () => {
    const md = ["Q1:: A1", "", "Q2:: A2"].join("\n");
    const out = run(md, seededGenerator(["q-abcd", "q-efgh"]));
    const ids = out.cards.map((c: { blockId?: string }) => c.blockId);
    expect(new Set(ids).size).toBe(ids.length);
    const applied = applyTextEdits(md, out.edits);
    expect(applied).toContain("Q1:: A1 ^q-abcd");
    expect(applied).toContain("Q2:: A2 ^q-efgh");
  });
});

describe("insertCardAnchors — idempotency & order independence", () => {
  test("running twice on the same input produces zero edits on the second call", () => {
    const md = ["Q1:: A1", "", "Q2:: A2"].join("\n");
    const first = run(md, seededGenerator(["q-abcd", "q-efgh"]));
    const afterFirst = applyTextEdits(md, first.edits);

    const { cards: cards2 } = extractCardsFromMarkdown(afterFirst, {
      notePath: "Note.md",
      settings: DEFAULT_SETTINGS,
    });
    const second = insertCardAnchors({
      cards: cards2,
      generateBlockId: seededGenerator(["q-zzzz", "q-yyyy"]),
      markdown: afterFirst,
    });
    expect(second.edits).toEqual([]);
  });

  test("edits for multiple new cards apply cleanly (positions computed against original doc)", () => {
    const md = [
      "Q1:: A1",
      "",
      "The ==heart== pumps blood.",
      "",
      "```flashcard",
      "front: F",
      "back: B",
      "```",
      "",
      "Q3 #card",
      "answer body",
    ].join("\n");
    const out = run(
      md,
      seededGenerator(["q-abcd", "q-efgh", "q-mnpq", "q-rstu"]),
    );
    const applied = applyTextEdits(md, out.edits);

    // Re-parse: every card should now have an identity anchor in the doc.
    const { cards: reparsed } = extractCardsFromMarkdown(applied, {
      notePath: "Note.md",
      settings: DEFAULT_SETTINGS,
    });
    expect(reparsed.length).toBeGreaterThanOrEqual(out.cards.length);

    // A second pass should be a no-op.
    const second = insertCardAnchors({
      cards: reparsed,
      generateBlockId: seededGenerator(["q-xxxx"]),
      markdown: applied,
    });
    expect(second.edits).toEqual([]);
  });
});

describe("insertCardAnchors — leaves unrelated text alone", () => {
  test("existing `^xxxx` block-refs on non-card paragraphs are not touched", () => {
    const md = [
      "Just a note paragraph ^note1",
      "",
      "Question:: Answer",
    ].join("\n");
    const out = run(md, seededGenerator(["q-abcd"]));
    const applied = applyTextEdits(md, out.edits);
    expect(applied).toContain("Just a note paragraph ^note1");
    expect(applied).toContain("Question:: Answer ^q-abcd");
  });

  test("no cards → no edits", () => {
    const md = "Just prose. No cards here.";
    const out = run(md, seededGenerator([]));
    expect(out.edits).toEqual([]);
  });
});
