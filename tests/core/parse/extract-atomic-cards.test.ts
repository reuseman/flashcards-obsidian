import { DEFAULT_SETTINGS } from "../../../src/core/config/settings.js";
import {
  extractCardsFromMarkdown,
  type ExtractCardsResult,
} from "../../../src/core/parse/extract-cards.js";

/**
 * WI-8 — `test:` frontmatter grammar, atomic extraction, answer derivation.
 * Spec: design §4.1 (grammar), §4.2 (answer derivation), §4.3 (kind mapping).
 *
 * Only atomic-syntax cards (`source.syntax === "atomic"`) are asserted on
 * throughout — legacy inline/cloze double-detection suppression is WI-10,
 * out of scope here (see brief). Fixtures avoid `::` and stray `==x==`
 * outside the cloze-item cases to keep the red focused on this slice.
 */

const NOTE_PATH = "Photosynthesis.md";
const NOTE_TITLE = "Photosynthesis";

function note(frontmatterLines: string[], bodyLines: string[]): string {
  return ["---", ...frontmatterLines, "---", "", ...bodyLines].join("\n");
}

function extract(markdown: string, notePath: string = NOTE_PATH) {
  return extractCardsFromMarkdown(markdown, {
    notePath,
    settings: DEFAULT_SETTINGS,
  });
}

function atomicCards(result: ExtractCardsResult) {
  return result.cards.filter((c) => (c.source.syntax as string) === "atomic");
}

const FIRST_PARAGRAPH =
  "Chlorophyll absorbs light energy to drive the reactions.";

describe("extractCardsFromMarkdown — atomic `test:` grammar (WI-8)", () => {
  // -------------------------------------------------------------------------
  // Type fixtures — design record types 1-5, 7.
  // -------------------------------------------------------------------------

  describe("type fixtures", () => {
    it("`[title]` produces one basic card: front = note title, back = first paragraph only", () => {
      const md = note(["test:", "  - title"], [FIRST_PARAGRAPH]);
      const cards = atomicCards(extract(md));

      expect(cards).toHaveLength(1);
      expect(cards[0]).toMatchObject({
        answer: FIRST_PARAGRAPH,
        front: NOTE_TITLE,
        kind: "basic",
      });
    });

    it("an authored cue string produces one basic card: front = cue, back = title + blank line + first paragraph", () => {
      const CUE = "What does chlorophyll do?";
      const md = note(["test:", `  - "${CUE}"`], [FIRST_PARAGRAPH]);
      const cards = atomicCards(extract(md));

      expect(cards).toHaveLength(1);
      expect(cards[0]).toMatchObject({
        answer: `${NOTE_TITLE}\n\n${FIRST_PARAGRAPH}`,
        front: CUE,
        kind: "basic",
      });
    });

    it("`[reversed]` produces one reversed card: front = title, back = first paragraph", () => {
      const md = note(["test:", "  - reversed"], [FIRST_PARAGRAPH]);
      const cards = atomicCards(extract(md));

      expect(cards).toHaveLength(1);
      expect(cards[0]).toMatchObject({
        answer: FIRST_PARAGRAPH,
        front: NOTE_TITLE,
        kind: "reversed",
      });
    });

    it("`[cloze]` produces one cloze card: front = first paragraph incl. spans, answer = title", () => {
      const withSpan = "Chlorophyll is a ==pigment== that absorbs light.";
      const md = note(["test:", "  - cloze"], [withSpan]);
      const cards = atomicCards(extract(md));

      expect(cards).toHaveLength(1);
      expect(cards[0]).toMatchObject({
        answer: NOTE_TITLE,
        front: withSpan,
        kind: "cloze",
      });
    });

    it("mixed list `[title, \"cue\"]` produces both the title card and the authored-cue card", () => {
      const CUE = "What powers photosynthesis?";
      const md = note(["test:", "  - title", `  - "${CUE}"`], [FIRST_PARAGRAPH]);
      const cards = atomicCards(extract(md));

      expect(cards).toHaveLength(2);
      const titleCard = cards.find((c) => c.front === NOTE_TITLE);
      const cueCard = cards.find((c) => c.front === CUE);
      expect(titleCard).toMatchObject({ answer: FIRST_PARAGRAPH, kind: "basic" });
      expect(cueCard).toMatchObject({
        answer: `${NOTE_TITLE}\n\n${FIRST_PARAGRAPH}`,
        kind: "basic",
      });
    });

    it("multiple authored cues each produce their own basic card with identical back composition", () => {
      const CUE_A = "Where does the light reaction occur?";
      const CUE_B = "What pigment is responsible?";
      const md = note(
        ["test:", `  - "${CUE_A}"`, `  - "${CUE_B}"`],
        [FIRST_PARAGRAPH],
      );
      const cards = atomicCards(extract(md));

      expect(cards).toHaveLength(2);
      const expectedBack = `${NOTE_TITLE}\n\n${FIRST_PARAGRAPH}`;
      expect(cards.map((c) => c.front).sort()).toEqual([CUE_A, CUE_B].sort());
      for (const c of cards) {
        expect(c.answer).toBe(expectedBack);
        expect(c.kind).toBe("basic");
      }
    });

    it("a keyless note (no `test:` key) produces zero atomic cards", () => {
      const md = [
        "---",
        "tags: [bio]",
        "---",
        "",
        FIRST_PARAGRAPH,
      ].join("\n");
      const cards = atomicCards(extract(md));

      expect(cards).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Bare scalar normalization.
  // -------------------------------------------------------------------------

  describe("bare scalar normalization", () => {
    it("`test: cloze` (bare scalar) behaves as the one-item list `[cloze]`", () => {
      const withSpan = "Chlorophyll is a ==pigment== that absorbs light.";
      const md = note(["test: cloze"], [withSpan]);
      const cards = atomicCards(extract(md));

      expect(cards).toHaveLength(1);
      expect(cards[0]).toMatchObject({
        answer: NOTE_TITLE,
        front: withSpan,
        kind: "cloze",
      });
    });

    it("a bare cue string scalar behaves as the one-item list `[cue]`", () => {
      const CUE = "What is the role of sunlight?";
      const md = note([`test: "${CUE}"`], [FIRST_PARAGRAPH]);
      const cards = atomicCards(extract(md));

      expect(cards).toHaveLength(1);
      expect(cards[0]).toMatchObject({
        answer: `${NOTE_TITLE}\n\n${FIRST_PARAGRAPH}`,
        front: CUE,
        kind: "basic",
      });
    });
  });

  // -------------------------------------------------------------------------
  // First-paragraph selection.
  // -------------------------------------------------------------------------

  describe("first-paragraph selection", () => {
    it("skips a leading heading to find the first mdast paragraph", () => {
      const md = note(
        ["test:", "  - title"],
        ["## Overview", "", FIRST_PARAGRAPH],
      );
      const cards = atomicCards(extract(md));

      expect(cards).toHaveLength(1);
      expect(cards[0]?.answer).toBe(FIRST_PARAGRAPH);
    });

    it("skips a leading list to find the first mdast paragraph", () => {
      const md = note(
        ["test:", "  - title"],
        ["- alpha", "- beta", "", FIRST_PARAGRAPH],
      );
      const cards = atomicCards(extract(md));

      expect(cards).toHaveLength(1);
      expect(cards[0]?.answer).toBe(FIRST_PARAGRAPH);
    });

    it("skips a leading code fence to find the first mdast paragraph", () => {
      const md = note(
        ["test:", "  - title"],
        ["```js", "const x = 1;", "```", "", FIRST_PARAGRAPH],
      );
      const cards = atomicCards(extract(md));

      expect(cards).toHaveLength(1);
      expect(cards[0]?.answer).toBe(FIRST_PARAGRAPH);
    });

    it("an empty body (frontmatter only) produces zero atomic cards", () => {
      const md = ["---", "test:", "  - title", "---", ""].join("\n");
      const cards = atomicCards(extract(md));

      expect(cards).toHaveLength(0);
    });

    it("a body with no paragraph node (heading only) produces zero atomic cards", () => {
      const md = note(["test:", "  - title"], ["## Just a heading"]);
      const cards = atomicCards(extract(md));

      expect(cards).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Content isolation — nothing after paragraph one leaks into any field.
  // -------------------------------------------------------------------------

  describe("content after the first paragraph", () => {
    it("never appears in any atomic card field", () => {
      const CUE = "What captures light energy?";
      const md = note(
        ["test:", "  - title", `  - "${CUE}"`, "  - reversed"],
        [
          FIRST_PARAGRAPH,
          "",
          "This second paragraph has evidence and citations that must be excluded.",
          "",
          "## Related",
          "See also chlorophyll biosynthesis.",
        ],
      );
      const cards = atomicCards(extract(md));

      expect(cards.length).toBeGreaterThan(0);
      for (const c of cards) {
        expect(c.front).not.toContain("Related");
        expect(c.answer).not.toContain("Related");
        expect(c.front).not.toContain("evidence and citations");
        expect(c.answer).not.toContain("evidence and citations");
      }
    });
  });

  // -------------------------------------------------------------------------
  // Invalid values — the whole key is rejected, zero atomic cards.
  // -------------------------------------------------------------------------

  describe("invalid `test` values produce zero atomic cards for the whole key", () => {
    it("a map value", () => {
      const md = note(["test:", "  foo: bar"], [FIRST_PARAGRAPH]);
      expect(atomicCards(extract(md))).toHaveLength(0);
    });

    it("a number value", () => {
      const md = note(["test: 42"], [FIRST_PARAGRAPH]);
      expect(atomicCards(extract(md))).toHaveLength(0);
    });

    it("a boolean `true` value", () => {
      const md = note(["test: true"], [FIRST_PARAGRAPH]);
      expect(atomicCards(extract(md))).toHaveLength(0);
    });

    it("a list containing a non-string item invalidates the whole key (no partial salvage)", () => {
      const md = note(["test:", "  - title", "  - 42"], [FIRST_PARAGRAPH]);
      expect(atomicCards(extract(md))).toHaveLength(0);
    });

    it("duplicate identical cue strings invalidate the whole key", () => {
      const md = note(
        ["test:", '  - "Same cue text"', '  - "Same cue text"'],
        [FIRST_PARAGRAPH],
      );
      expect(atomicCards(extract(md))).toHaveLength(0);
    });

    it("a second `reversed` item invalidates the whole key", () => {
      const md = note(["test:", "  - reversed", "  - reversed"], [FIRST_PARAGRAPH]);
      expect(atomicCards(extract(md))).toHaveLength(0);
    });

    it("a second `cloze` item invalidates the whole key", () => {
      const md = note(["test:", "  - cloze", "  - cloze"], [FIRST_PARAGRAPH]);
      expect(atomicCards(extract(md))).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Reserved-word matching is exact and case-sensitive.
  // -------------------------------------------------------------------------

  describe("reserved-word matching", () => {
    it("`Title` (capitalized) is an authored cue, not the reserved `title` word", () => {
      const md = note(["test:", "  - Title"], [FIRST_PARAGRAPH]);
      const cards = atomicCards(extract(md));

      expect(cards).toHaveLength(1);
      // An authored cue's back is `title\n\nfirstParagraph`, unlike the
      // reserved `title` item whose back is the first paragraph only.
      expect(cards[0]).toMatchObject({
        answer: `${NOTE_TITLE}\n\n${FIRST_PARAGRAPH}`,
        front: "Title",
        kind: "basic",
      });
    });
  });

  // -------------------------------------------------------------------------
  // Cloze spans outside the first paragraph are ignored by atomic cloze.
  // -------------------------------------------------------------------------

  describe("cloze spans outside paragraph one", () => {
    it("`==x==` spans in a later paragraph are ignored by the atomic cloze card", () => {
      const withSpan = "Chlorophyll is a ==pigment== that absorbs light.";
      const md = note(
        ["test:", "  - cloze"],
        [withSpan, "", "A later paragraph mentions a stray ==highlight== too."],
      );
      const result = extract(md);
      const atomicClozeCards = atomicCards(result).filter(
        (c) => c.kind === "cloze",
      );

      expect(atomicClozeCards).toHaveLength(1);
      expect(atomicClozeCards[0]?.front).toBe(withSpan);
      expect(atomicClozeCards[0]?.front).not.toContain("highlight");
    });

    it("`{n:x}` spans in a later paragraph are ignored by the atomic cloze card", () => {
      const withSpan = "Chlorophyll is a ==pigment== that absorbs light.";
      const md = note(
        ["test:", "  - cloze"],
        [withSpan, "", "A later paragraph mentions {1:a stray span} too."],
      );
      const result = extract(md);
      const atomicClozeCards = atomicCards(result).filter(
        (c) => c.kind === "cloze",
      );

      expect(atomicClozeCards).toHaveLength(1);
      expect(atomicClozeCards[0]?.front).toBe(withSpan);
      expect(atomicClozeCards[0]?.front).not.toContain("stray span");
    });
  });

  // -------------------------------------------------------------------------
  // `atomic.enabled: false` — the `test:` key is ignored entirely.
  // -------------------------------------------------------------------------

  describe("atomic.enabled: false", () => {
    it("ignores the `test:` key entirely, producing zero atomic cards", () => {
      const md = note(["test:", "  - title"], [FIRST_PARAGRAPH]);
      const result = extractCardsFromMarkdown(md, {
        notePath: NOTE_PATH,
        settings: { ...DEFAULT_SETTINGS, atomic: { enabled: false } },
      });

      expect(atomicCards(result)).toHaveLength(0);
    });
  });
});
