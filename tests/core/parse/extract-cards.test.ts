import { DEFAULT_SETTINGS } from "../../../src/core/config/settings.js";
import { extractCardsFromMarkdown } from "../../../src/core/parse/extract-cards.js";

describe("extractCardsFromMarkdown", () => {
  test("parses inline cards in paragraphs", () => {
    const result = extractCardsFromMarkdown("Question:: Answer", {
      notePath: "Inline.md",
      settings: DEFAULT_SETTINGS,
    });

    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]).toMatchObject({
      answer: "Answer",
      front: "Question",
      kind: "basic",
    });
  });

  test("parses inline cards in list items", () => {
    const result = extractCardsFromMarkdown("- Question:: Answer", {
      notePath: "List.md",
      settings: DEFAULT_SETTINGS,
    });

    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]).toMatchObject({
      answer: "Answer",
      front: "Question",
      kind: "basic",
    });
  });

  test("does not parse inline cards inside blockquotes", () => {
    const result = extractCardsFromMarkdown("> Question:: Answer", {
      notePath: "Blockquote.md",
      settings: DEFAULT_SETTINGS,
    });

    expect(result.cards).toHaveLength(0);
  });

  test("does not parse inline cards inside fenced code blocks", () => {
    const result = extractCardsFromMarkdown(
      ["```md", "Question:: Answer", "```"].join("\n"),
      {
        notePath: "Code.md",
        settings: DEFAULT_SETTINGS,
      },
    );

    expect(result.cards).toHaveLength(0);
  });

  test("does not parse inline cards inside html comments", () => {
    const result = extractCardsFromMarkdown("<!-- Question:: Answer -->", {
      notePath: "HtmlComment.md",
      settings: DEFAULT_SETTINGS,
    });

    expect(result.cards).toHaveLength(0);
  });

  test("parses cloze cards in paragraphs", () => {
    const result = extractCardsFromMarkdown("The ==heart== pumps blood.", {
      notePath: "Cloze.md",
      settings: DEFAULT_SETTINGS,
    });

    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]?.front).toContain("==heart==");
  });

  test("preserves multiple cloze markers verbatim (no parser numbering)", () => {
    const result = extractCardsFromMarkdown(
      "The ==heart== pumps ==blood== through {2:arteries}.",
      { notePath: "Cloze.md", settings: DEFAULT_SETTINGS },
    );

    expect(result.cards).toHaveLength(1);
    const front = result.cards[0]?.front ?? "";
    expect(front).toContain("==heart==");
    expect(front).toContain("==blood==");
    expect(front).toContain("{2:arteries}");
    expect(front).not.toContain("{{c");
  });

  test("strips trailing v2 anchor `^q-xxxx` from inline card front/answer", () => {
    const result = extractCardsFromMarkdown("Question:: Answer ^q-abcd", {
      notePath: "T.md",
      settings: DEFAULT_SETTINGS,
    });
    expect(result.cards[0]?.front).toBe("Question");
    expect(result.cards[0]?.answer).toBe("Answer");
  });

  test("strips trailing v1 13-digit anchor from inline card answer", () => {
    const result = extractCardsFromMarkdown("Q:: A ^1714056234891", {
      notePath: "T.md",
      settings: DEFAULT_SETTINGS,
    });
    expect(result.cards[0]?.answer).toBe("A");
  });

  test("strips trailing v1 anchor from legacy `#card` answer block", () => {
    const md = "Question #card\nAnswer line one\nAnswer line two ^1714056234891";
    const result = extractCardsFromMarkdown(md, {
      notePath: "T.md",
      settings: DEFAULT_SETTINGS,
    });
    expect(result.cards[0]?.answer).toBe("Answer line one\nAnswer line two");
  });

  test("preserves explicit-number cloze syntax verbatim", () => {
    const result = extractCardsFromMarkdown(
      "The {1:heart} pumps {2:blood}.",
      { notePath: "Cloze.md", settings: DEFAULT_SETTINGS },
    );

    expect(result.cards).toHaveLength(1);
    const front = result.cards[0]?.front ?? "";
    expect(front).toContain("{1:heart}");
    expect(front).toContain("{2:blood}");
    expect(front).not.toContain("{{c");
  });

  describe("reversed inline cards (:::)", () => {
    test("parses reversed inline cards in paragraphs", () => {
      const result = extractCardsFromMarkdown("Question::: Answer", {
        notePath: "ReversedInline.md",
        settings: DEFAULT_SETTINGS,
      });

      expect(result.cards).toHaveLength(1);
      expect(result.cards[0]).toMatchObject({
        answer: "Answer",
        front: "Question",
        kind: "reversed",
        source: { syntax: "inline" },
      });
    });

    test("parses reversed inline cards in list items", () => {
      const result = extractCardsFromMarkdown("- Question::: Answer", {
        notePath: "ReversedInlineList.md",
        settings: DEFAULT_SETTINGS,
      });

      expect(result.cards).toHaveLength(1);
      expect(result.cards[0]).toMatchObject({
        answer: "Answer",
        front: "Question",
        kind: "reversed",
        source: { syntax: "inline" },
      });
    });

    test("does not parse reversed inline cards inside blockquotes", () => {
      const result = extractCardsFromMarkdown("> Question::: Answer", {
        notePath: "ReversedInlineBlockquote.md",
        settings: DEFAULT_SETTINGS,
      });

      expect(result.cards).toHaveLength(0);
    });

    test("does not parse reversed inline cards inside fenced code blocks", () => {
      const result = extractCardsFromMarkdown(
        ["```md", "Question::: Answer", "```"].join("\n"),
        {
          notePath: "ReversedInlineCode.md",
          settings: DEFAULT_SETTINGS,
        },
      );

      expect(result.cards).toHaveLength(0);
    });

    test("does not parse reversed inline cards inside html comments", () => {
      const result = extractCardsFromMarkdown("<!-- Question::: Answer -->", {
        notePath: "ReversedInlineHtmlComment.md",
        settings: DEFAULT_SETTINGS,
      });

      expect(result.cards).toHaveLength(0);
    });

    test("triple colon wins over double colon (reversed, not basic)", () => {
      const result = extractCardsFromMarkdown("Question::: Answer", {
        notePath: "ReversedInlineDisambiguation.md",
        settings: DEFAULT_SETTINGS,
      });

      expect(result.cards).toHaveLength(1);
      expect(result.cards[0]?.kind).toBe("reversed");
    });

    test("basic and reversed inline cards co-exist in the same note", () => {
      const result = extractCardsFromMarkdown(
        ["Foo:: Bar", "", "Baz::: Qux"].join("\n"),
        {
          notePath: "ReversedInlineCoexist.md",
          settings: DEFAULT_SETTINGS,
        },
      );

      expect(result.cards).toHaveLength(2);
      expect(result.cards[0]).toMatchObject({
        answer: "Bar",
        front: "Foo",
        kind: "basic",
      });
      expect(result.cards[1]).toMatchObject({
        answer: "Qux",
        front: "Baz",
        kind: "reversed",
      });
    });
  });

  describe("legacy #card basic", () => {
    test("multi-line answer with separate-line tag", () => {
      const result = extractCardsFromMarkdown(
        "Question\n#card\nLine 1\nLine 2",
        { notePath: "Legacy.md", settings: DEFAULT_SETTINGS },
      );

      expect(result.cards).toHaveLength(1);
      expect(result.cards[0]).toMatchObject({
        answer: "Line 1\nLine 2",
        front: "Question",
        kind: "basic",
        source: { syntax: "legacy-hashtag" },
      });
    });

    test("answer terminates at blank line", () => {
      const result = extractCardsFromMarkdown(
        "Question\n#card\nAnswer\n\nNot the answer",
        { notePath: "Legacy.md", settings: DEFAULT_SETTINGS },
      );

      expect(result.cards).toHaveLength(1);
      expect(result.cards[0]?.answer).toBe("Answer");
    });

    test("answer terminates at next heading", () => {
      const result = extractCardsFromMarkdown(
        "Question\n#card\nAnswer\n## Next",
        { notePath: "Legacy.md", settings: DEFAULT_SETTINGS },
      );

      expect(result.cards).toHaveLength(1);
      expect(result.cards[0]?.answer).toBe("Answer");
    });

    test("answer terminates at next #card", () => {
      const result = extractCardsFromMarkdown(
        "Q1\n#card\nA1\nQ2 #card\nA2",
        { notePath: "Legacy.md", settings: DEFAULT_SETTINGS },
      );

      expect(result.cards).toHaveLength(2);
      expect(result.cards[0]).toMatchObject({ front: "Q1", answer: "A1" });
      expect(result.cards[1]).toMatchObject({ front: "Q2", answer: "A2" });
    });

    test("inline-tag strips #card token from front (no trailing space)", () => {
      const result = extractCardsFromMarkdown(
        "Question #card\nAnswer",
        { notePath: "Legacy.md", settings: DEFAULT_SETTINGS },
      );

      expect(result.cards).toHaveLength(1);
      expect(result.cards[0]?.front).toBe("Question");
      expect(result.cards[0]?.answer).toBe("Answer");
    });

    test("heading inline-tag", () => {
      const result = extractCardsFromMarkdown(
        "## Question #card\nAnswer",
        { notePath: "Legacy.md", settings: DEFAULT_SETTINGS },
      );

      expect(result.cards).toHaveLength(1);
      expect(result.cards[0]).toMatchObject({
        front: "Question",
        answer: "Answer",
      });
    });

    test("disabled via legacy.enabled = false", () => {
      const result = extractCardsFromMarkdown(
        "Question\n#card\nAnswer",
        {
          notePath: "Legacy.md",
          settings: { ...DEFAULT_SETTINGS, legacy: { ...DEFAULT_SETTINGS.legacy, enabled: false } },
        },
      );

      expect(result.cards).toHaveLength(0);
    });

    test("custom hashtag via legacy.hashtagBasic", () => {
      const settings = { ...DEFAULT_SETTINGS, legacy: { ...DEFAULT_SETTINGS.legacy, hashtagBasic: "flash" } };

      const matching = extractCardsFromMarkdown(
        "Question\n#flash\nAnswer",
        { notePath: "Legacy.md", settings },
      );
      expect(matching.cards).toHaveLength(1);
      expect(matching.cards[0]).toMatchObject({ front: "Question", answer: "Answer" });

      const notMatching = extractCardsFromMarkdown(
        "Question\n#card\nAnswer",
        { notePath: "Legacy.md", settings },
      );
      expect(notMatching.cards).toHaveLength(0);
    });

    test("does not parse inside fenced code blocks", () => {
      const result = extractCardsFromMarkdown(
        "```md\nQuestion\n#card\nAnswer\n```",
        { notePath: "Legacy.md", settings: DEFAULT_SETTINGS },
      );

      expect(result.cards).toHaveLength(0);
    });

    test("does not parse inside HTML comments", () => {
      const result = extractCardsFromMarkdown(
        "<!-- Question\n#card\nAnswer -->",
        { notePath: "Legacy.md", settings: DEFAULT_SETTINGS },
      );

      expect(result.cards).toHaveLength(0);
    });

    test("does not parse inside blockquotes", () => {
      const result = extractCardsFromMarkdown(
        "> Question\n> #card\n> Answer",
        { notePath: "Legacy.md", settings: DEFAULT_SETTINGS },
      );

      expect(result.cards).toHaveLength(0);
    });
  });

  test("parses fenced flashcard blocks", () => {
    const result = extractCardsFromMarkdown(
      [
        "```flashcard",
        "type: basic",
        "front: What is ATP?",
        "back: Adenosine triphosphate",
        "```",
      ].join("\n"),
      {
        notePath: "Explicit.md",
        settings: DEFAULT_SETTINGS,
      },
    );

    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]).toMatchObject({
      answer: "Adenosine triphosphate",
      front: "What is ATP?",
      kind: "basic",
    });
  });
});
