import { DEFAULT_SETTINGS } from "../../../src/core/config/settings.js";
import { extractCardsFromMarkdown } from "../../../src/core/parse/extract-cards.js";

describe("hashtag #card-reverse", () => {
  describe("paragraph shapes", () => {
    test("inline-tag on a paragraph yields a reversed card", () => {
      const result = extractCardsFromMarkdown(
        "Question #card-reverse\nAnswer",
        { notePath: "Hashtag.md", settings: DEFAULT_SETTINGS },
      );

      expect(result.cards).toHaveLength(1);
      expect(result.cards[0]).toMatchObject({
        answer: "Answer",
        front: "Question",
        kind: "reversed",
        source: { syntax: "hashtag" },
      });
    });

    test("separate-line tag on a paragraph yields a reversed card", () => {
      const result = extractCardsFromMarkdown(
        "Question\n#card-reverse\nAnswer",
        { notePath: "Hashtag.md", settings: DEFAULT_SETTINGS },
      );

      expect(result.cards).toHaveLength(1);
      expect(result.cards[0]).toMatchObject({
        answer: "Answer",
        front: "Question",
        kind: "reversed",
        source: { syntax: "hashtag" },
      });
    });
  });

  describe("heading shapes", () => {
    test("inline-tag on a heading uses heading text as front", () => {
      const result = extractCardsFromMarkdown(
        "## Question #card-reverse\nAnswer",
        { notePath: "Hashtag.md", settings: DEFAULT_SETTINGS },
      );

      expect(result.cards).toHaveLength(1);
      expect(result.cards[0]).toMatchObject({
        answer: "Answer",
        front: "Question",
        kind: "reversed",
        source: { syntax: "hashtag" },
      });
    });

    test("separate-line tag after a heading uses heading text as front", () => {
      const result = extractCardsFromMarkdown(
        "### Question\n#card-reverse\nAnswer",
        { notePath: "Hashtag.md", settings: DEFAULT_SETTINGS },
      );

      expect(result.cards).toHaveLength(1);
      expect(result.cards[0]).toMatchObject({
        answer: "Answer",
        front: "Question",
        kind: "reversed",
      });
    });
  });

  describe("alternate #card/reverse form", () => {
    test("inline-tag with slash form yields a reversed card", () => {
      const result = extractCardsFromMarkdown(
        "Question #card/reverse\nAnswer",
        { notePath: "Hashtag.md", settings: DEFAULT_SETTINGS },
      );

      expect(result.cards).toHaveLength(1);
      expect(result.cards[0]).toMatchObject({
        answer: "Answer",
        front: "Question",
        kind: "reversed",
        source: { syntax: "hashtag" },
      });
    });

    test("separate-line with slash form yields a reversed card", () => {
      const result = extractCardsFromMarkdown(
        "Question\n#card/reverse\nAnswer",
        { notePath: "Hashtag.md", settings: DEFAULT_SETTINGS },
      );

      expect(result.cards).toHaveLength(1);
      expect(result.cards[0]).toMatchObject({
        answer: "Answer",
        front: "Question",
        kind: "reversed",
      });
    });
  });

  describe("excluded contexts", () => {
    test("does not parse inside fenced code blocks", () => {
      const result = extractCardsFromMarkdown(
        "```md\nQuestion\n#card-reverse\nAnswer\n```",
        { notePath: "Hashtag.md", settings: DEFAULT_SETTINGS },
      );
      expect(result.cards).toHaveLength(0);
    });

    test("does not parse inside HTML comments", () => {
      const result = extractCardsFromMarkdown(
        "<!-- Question\n#card-reverse\nAnswer -->",
        { notePath: "Hashtag.md", settings: DEFAULT_SETTINGS },
      );
      expect(result.cards).toHaveLength(0);
    });

    test("does not parse inside blockquotes", () => {
      const result = extractCardsFromMarkdown(
        "> Question\n> #card-reverse\n> Answer",
        { notePath: "Hashtag.md", settings: DEFAULT_SETTINGS },
      );
      expect(result.cards).toHaveLength(0);
    });
  });

  describe("answer termination", () => {
    test("answer terminates at blank line", () => {
      const result = extractCardsFromMarkdown(
        "Question\n#card-reverse\nAnswer\n\nNot the answer",
        { notePath: "Hashtag.md", settings: DEFAULT_SETTINGS },
      );
      expect(result.cards).toHaveLength(1);
      expect(result.cards[0]?.answer).toBe("Answer");
      expect(result.cards[0]?.kind).toBe("reversed");
    });

    test("answer terminates at next heading", () => {
      const result = extractCardsFromMarkdown(
        "Question\n#card-reverse\nAnswer\n## Next",
        { notePath: "Hashtag.md", settings: DEFAULT_SETTINGS },
      );
      expect(result.cards).toHaveLength(1);
      expect(result.cards[0]?.answer).toBe("Answer");
    });

    test("answer terminates at next reverse-tag occurrence", () => {
      const result = extractCardsFromMarkdown(
        "Q1\n#card-reverse\nA1\nQ2 #card-reverse\nA2",
        { notePath: "Hashtag.md", settings: DEFAULT_SETTINGS },
      );
      expect(result.cards).toHaveLength(2);
      expect(result.cards[0]).toMatchObject({ front: "Q1", answer: "A1", kind: "reversed" });
      expect(result.cards[1]).toMatchObject({ front: "Q2", answer: "A2", kind: "reversed" });
    });

    test("answer terminates at EOF and joins multi-line answer with newline", () => {
      const result = extractCardsFromMarkdown(
        "Question\n#card-reverse\nLine 1\nLine 2",
        { notePath: "Hashtag.md", settings: DEFAULT_SETTINGS },
      );
      expect(result.cards).toHaveLength(1);
      expect(result.cards[0]).toMatchObject({
        answer: "Line 1\nLine 2",
        front: "Question",
        kind: "reversed",
      });
    });
  });

  describe("settings", () => {
    test("disabled via hashtag.enabled = false yields no reverse cards", () => {
      const result = extractCardsFromMarkdown(
        "Question\n#card-reverse\nAnswer",
        {
          notePath: "Hashtag.md",
          settings: { ...DEFAULT_SETTINGS, hashtag: { ...DEFAULT_SETTINGS.hashtag, enabled: false } },
        },
      );
      expect(result.cards).toHaveLength(0);
    });

    test("custom basicTag = 'flash' matches #flash-reverse and not #card-reverse", () => {
      const settings = { ...DEFAULT_SETTINGS, hashtag: { ...DEFAULT_SETTINGS.hashtag, basicTag: "flash" } };

      const matching = extractCardsFromMarkdown(
        "Question\n#flash-reverse\nAnswer",
        { notePath: "Hashtag.md", settings },
      );
      expect(matching.cards).toHaveLength(1);
      expect(matching.cards[0]).toMatchObject({
        front: "Question",
        answer: "Answer",
        kind: "reversed",
      });

      const matchingSlash = extractCardsFromMarkdown(
        "Question\n#flash/reverse\nAnswer",
        { notePath: "Hashtag.md", settings },
      );
      expect(matchingSlash.cards).toHaveLength(1);
      expect(matchingSlash.cards[0]).toMatchObject({
        front: "Question",
        answer: "Answer",
        kind: "reversed",
      });

      const notMatching = extractCardsFromMarkdown(
        "Question\n#card-reverse\nAnswer",
        { notePath: "Hashtag.md", settings },
      );
      expect(notMatching.cards).toHaveLength(0);
    });
  });

  describe("coexistence and disambiguation", () => {
    test("basic and reverse cards coexist in one note", () => {
      const result = extractCardsFromMarkdown(
        "Q1\n#card\nA1\n\nQ2\n#card-reverse\nA2",
        { notePath: "Hashtag.md", settings: DEFAULT_SETTINGS },
      );

      expect(result.cards).toHaveLength(2);
      const basic = result.cards.find((c) => c.kind === "basic");
      const reversed = result.cards.find((c) => c.kind === "reversed");
      expect(basic).toMatchObject({ front: "Q1", answer: "A1", source: { syntax: "hashtag" } });
      expect(reversed).toMatchObject({ front: "Q2", answer: "A2", source: { syntax: "hashtag" } });
    });

    test("#card-reverse is not mistaken for a basic #card via substring match", () => {
      const result = extractCardsFromMarkdown(
        "Question\n#card-reverse\nAnswer",
        { notePath: "Hashtag.md", settings: DEFAULT_SETTINGS },
      );

      expect(result.cards).toHaveLength(1);
      expect(result.cards[0]?.kind).toBe("reversed");
    });

    test("#card/reverse is not mistaken for a basic #card via substring match", () => {
      const result = extractCardsFromMarkdown(
        "Question\n#card/reverse\nAnswer",
        { notePath: "Hashtag.md", settings: DEFAULT_SETTINGS },
      );

      expect(result.cards).toHaveLength(1);
      expect(result.cards[0]?.kind).toBe("reversed");
    });
  });
});
