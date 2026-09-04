import { DEFAULT_SETTINGS, type FlashcardsSettings } from "../../../src/core/config/settings.js";
import { extractCardsFromMarkdown } from "../../../src/core/parse/extract-cards.js";

function cardContent(
  markdown: string,
  settings: FlashcardsSettings = DEFAULT_SETTINGS,
  notePath = "Folder/My note.md",
): Array<{ context?: string; front: string }> {
  return extractCardsFromMarkdown(markdown, { notePath, settings }).cards.map(
    (card) => ({
      ...(card.context !== undefined ? { context: card.context } : {}),
      front: card.front,
    }),
  );
}

describe("card context", () => {
  test("uses the active heading path and keeps skipped levels", () => {
    const markdown = [
      "# Course",
      "### Topic",
      "Question:: Answer",
      "## Other topic",
      "Next:: Answer",
    ].join("\n");

    expect(cardContent(markdown)).toEqual([
      { context: "Course > Topic", front: "Question" },
      { context: "Course > Other topic", front: "Next" },
    ]);
  });

  test("works when headings and cards have no blank lines between them", () => {
    const markdown = ["# Course", "## Topic", "Question:: Answer"].join("\n");
    expect(cardContent(markdown)).toEqual([
      { context: "Course > Topic", front: "Question" },
    ]);
  });

  test("uses the configured separator and accepts escaped newlines", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      contextSeparator: "\\n",
    };

    expect(cardContent("# Course\n## Topic\nQuestion:: Answer", settings)).toEqual([
      { context: "Course\nTopic", front: "Question" },
    ]);
  });

  test("can disable context", () => {
    const settings = { ...DEFAULT_SETTINGS, contextStrategy: "none" as const };
    expect(cardContent("# Course\nQuestion:: Answer", settings)).toEqual([
      { front: "Question" },
    ]);
  });

  test("can use the note title instead of headings", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      contextStrategy: "note-title" as const,
    };
    expect(cardContent("# Ignored\nQuestion:: Answer", settings)).toEqual([
      { context: "My note", front: "Question" },
    ]);
  });

  test("does not repeat a heading used as a hashtag card front", () => {
    const markdown = ["# Course", "## Question #card", "Answer"].join("\n");
    expect(cardContent(markdown)).toEqual([
      { context: "Course", front: "Question" },
    ]);
  });

  test.each([
    ["inline", "Question:: Answer", "Question"],
    ["cloze", "The ==heart== pumps blood.", "The ==heart== pumps blood."],
    [
      "fenced",
      ["```flashcard", "front: Question", "back: Answer", "```"].join("\n"),
      "Question",
    ],
    ["hashtag", "Question #card\nAnswer", "Question"],
  ])("applies heading context to %s cards", (_syntax, cardMarkdown, expected) => {
    expect(cardContent(`# Course\n${cardMarkdown}`)).toEqual([
      { context: "Course", front: expected },
    ]);
  });

  test("applies heading context to an atomic card", () => {
    const markdown = [
      "---",
      "test: cue",
      "---",
      "# Course",
      "First paragraph.",
    ].join("\n");

    expect(cardContent(markdown)).toEqual([
      { context: "Course", front: "cue" },
    ]);
  });
});
