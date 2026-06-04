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

  describe("B1: cloze syntax does not double-extract as inline card", () => {
    test("{{cN::...}} on its own line yields exactly one cloze card", () => {
      const result = extractCardsFromMarkdown(
        "The {{c1::mitochondria}} is the powerhouse of the cell.\n",
        { notePath: "Cloze.md", settings: DEFAULT_SETTINGS },
      );

      expect(result.cards).toHaveLength(1);
      expect(result.cards[0]?.kind).toBe("cloze");
    });

    test("{{cN::[[wikilink]]}} yields exactly one cloze card", () => {
      const result = extractCardsFromMarkdown(
        "The {{c1::[[capital]]}} of France is Paris.\n",
        { notePath: "Cloze.md", settings: DEFAULT_SETTINGS },
      );

      expect(result.cards).toHaveLength(1);
      expect(result.cards[0]?.kind).toBe("cloze");
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

  describe("WI-3: fenced block multi-line field values", () => {
    test("captures a multi-line back: value joining continuation lines with \\n", () => {
      const result = extractCardsFromMarkdown(
        [
          "```flashcard",
          "front: What is the CAP theorem?",
          "back: A distributed store provides at most two of:",
          "Consistency, Availability, Partition-tolerance.",
          "Under a partition you choose C or A.",
          "type: basic",
          "```",
        ].join("\n"),
        { notePath: "Cap.md", settings: DEFAULT_SETTINGS },
      );

      expect(result.cards).toHaveLength(1);
      expect(result.cards[0]).toMatchObject({
        front: "What is the CAP theorem?",
        answer:
          "A distributed store provides at most two of:\nConsistency, Availability, Partition-tolerance.\nUnder a partition you choose C or A.",
        kind: "basic",
      });
    });

    test("captures a multi-line front: value joining continuation lines with \\n", () => {
      const result = extractCardsFromMarkdown(
        [
          "```flashcard",
          "front: Given the following snippet,",
          "what is the output and why?",
          "back: It prints 42.",
          "```",
        ].join("\n"),
        { notePath: "Front.md", settings: DEFAULT_SETTINGS },
      );

      expect(result.cards).toHaveLength(1);
      expect(result.cards[0]).toMatchObject({
        front: "Given the following snippet,\nwhat is the output and why?",
        answer: "It prints 42.",
        kind: "basic",
      });
    });

    test("parses fields independent of key order (back before front before type)", () => {
      const result = extractCardsFromMarkdown(
        [
          "```flashcard",
          "back: Paris",
          "front: Capital of France?",
          "type: reversed",
          "```",
        ].join("\n"),
        { notePath: "Order.md", settings: DEFAULT_SETTINGS },
      );

      expect(result.cards).toHaveLength(1);
      expect(result.cards[0]).toMatchObject({
        front: "Capital of France?",
        answer: "Paris",
        kind: "reversed",
      });
    });

    test("treats a continuation line that begins with a reserved key as a new key, not back content", () => {
      const result = extractCardsFromMarkdown(
        [
          "```flashcard",
          "front: Q",
          "back: first line of back",
          "type: reversed",
          "```",
        ].join("\n"),
        { notePath: "Reserved.md", settings: DEFAULT_SETTINGS },
      );

      expect(result.cards).toHaveLength(1);
      expect(result.cards[0]?.answer).toBe("first line of back");
      expect(result.cards[0]?.answer).not.toContain("type:");
      expect(result.cards[0]?.kind).toBe("reversed");
    });

    test("preserves a blank line inside a field value verbatim, trimming only the whole value", () => {
      const result = extractCardsFromMarkdown(
        [
          "```flashcard",
          "front: Q",
          "back: para one",
          "",
          "para two",
          "```",
        ].join("\n"),
        { notePath: "Blank.md", settings: DEFAULT_SETTINGS },
      );

      expect(result.cards).toHaveLength(1);
      expect(result.cards[0]?.answer).toBe("para one\n\npara two");
    });

    test("produces no card and a warning when back: is missing", () => {
      const result = extractCardsFromMarkdown(
        ["```flashcard", "front: Only a front", "```"].join("\n"),
        { notePath: "NoBack.md", settings: DEFAULT_SETTINGS },
      );

      expect(result.cards).toHaveLength(0);
      expect(result.warnings.some((w) => /back|required|missing/i.test(w))).toBe(
        true,
      );
    });

    test("produces no card and a warning when front: is missing", () => {
      const result = extractCardsFromMarkdown(
        ["```flashcard", "back: Only a back", "```"].join("\n"),
        { notePath: "NoFront.md", settings: DEFAULT_SETTINGS },
      );

      expect(result.cards).toHaveLength(0);
      expect(result.warnings.some((w) => /front|required|missing/i.test(w))).toBe(
        true,
      );
    });
  });

  // B5: markdown-form images `![alt](file.png)` were stripped from visible
  // text by `phrasingToVisibleText`, so the downstream media rewriter never
  // saw them. Wikilink-form `![[file.png]]` survived only because mdast
  // treats it as plain text. Both forms must reach the renderer verbatim.
  test("preserves markdown image syntax in inline card answer", () => {
    const result = extractCardsFromMarkdown(
      "What does this look like?::Look ![alt](pic.png)",
      {
        notePath: "Images.md",
        settings: DEFAULT_SETTINGS,
      },
    );

    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]?.answer).toContain("![alt](pic.png)");
  });

  test("preserves wikilink image syntax in inline card answer", () => {
    const result = extractCardsFromMarkdown(
      "Describe the diagram ![[diagram.png]]::It shows a flow.",
      {
        notePath: "Images.md",
        settings: DEFAULT_SETTINGS,
      },
    );

    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]?.front).toContain("![[diagram.png]]");
  });

  test("preserves markdown image with empty alt", () => {
    const result = extractCardsFromMarkdown(
      "Q::A ![](pic.png)",
      {
        notePath: "Images.md",
        settings: DEFAULT_SETTINGS,
      },
    );

    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]?.answer).toContain("![](pic.png)");
  });
});
