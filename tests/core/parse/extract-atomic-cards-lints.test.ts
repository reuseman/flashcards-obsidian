import { DEFAULT_SETTINGS } from "../../../src/core/config/settings.js";
import {
  extractCardsFromMarkdown,
  type ExtractCardsResult,
} from "../../../src/core/parse/extract-cards.js";

/**
 * WI-12 — sync-time lints (design §4.8). Locks the REPORTING side of the
 * `test:` grammar: extraction already returns zero cards for these
 * scenarios (WI-8/9); this slice adds the lint that must accompany them.
 *
 * `ExtractCardsResult` does not yet expose a `lints` field — accessed via a
 * defensive cast + `?? []` fallback so the assertions fail with a real
 * AssertionError (missing/empty array) rather than a TypeError.
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

function lintsOf(result: ExtractCardsResult): string[] {
  return (result as unknown as { lints?: string[] }).lints ?? [];
}

function atomicCards(result: ExtractCardsResult) {
  return result.cards.filter((c) => (c.source.syntax as string) === "atomic");
}

const FIRST_PARAGRAPH =
  "Chlorophyll absorbs light energy to drive the reactions.";

describe("extractCardsFromMarkdown — atomic sync-time lints (WI-12)", () => {
  // -------------------------------------------------------------------------
  // Invalid `test:` value — error-level lint naming the note.
  // -------------------------------------------------------------------------

  describe("invalid `test:` value fires an error-level lint naming the note", () => {
    it("boolean `test: true` fires an error lint that suggests `title` as the likely intent", () => {
      const md = note(["test: true"], [FIRST_PARAGRAPH]);
      const result = extract(md);

      expect(atomicCards(result)).toHaveLength(0);
      const lints = lintsOf(result);
      const errorLints = lints.filter((l) => /error/i.test(l));
      expect(errorLints.length).toBeGreaterThan(0);
      expect(errorLints.some((l) => l.includes(NOTE_PATH))).toBe(true);
      expect(errorLints.some((l) => /title/i.test(l))).toBe(true);
    });

    it("a map value fires an error lint naming the note", () => {
      const md = note(["test:", "  foo: bar"], [FIRST_PARAGRAPH]);
      const result = extract(md);

      const errorLints = lintsOf(result).filter((l) => /error/i.test(l));
      expect(errorLints.length).toBeGreaterThan(0);
      expect(errorLints.some((l) => l.includes(NOTE_PATH))).toBe(true);
    });

    it("a number value fires an error lint naming the note", () => {
      const md = note(["test: 42"], [FIRST_PARAGRAPH]);
      const result = extract(md);

      const errorLints = lintsOf(result).filter((l) => /error/i.test(l));
      expect(errorLints.length).toBeGreaterThan(0);
      expect(errorLints.some((l) => l.includes(NOTE_PATH))).toBe(true);
    });

    it("a non-string list item fires an error lint naming the note", () => {
      const md = note(["test:", "  - title", "  - 42"], [FIRST_PARAGRAPH]);
      const result = extract(md);

      const errorLints = lintsOf(result).filter((l) => /error/i.test(l));
      expect(errorLints.length).toBeGreaterThan(0);
      expect(errorLints.some((l) => l.includes(NOTE_PATH))).toBe(true);
    });

    it("a duplicate cue fires an error lint naming the note", () => {
      const md = note(
        ["test:", '  - "Same cue text"', '  - "Same cue text"'],
        [FIRST_PARAGRAPH],
      );
      const result = extract(md);

      const errorLints = lintsOf(result).filter((l) => /error/i.test(l));
      expect(errorLints.length).toBeGreaterThan(0);
      expect(errorLints.some((l) => l.includes(NOTE_PATH))).toBe(true);
    });

    it("a second `reversed` item fires an error lint naming the note", () => {
      const md = note(["test:", "  - reversed", "  - reversed"], [FIRST_PARAGRAPH]);
      const result = extract(md);

      const errorLints = lintsOf(result).filter((l) => /error/i.test(l));
      expect(errorLints.length).toBeGreaterThan(0);
      expect(errorLints.some((l) => l.includes(NOTE_PATH))).toBe(true);
    });

    it("a second `cloze` item fires an error lint naming the note", () => {
      const md = note(["test:", "  - cloze", "  - cloze"], [FIRST_PARAGRAPH]);
      const result = extract(md);

      const errorLints = lintsOf(result).filter((l) => /error/i.test(l));
      expect(errorLints.length).toBeGreaterThan(0);
      expect(errorLints.some((l) => l.includes(NOTE_PATH))).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Thin card — warn lint, zero cards.
  // -------------------------------------------------------------------------

  describe("thin card (`test:` present, no first paragraph) fires a warn lint", () => {
    it("an empty body (frontmatter only) fires a warn lint naming the note", () => {
      const md = ["---", "test:", "  - title", "---", ""].join("\n");
      const result = extract(md);

      expect(atomicCards(result)).toHaveLength(0);
      const warnLints = lintsOf(result).filter((l) => /warn/i.test(l));
      expect(warnLints.length).toBeGreaterThan(0);
      expect(warnLints.some((l) => l.includes(NOTE_PATH))).toBe(true);
      expect(warnLints.some((l) => /thin/i.test(l))).toBe(true);
    });

    it("a body with no paragraph node (heading only) fires a warn lint naming the note", () => {
      const md = note(["test:", "  - title"], ["## Just a heading"]);
      const result = extract(md);

      expect(atomicCards(result)).toHaveLength(0);
      const warnLints = lintsOf(result).filter((l) => /warn/i.test(l));
      expect(warnLints.length).toBeGreaterThan(0);
      expect(warnLints.some((l) => /thin/i.test(l))).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Cloze without spans — warn lint; only the cloze item is dropped.
  // -------------------------------------------------------------------------

  describe("cloze without spans fires a warn lint; sibling items unaffected", () => {
    it("a `cloze` item whose first paragraph has no `==x==`/`{n:x}` span produces no card", () => {
      const noSpan = "Chlorophyll absorbs light with no marked span at all.";
      const md = note(["test:", "  - title", "  - cloze"], [noSpan]);
      const result = extract(md);
      const cards = atomicCards(result);

      // The whole-key gate does NOT fire (title item is a sibling, valid on
      // its own) — only the cloze item is suppressed.
      expect(cards.filter((c) => c.kind === "cloze")).toHaveLength(0);
      expect(
        cards.filter((c) => c.kind === "basic" && c.front === NOTE_TITLE),
      ).toHaveLength(1);

      const warnLints = lintsOf(result).filter((l) => /warn/i.test(l));
      expect(warnLints.length).toBeGreaterThan(0);
      expect(warnLints.some((l) => /cloze/i.test(l) && /span/i.test(l))).toBe(
        true,
      );
      expect(warnLints.some((l) => l.includes(NOTE_PATH))).toBe(true);
    });

    it("a solo `cloze` item without a span produces zero atomic cards but still fires only a warn (not an error)", () => {
      const noSpan = "No marked span here whatsoever.";
      const md = note(["test:", "  - cloze"], [noSpan]);
      const result = extract(md);

      expect(atomicCards(result)).toHaveLength(0);
      const lints = lintsOf(result);
      expect(lints.some((l) => /warn/i.test(l) && /cloze/i.test(l))).toBe(
        true,
      );
      expect(lints.some((l) => /error/i.test(l))).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // WI-12 fix — derived-front collision (WI-9's hasDerivedFrontCollision)
  // currently invalidates the whole key SILENTLY (zero cards, no lint). It
  // must fire an error-level lint naming the note, same message shape as the
  // other invalid-`test:`-value lints above.
  // -------------------------------------------------------------------------

  describe("derived-front collision fires an error-level lint naming the note (WI-12 fix)", () => {
    it("an authored cue exactly equal to the note title collides with the reserved `title` item — zero cards AND an error lint", () => {
      const md = note(
        ["test:", "  - title", `  - "${NOTE_TITLE}"`],
        [FIRST_PARAGRAPH],
      );
      const result = extract(md);

      expect(atomicCards(result)).toHaveLength(0);
      const errorLints = lintsOf(result).filter((l) => /error/i.test(l));
      expect(errorLints.length).toBeGreaterThan(0);
      expect(errorLints.some((l) => l.includes(NOTE_PATH))).toBe(true);
    });
  });
});
