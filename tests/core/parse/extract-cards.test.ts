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

  test("an inline list card owns its child blocks", () => {
    const markdown = [
      "- Question:: Short answer",
      "",
      "  More detail.",
      "",
      "  - Child ==content== stays in the answer.",
    ].join("\n");
    const result = extractCardsFromMarkdown(markdown, {
      notePath: "List.md",
      settings: DEFAULT_SETTINGS,
    });

    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]).toMatchObject({
      answer: expect.stringContaining("More detail."),
      front: "Question",
      kind: "basic",
    });
    expect(result.cards[0]?.answer).toContain(
      "- Child ==content== stays in the answer.",
    );
  });

  test("does not render a trailing v2 anchor owned by an inline list item", () => {
    const markdown = [
      "- Question:: Short answer",
      "",
      "  More detail.",
      "",
      "  - Nested detail.",
      "^q-bv92",
    ].join("\n");
    const result = extractCardsFromMarkdown(markdown, {
      notePath: "List.md",
      settings: DEFAULT_SETTINGS,
    });

    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]).toMatchObject({
      answer: "Short answer\n\nMore detail.\n\n  - Nested detail.",
      front: "Question",
      kind: "basic",
    });
    expect(result.cards[0]?.answer).not.toContain("^q-bv92");
  });

  test("a list containing clozes becomes one cloze note", () => {
    const markdown = [
      "- The ==heart== pumps blood.",
      "- The {2:lungs} exchange gases.",
    ].join("\n");
    const result = extractCardsFromMarkdown(markdown, {
      notePath: "List.md",
      settings: DEFAULT_SETTINGS,
    });

    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]).toMatchObject({
      answer: "",
      front: markdown,
      kind: "cloze",
    });
  });

  test("does not render a trailing v2 anchor owned by a cloze list", () => {
    const markdown = [
      "- The ==heart== pumps blood.",
      "- The lungs exchange gases.",
      "^q-qdmm",
    ].join("\n");
    const result = extractCardsFromMarkdown(markdown, {
      notePath: "List.md",
      settings: DEFAULT_SETTINGS,
    });

    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]).toMatchObject({
      front: [
        "- The ==heart== pumps blood.",
        "- The lungs exchange gases.",
      ].join("\n"),
      kind: "cloze",
    });
    expect(result.cards[0]?.front).not.toContain("^q-qdmm");
  });

  test("separate inline list items remain separate cards", () => {
    const result = extractCardsFromMarkdown(
      ["- First:: One", "- Second:: Two"].join("\n"),
      { notePath: "List.md", settings: DEFAULT_SETTINGS },
    );

    expect(result.cards).toHaveLength(2);
    expect(result.cards.map(({ front, answer }) => ({ front, answer }))).toEqual([
      { answer: "One", front: "First" },
      { answer: "Two", front: "Second" },
    ]);
  });

  test("a list nested in a blockquote does not create cards", () => {
    const result = extractCardsFromMarkdown(
      ["> - Question:: Answer", "> - The ==heart== pumps."].join("\n"),
      { notePath: "Quote.md", settings: DEFAULT_SETTINGS },
    );

    expect(result.cards).toHaveLength(0);
  });

  describe("explicit card callouts", () => {
    test("[!CARD] uses its title as front and its body as answer", () => {
      const result = extractCardsFromMarkdown(
        [
          "> [!CARD] : What is recursion?",
          "> A function that calls itself.",
          ">",
          "> It needs a base case.",
        ].join("\n"),
        { notePath: "Callout.md", settings: DEFAULT_SETTINGS },
      );

      expect(result.cards).toEqual([
        expect.objectContaining({
          answer: expect.stringContaining("A function that calls itself."),
          front: "What is recursion?",
          kind: "basic",
          source: expect.objectContaining({ syntax: "callout" }),
        }),
      ]);
      expect(result.cards[0]?.answer).toContain("It needs a base case.");
    });

    test("the callout body cannot create extra inline or cloze cards", () => {
      const result = extractCardsFromMarkdown(
        [
          "> [!card] Question",
          "> Answer:: this is answer content.",
          "> The ==highlight== is also answer content.",
        ].join("\n"),
        { notePath: "Callout.md", settings: DEFAULT_SETTINGS },
      );

      expect(result.cards).toHaveLength(1);
      expect(result.cards[0]?.answer).toContain("Answer:: this is answer content.");
      expect(result.cards[0]?.answer).toContain("==highlight==");
    });

    test("a CARD callout without a question is reported and skipped", () => {
      const result = extractCardsFromMarkdown(
        ["> [!CARD]", "> Answer"].join("\n"),
        { notePath: "Callout.md", settings: DEFAULT_SETTINGS },
      );

      expect(result.cards).toEqual([]);
      expect(result.warnings).toEqual([
        "Card callout in Callout.md:1 has no question; skipped.",
      ]);
    });

    test("ordinary callout types do not create cards", () => {
      const result = extractCardsFromMarkdown(
        ["> [!quote] Source", "> Quoted text"].join("\n"),
        { notePath: "Callout.md", settings: DEFAULT_SETTINGS },
      );

      expect(result.cards).toEqual([]);
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

  test("strips trailing v1 anchor from hashtag `#card` answer block", () => {
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

  test("plain curly braces are ordinary text in the strict v2 grammar", () => {
    const result = extractCardsFromMarkdown("A set is written {a, b, c}.", {
      notePath: "Cloze.md",
      settings: DEFAULT_SETTINGS,
    });

    expect(result.cards).toHaveLength(0);
  });

  test("protects LaTeX braces while allowing a cloze to contain math", () => {
    const source = "First $a+b$, then {1:$c^{2}+d$}, then $e+f$.";
    const result = extractCardsFromMarkdown(source, {
      notePath: "Cloze.md",
      settings: DEFAULT_SETTINGS,
    });

    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]).toMatchObject({ front: source, kind: "cloze" });
  });

  test("reports malformed cloze syntax without creating a card", () => {
    const result = extractCardsFromMarkdown("The {1:answer is not closed.", {
      notePath: "Cloze.md",
      settings: DEFAULT_SETTINGS,
    });

    expect(result.cards).toHaveLength(0);
    expect(result.warnings).toEqual([
      expect.stringContaining("Cloze.md:1"),
    ]);
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

  describe("hashtag #card basic", () => {
    test("multi-line answer with separate-line tag", () => {
      const result = extractCardsFromMarkdown(
        "Question\n#card\nLine 1\nLine 2",
        { notePath: "Hashtag.md", settings: DEFAULT_SETTINGS },
      );

      expect(result.cards).toHaveLength(1);
      expect(result.cards[0]).toMatchObject({
        answer: "Line 1\nLine 2",
        front: "Question",
        kind: "basic",
        source: { syntax: "hashtag" },
      });
    });

    test("answer terminates at blank line", () => {
      const result = extractCardsFromMarkdown(
        "Question\n#card\nAnswer\n\nNot the answer",
        { notePath: "Hashtag.md", settings: DEFAULT_SETTINGS },
      );

      expect(result.cards).toHaveLength(1);
      expect(result.cards[0]?.answer).toBe("Answer");
    });

    test("answer terminates at next heading", () => {
      const result = extractCardsFromMarkdown(
        "Question\n#card\nAnswer\n## Next",
        { notePath: "Hashtag.md", settings: DEFAULT_SETTINGS },
      );

      expect(result.cards).toHaveLength(1);
      expect(result.cards[0]?.answer).toBe("Answer");
    });

    test("answer terminates at next #card", () => {
      const result = extractCardsFromMarkdown(
        "Q1\n#card\nA1\nQ2 #card\nA2",
        { notePath: "Hashtag.md", settings: DEFAULT_SETTINGS },
      );

      expect(result.cards).toHaveLength(2);
      expect(result.cards[0]).toMatchObject({ front: "Q1", answer: "A1" });
      expect(result.cards[1]).toMatchObject({ front: "Q2", answer: "A2" });
    });

    test("inline-tag strips #card token from front (no trailing space)", () => {
      const result = extractCardsFromMarkdown(
        "Question #card\nAnswer",
        { notePath: "Hashtag.md", settings: DEFAULT_SETTINGS },
      );

      expect(result.cards).toHaveLength(1);
      expect(result.cards[0]?.front).toBe("Question");
      expect(result.cards[0]?.answer).toBe("Answer");
    });

    test("heading inline-tag", () => {
      const result = extractCardsFromMarkdown(
        "## Question #card\nAnswer",
        { notePath: "Hashtag.md", settings: DEFAULT_SETTINGS },
      );

      expect(result.cards).toHaveLength(1);
      expect(result.cards[0]).toMatchObject({
        front: "Question",
        answer: "Answer",
      });
    });

    test("disabled via hashtag.enabled = false", () => {
      const result = extractCardsFromMarkdown(
        "Question\n#card\nAnswer",
        {
          notePath: "Hashtag.md",
          settings: { ...DEFAULT_SETTINGS, hashtag: { ...DEFAULT_SETTINGS.hashtag, enabled: false } },
        },
      );

      expect(result.cards).toHaveLength(0);
    });

    test("custom hashtag via hashtag.basicTag", () => {
      const settings = { ...DEFAULT_SETTINGS, hashtag: { ...DEFAULT_SETTINGS.hashtag, basicTag: "flash" } };

      const matching = extractCardsFromMarkdown(
        "Question\n#flash\nAnswer",
        { notePath: "Hashtag.md", settings },
      );
      expect(matching.cards).toHaveLength(1);
      expect(matching.cards[0]).toMatchObject({ front: "Question", answer: "Answer" });

      const notMatching = extractCardsFromMarkdown(
        "Question\n#card\nAnswer",
        { notePath: "Hashtag.md", settings },
      );
      expect(notMatching.cards).toHaveLength(0);
    });

    test("does not parse inside fenced code blocks", () => {
      const result = extractCardsFromMarkdown(
        "```md\nQuestion\n#card\nAnswer\n```",
        { notePath: "Hashtag.md", settings: DEFAULT_SETTINGS },
      );

      expect(result.cards).toHaveLength(0);
    });

    test("does not parse inside HTML comments", () => {
      const result = extractCardsFromMarkdown(
        "<!-- Question\n#card\nAnswer -->",
        { notePath: "Hashtag.md", settings: DEFAULT_SETTINGS },
      );

      expect(result.cards).toHaveLength(0);
    });

    test("does not parse inside blockquotes", () => {
      const result = extractCardsFromMarkdown(
        "> Question\n> #card\n> Answer",
        { notePath: "Hashtag.md", settings: DEFAULT_SETTINGS },
      );

      expect(result.cards).toHaveLength(0);
    });
  });

  describe("WI-7: per-syntax toggles gate the corresponding parser path", () => {
    test("inline.enabled = false skips `Q :: A` inline cards but leaves cloze cards parsed", () => {
      const settings = { ...DEFAULT_SETTINGS, inline: { ...DEFAULT_SETTINGS.inline, enabled: false } };
      const md = ["Question:: Answer", "", "The ==heart== pumps blood."].join("\n\n");

      const result = extractCardsFromMarkdown(md, { notePath: "T.md", settings });

      expect(result.cards.some((c) => c.kind === "basic")).toBe(false);
      expect(result.cards.some((c) => c.kind === "cloze")).toBe(true);
    });

    test("cloze.enabled = false skips `==x==` cloze cards but leaves inline cards parsed", () => {
      const settings = { ...DEFAULT_SETTINGS, cloze: { ...DEFAULT_SETTINGS.cloze, enabled: false } };
      const md = ["Question:: Answer", "", "The ==heart== pumps blood."].join("\n\n");

      const result = extractCardsFromMarkdown(md, { notePath: "T.md", settings });

      expect(result.cards.some((c) => c.kind === "cloze")).toBe(false);
      expect(result.cards.some((c) => c.kind === "basic")).toBe(true);
    });

    test("highlightCloze.enabled = false treats ==x== as Markdown but keeps explicit clozes", () => {
      const settings = {
        ...DEFAULT_SETTINGS,
        highlightCloze: { enabled: false },
      };
      const md = [
        "The ==heart== pumps blood.",
        "",
        "The {2:atrium} receives blood.",
        "",
        "The {{c3::ventricle}} pumps blood.",
      ].join("\n");

      const result = extractCardsFromMarkdown(md, { notePath: "T.md", settings });

      expect(result.cards).toHaveLength(2);
      expect(result.cards.map((card) => card.front)).toEqual([
        "The {2:atrium} receives blood.",
        "The {{c3::ventricle}} pumps blood.",
      ]);
    });

    test("fenced.enabled = false skips ```flashcard blocks but leaves inline cards parsed", () => {
      const settings = { ...DEFAULT_SETTINGS, fenced: { ...DEFAULT_SETTINGS.fenced, enabled: false } };
      const md = [
        "Question:: Answer",
        "",
        "```flashcard",
        "type: basic",
        "front: What is ATP?",
        "back: Adenosine triphosphate",
        "```",
      ].join("\n");

      const result = extractCardsFromMarkdown(md, { notePath: "T.md", settings });

      expect(result.cards.some((c) => c.front === "What is ATP?")).toBe(false);
      expect(result.cards.some((c) => c.front === "Question")).toBe(true);
    });
  });

  describe("fenced cloze cards", () => {
    test("type: cloze maps front to cloze text and optional back to extra", () => {
      const result = extractCardsFromMarkdown(
        [
          "```flashcard",
          "type: cloze",
          "front: The {1:heart} pumps blood.",
          "back: Remember the four chambers.",
          "```",
        ].join("\n"),
        { notePath: "T.md", settings: DEFAULT_SETTINGS },
      );

      expect(result.cards).toEqual([
        expect.objectContaining({
          answer: "Remember the four chambers.",
          front: "The {1:heart} pumps blood.",
          kind: "cloze",
        }),
      ]);
    });

    test("type: cloze does not require back", () => {
      const result = extractCardsFromMarkdown(
        [
          "```flashcard",
          "type: cloze",
          "front: The {1:heart} pumps blood.",
          "```",
        ].join("\n"),
        { notePath: "T.md", settings: DEFAULT_SETTINGS },
      );

      expect(result.cards).toEqual([
        expect.objectContaining({ answer: "", kind: "cloze" }),
      ]);
      expect(result.warnings).toEqual([]);
    });

    test("an unsupported fenced type is reported and skipped", () => {
      const result = extractCardsFromMarkdown(
        [
          "```flashcard",
          "type: mystery",
          "front: Question",
          "back: Answer",
          "```",
        ].join("\n"),
        { notePath: "T.md", settings: DEFAULT_SETTINGS },
      );

      expect(result.cards).toEqual([]);
      expect(result.warnings).toEqual([
        "Fenced flashcard block has unsupported `type: mystery`; skipped.",
      ]);
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

  describe("preserves Markdown in inline and cloze cards", () => {
    test("keeps emphasis, links, and inline code in both inline fields", () => {
      const result = extractCardsFromMarkdown(
        "What is **TCP** and [UDP](https://example.com)?::Use `reliable()` and *datagrams*.",
        { notePath: "Markdown.md", settings: DEFAULT_SETTINGS },
      );

      expect(result.cards).toHaveLength(1);
      expect(result.cards[0]).toMatchObject({
        front: "What is **TCP** and [UDP](https://example.com)?",
        answer: "Use `reliable()` and *datagrams*.",
      });
    });

    test("keeps Markdown and inline code around a cloze", () => {
      const source = "Use `pump()` to move **==blood==** through [arteries](Artery).";
      const result = extractCardsFromMarkdown(source, {
        notePath: "Markdown.md",
        settings: DEFAULT_SETTINGS,
      });

      expect(result.cards).toHaveLength(1);
      expect(result.cards[0]?.front).toBe(source);
    });

    test("does not treat an inline-code separator as a card", () => {
      const result = extractCardsFromMarkdown("Run `left::right` in a shell.", {
        notePath: "Markdown.md",
        settings: DEFAULT_SETTINGS,
      });

      expect(result.cards).toHaveLength(0);
    });

    test("does not treat inline-code braces as a cloze", () => {
      const result = extractCardsFromMarkdown("The syntax is `{value}`.", {
        notePath: "Markdown.md",
        settings: DEFAULT_SETTINGS,
      });

      expect(result.cards).toHaveLength(0);
    });

    test("preserves inline code containing separators in a real card answer", () => {
      const result = extractCardsFromMarkdown("Question::Call `left::right`.", {
        notePath: "Markdown.md",
        settings: DEFAULT_SETTINGS,
      });

      expect(result.cards).toHaveLength(1);
      expect(result.cards[0]?.answer).toBe("Call `left::right`.");
    });
  });

  describe("WI-10: double-detection suppression on `test:`-keyed notes", () => {
    function atomicNote(frontmatterLines: string[], body: string[]): string {
      return ["---", ...frontmatterLines, "---", "", ...body].join("\n");
    }

    const VALID_TEST_FRONTMATTER = ["test:", "  - title"];

    test("valid `test:` key suppresses inline and legacy cloze body scans while atomic cards still parse", () => {
      const md = atomicNote(VALID_TEST_FRONTMATTER, [
        "The ==heart== pumps blood through the body.",
        "",
        "Some prose with a separator: Capital of France::Paris.",
      ]);

      const result = extractCardsFromMarkdown(md, {
        notePath: "Atomic.md",
        settings: DEFAULT_SETTINGS,
      });

      const atomicCards = result.cards.filter(
        (c) => (c.source.syntax as string) === "atomic",
      );
      expect(atomicCards).toHaveLength(1);
      const legacy = result.cards.filter((c) => {
        const syntax = c.source.syntax as string;
        return syntax === "inline" || syntax === "cloze";
      });
      expect(legacy).toEqual([]);
    });

    test("atomic-cloze first paragraph yields exactly one card, not an atomic + legacy-cloze double", () => {
      const md = atomicNote(["test:", "  - cloze"], [
        "The ==heart== pumps blood through the body.",
      ]);

      const result = extractCardsFromMarkdown(md, {
        notePath: "Atomic.md",
        settings: DEFAULT_SETTINGS,
      });

      expect(result.cards).toHaveLength(1);
      expect(result.cards[0]?.source.syntax as string).toBe("atomic");
    });

    test("an atomic first paragraph takes precedence over a hashtag marker in that paragraph", () => {
      const md = atomicNote(VALID_TEST_FRONTMATTER, [
        "What is the owned paragraph? #card\nThis text belongs to the atomic card.",
      ]);

      const result = extractCardsFromMarkdown(md, {
        notePath: "Atomic.md",
        settings: DEFAULT_SETTINGS,
      });

      expect(result.cards).toHaveLength(1);
      expect(result.cards[0]?.source.syntax as string).toBe("atomic");
    });

    test("invalid `test:` value still suppresses inline/cloze and yields zero atomic cards", () => {
      const md = atomicNote(["test: true"], [
        "The ==heart== pumps blood through the body.",
        "",
        "Some prose with a separator: Capital of France::Paris.",
      ]);

      const result = extractCardsFromMarkdown(md, {
        notePath: "Atomic.md",
        settings: DEFAULT_SETTINGS,
      });

      expect(result.cards).toEqual([]);
    });

    test("fenced ```flashcard block still parses inside a `test:`-keyed note", () => {
      const md = atomicNote(VALID_TEST_FRONTMATTER, [
        "Some prose with a separator: Capital of France::Paris.",
        "",
        "```flashcard",
        "front: What is ATP?",
        "back: Adenosine triphosphate",
        "```",
      ]);

      const result = extractCardsFromMarkdown(md, {
        notePath: "Atomic.md",
        settings: DEFAULT_SETTINGS,
      });

      const fenced = result.cards.find(
        (c) => (c.source.syntax as string) === "fenced",
      );
      expect(fenced?.front).toBe("What is ATP?");
      expect(fenced?.answer).toBe("Adenosine triphosphate");
    });

    test("#card hashtag still parses inside a `test:`-keyed note", () => {
      const md = atomicNote(VALID_TEST_FRONTMATTER, [
        "Some prose with a separator: Capital of France::Paris.",
        "",
        "What is UDP? #card",
        "Connectionless, unreliable datagram transport.",
      ]);

      const result = extractCardsFromMarkdown(md, {
        notePath: "Atomic.md",
        settings: DEFAULT_SETTINGS,
      });

      const hashtag = result.cards.find(
        (c) => (c.source.syntax as string) === "hashtag",
      );
      expect(hashtag?.front).toBe("What is UDP?");
      expect(hashtag?.answer).toBe(
        "Connectionless, unreliable datagram transport.",
      );
    });

    test("note without a `test:` key keeps today's behaviour — inline and cloze both parse", () => {
      const md = [
        "Question:: Answer",
        "",
        "The ==heart== pumps blood through the body.",
      ].join("\n\n");

      const result = extractCardsFromMarkdown(md, {
        notePath: "Plain.md",
        settings: DEFAULT_SETTINGS,
      });

      expect(result.cards.some((c) => c.kind === "basic")).toBe(true);
      expect(result.cards.some((c) => c.kind === "cloze")).toBe(true);
    });

    test("atomic.enabled = false voids suppression even with `test:` present — legacy inline/cloze parse, no atomic cards", () => {
      const settings = {
        ...DEFAULT_SETTINGS,
        atomic: { ...DEFAULT_SETTINGS.atomic, enabled: false },
      };
      const md = atomicNote(VALID_TEST_FRONTMATTER, [
        "The ==heart== pumps blood through the body.",
        "",
        "Some prose with a separator: Capital of France::Paris.",
      ]);

      const result = extractCardsFromMarkdown(md, {
        notePath: "Atomic.md",
        settings,
      });

      const atomicCards = result.cards.filter(
        (c) => (c.source.syntax as string) === "atomic",
      );
      expect(atomicCards).toEqual([]);

      expect(result.cards.some((c) => (c.source.syntax as string) === "cloze")).toBe(true);
      expect(result.cards.some((c) => (c.source.syntax as string) === "inline")).toBe(true);
    });

    test("suppression does not leak across notes — a second keyless note in the same settings still gets inline/cloze", () => {
      const settings = DEFAULT_SETTINGS;
      const keyedNote = atomicNote(VALID_TEST_FRONTMATTER, [
        "The ==heart== pumps blood through the body.",
      ]);
      const keylessNote = [
        "Question:: Answer",
        "",
        "The ==heart== pumps blood through the body.",
      ].join("\n\n");

      extractCardsFromMarkdown(keyedNote, { notePath: "Atomic.md", settings });
      const second = extractCardsFromMarkdown(keylessNote, {
        notePath: "Plain.md",
        settings,
      });

      expect(second.cards.some((c) => c.kind === "basic")).toBe(true);
      expect(second.cards.some((c) => c.kind === "cloze")).toBe(true);
    });
  });
});
