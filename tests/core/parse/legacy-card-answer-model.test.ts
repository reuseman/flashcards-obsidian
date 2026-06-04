import { DEFAULT_SETTINGS } from "../../../src/core/config/settings.js";
import { applyTextEdits } from "../../../src/core/edits/apply-text-edits.js";
import { insertCardAnchors } from "../../../src/core/edits/insert-card-anchors.js";
import { extractCardsFromMarkdown } from "../../../src/core/parse/extract-cards.js";

function extract(markdown: string) {
  return extractCardsFromMarkdown(markdown, {
    notePath: "Legacy.md",
    settings: DEFAULT_SETTINGS,
  });
}

function seededGenerator(ids: string[]): () => string {
  let i = 0;
  return () => {
    const id = ids[i++];
    if (id === undefined) throw new Error("seededGenerator exhausted");
    return id;
  };
}

describe("WI-2 #card deterministic answer model", () => {
  describe("single-block fallback (no terminator)", () => {
    test("collects contiguous lines as a multi-line answer when no blank line", () => {
      const result = extract("What is X? #card\nLine one.\nLine two.");

      expect(result.cards).toHaveLength(1);
      expect(result.cards[0]).toMatchObject({
        front: "What is X?",
        answer: "Line one.\nLine two.",
        kind: "basic",
      });
    });

    test("stops at the first blank line when there is no ^ terminator", () => {
      const result = extract("What is X? #card\nLine one.\n\nLine two.");

      expect(result.cards).toHaveLength(1);
      expect(result.cards[0]?.answer).toBe("Line one.");
    });
  });

  describe("multi-paragraph mode with a bare ^ terminator", () => {
    test("includes blank lines and excludes the terminator from the answer text", () => {
      const md = [
        "What is TCP? #card",
        "Para one.",
        "",
        "Para two.",
        "",
        "Para three.",
        "^",
      ].join("\n");

      const result = extract(md);

      expect(result.cards).toHaveLength(1);
      expect(result.cards[0]).toMatchObject({
        front: "What is TCP?",
        kind: "basic",
      });
      expect(result.cards[0]?.answer).toBe(
        "Para one.\n\nPara two.\n\nPara three.",
      );
    });
  });

  describe("multi-paragraph mode with an existing ^q-xxxx terminator", () => {
    const md = [
      "What is TCP? #card",
      "Para one.",
      "",
      "Para two.",
      "^q-abcd",
    ].join("\n");

    test("spans paragraphs and excludes the existing anchor from the answer text", () => {
      const result = extract(md);

      expect(result.cards).toHaveLength(1);
      expect(result.cards[0]?.answer).toBe("Para one.\n\nPara two.");
    });

    test("preserves identity: the existing ^q-abcd is reused, no new anchor edit emitted", () => {
      const result = extract(md);
      const anchored = insertCardAnchors({ cards: result.cards, markdown: md });

      expect(anchored.cards).toHaveLength(1);
      expect(anchored.cards[0]?.blockId).toBe("q-abcd");
      expect(anchored.edits).toHaveLength(0);
    });
  });

  describe("window bounds", () => {
    test("a heading bounds the answer window", () => {
      const md = [
        "## Mito #card",
        "The powerhouse.",
        "### Detail",
        "Produces ATP.",
      ].join("\n");

      const result = extract(md);

      expect(result.cards).toHaveLength(1);
      expect(result.cards[0]).toMatchObject({ front: "Mito" });
      expect(result.cards[0]?.answer).toBe("The powerhouse.");
    });

    test("a heading bounds the window even across blank lines before a ^ terminator", () => {
      const md = [
        "## Mito #card",
        "The powerhouse.",
        "",
        "## Detail",
        "Produces ATP.",
        "^",
      ].join("\n");

      const result = extract(md);

      expect(result.cards).toHaveLength(1);
      expect(result.cards[0]?.answer).toBe("The powerhouse.");
    });

    test("a fenced code block bounds the window and is not swallowed", () => {
      const md = [
        "What is X? #card",
        "Some answer.",
        "```js",
        "const sneaky = 1;",
        "```",
      ].join("\n");

      const result = extract(md);

      const card = result.cards.find((c) => c.source.syntax === "legacy-hashtag");
      expect(card?.answer).toBe("Some answer.");
      expect(card?.answer).not.toContain("const sneaky");
    });

    test("the next card-start bounds the window; neither card swallows the other", () => {
      const md = [
        "Q1 #card",
        "A1",
        "Q2 #card",
        "A2",
      ].join("\n");

      const result = extract(md);

      expect(result.cards).toHaveLength(2);
      expect(result.cards[0]).toMatchObject({ front: "Q1", answer: "A1" });
      expect(result.cards[1]).toMatchObject({ front: "Q2", answer: "A2" });
    });
  });

  describe("R5 — a #card tag mid-prose is content, not a control token", () => {
    test("an answer line with text after #card is kept verbatim and produces no second card", () => {
      const md = [
        "How do you tag? #card",
        "Write #card here to mark it.",
      ].join("\n");

      const result = extract(md);

      expect(result.cards).toHaveLength(1);
      expect(result.cards[0]).toMatchObject({ front: "How do you tag?" });
      expect(result.cards[0]?.answer).toBe("Write #card here to mark it.");
    });
  });

  describe("R4 — empty answer produces no card", () => {
    test("a blank line immediately after the tag yields zero cards", () => {
      const result = extract("Question? #card\n\nUnrelated.");

      expect(result.cards).toHaveLength(0);
    });

    test("a heading question with nothing after it (EOF) yields zero cards", () => {
      const result = extract("Heading question #card");

      expect(result.cards).toHaveLength(0);
    });

    test("a true markdown heading #card with an empty body (EOF) yields zero cards and an /empty/i warning", () => {
      const result = extract("## What is recursion? #card");
      const warnings = (result as { warnings?: string[] }).warnings ?? [];

      expect(result.cards).toHaveLength(0);
      expect(warnings.length).toBeGreaterThanOrEqual(1);
      expect(warnings.some((w) => /empty/i.test(w))).toBe(true);
    });

    test("a heading #card immediately followed by another heading has an empty body and yields zero cards", () => {
      const md = ["## Q one #card", "## Q two"].join("\n");

      const result = extract(md);

      expect(result.cards).toHaveLength(0);
    });
  });

  describe("safe degradation", () => {
    test("a forgotten ^ terminator stops at the first blank line, no runaway to EOF", () => {
      const md = [
        "What is X? #card",
        "Para one.",
        "",
        "Para two.",
        "",
        "Para three.",
      ].join("\n");

      const result = extract(md);

      expect(result.cards).toHaveLength(1);
      expect(result.cards[0]?.answer).toBe("Para one.");
    });
  });

  describe("R6 — whitespace-only line is treated as blank", () => {
    test("a line of only spaces terminates a single-block answer like an empty line", () => {
      const md = "What is X? #card\nLine one.\n   \nLine two.";

      const result = extract(md);

      expect(result.cards).toHaveLength(1);
      expect(result.cards[0]?.answer).toBe("Line one.");
    });
  });

  describe("R4 — empty answer is surfaced as a warning, not silently dropped", () => {
    test("a suppressed empty-answer #card pushes at least one /empty/i warning onto result.warnings", () => {
      const result = extract("Question? #card\n\nUnrelated.");
      const warnings = (result as { warnings?: string[] }).warnings ?? [];

      expect(result.cards).toHaveLength(0);
      expect(warnings.length).toBeGreaterThanOrEqual(1);
      expect(warnings.some((w) => /empty/i.test(w))).toBe(true);
    });
  });

  describe("§4.3.3 — bare ^ terminator becomes the identity anchor on insertion", () => {
    const md = [
      "What is TCP? #card",
      "Para one.",
      "",
      "Para two.",
      "^",
    ].join("\n");

    test("replaces the bare ^ line with ^q-xxxx, emitting exactly one anchor token and no duplicate", () => {
      const result = extract(md);
      expect(result.cards).toHaveLength(1);
      expect(result.cards[0]?.answer).toBe("Para one.\n\nPara two.");

      const anchored = insertCardAnchors({
        cards: result.cards,
        generateBlockId: seededGenerator(["q-abcd"]),
        markdown: md,
      });
      const applied = applyTextEdits(md, anchored.edits);

      expect(anchored.cards[0]?.blockId).toBe("q-abcd");
      expect((applied.match(/\^q-abcd/g) ?? [])).toHaveLength(1);
      expect(applied).not.toMatch(/\^\n\^q-abcd/);
      expect(applied).not.toMatch(/\^q-abcd[\s\S]*\^q-abcd/);
    });
  });
});
