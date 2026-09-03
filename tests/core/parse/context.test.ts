import { DEFAULT_SETTINGS, type FlashcardsSettings } from "../../../src/core/config/settings.js";
import { extractCardsFromMarkdown } from "../../../src/core/parse/extract-cards.js";

function fronts(
  markdown: string,
  settings: FlashcardsSettings = DEFAULT_SETTINGS,
  notePath = "Folder/My note.md",
): string[] {
  return extractCardsFromMarkdown(markdown, { notePath, settings }).cards.map(
    (card) => card.front,
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

    expect(fronts(markdown)).toEqual([
      "Course > Topic > Question",
      "Course > Other topic > Next",
    ]);
  });

  test("works when headings and cards have no blank lines between them", () => {
    const markdown = ["# Course", "## Topic", "Question:: Answer"].join("\n");
    expect(fronts(markdown)).toEqual(["Course > Topic > Question"]);
  });

  test("uses the configured separator and accepts escaped newlines", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      contextSeparator: "\\n",
    };

    expect(fronts("# Course\n## Topic\nQuestion:: Answer", settings)).toEqual([
      "Course\nTopic\nQuestion",
    ]);
  });

  test("can disable context", () => {
    const settings = { ...DEFAULT_SETTINGS, contextStrategy: "none" as const };
    expect(fronts("# Course\nQuestion:: Answer", settings)).toEqual(["Question"]);
  });

  test("can use the note title instead of headings", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      contextStrategy: "note-title" as const,
    };
    expect(fronts("# Ignored\nQuestion:: Answer", settings)).toEqual([
      "My note > Question",
    ]);
  });

  test("does not repeat a heading used as a hashtag card front", () => {
    const markdown = ["# Course", "## Question #card", "Answer"].join("\n");
    expect(fronts(markdown)).toEqual(["Course > Question"]);
  });

  test.each([
    ["inline", "Question:: Answer", "Course > Question"],
    ["cloze", "The ==heart== pumps blood.", "Course > The ==heart== pumps blood."],
    [
      "fenced",
      ["```flashcard", "front: Question", "back: Answer", "```"].join("\n"),
      "Course > Question",
    ],
    ["hashtag", "Question #card\nAnswer", "Course > Question"],
  ])("applies heading context to %s cards", (_syntax, cardMarkdown, expected) => {
    expect(fronts(`# Course\n${cardMarkdown}`)).toEqual([expected]);
  });

  test("applies heading context to an atomic card", () => {
    const markdown = [
      "---",
      "test: cue",
      "---",
      "# Course",
      "First paragraph.",
    ].join("\n");

    expect(fronts(markdown)).toEqual(["Course > cue"]);
  });
});
