import { describe, expect, test } from "vitest";

import { DEFAULT_SETTINGS } from "../../../src/core/config/settings.js";
import { extractCardsFromMarkdown } from "../../../src/core/parse/extract-cards.js";

function extract(markdown: string, settings = DEFAULT_SETTINGS) {
  return extractCardsFromMarkdown(markdown, {
    notePath: "Principles.md",
    settings,
  });
}

describe("reminder cards", () => {
  test("creates one one-content card from #card-reminder", () => {
    const result = extract(
      "Write tests before changing production code. #card-reminder",
    );

    expect(result.warnings).toEqual([]);
    expect(result.cards).toEqual([
      expect.objectContaining({
        answer: "",
        front: "Write tests before changing production code.",
        kind: "reminder",
        source: expect.objectContaining({ syntax: "hashtag" }),
      }),
    ]);
  });

  test("does not consume the paragraph after a reminder as an answer", () => {
    const result = extract([
      "Read this quote again. #card-reminder",
      "",
      "This paragraph remains ordinary note content.",
    ].join("\n"));

    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]!.front).toBe("Read this quote again.");
    expect(result.cards[0]!.answer).toBe("");
    expect(result.cards[0]!.source.endOffset).toBe(
      "Read this quote again. #card-reminder".length,
    );
  });

  test("uses a tagged heading as content without consuming its section", () => {
    const result = extract([
      "## Prefer reversible decisions #card-reminder",
      "",
      "Supporting prose stays outside the card.",
    ].join("\n"));

    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]).toEqual(
      expect.objectContaining({
        answer: "",
        front: "Prefer reversible decisions",
        kind: "reminder",
      }),
    );
    expect(result.cards[0]!.source.endOffset).toBe(
      "## Prefer reversible decisions #card-reminder".length,
    );
  });

  test("supports a standalone marker after its content", () => {
    const result = extract("Keep the feedback loop short.\n\n#card-reminder");

    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]).toEqual(
      expect.objectContaining({
        answer: "",
        front: "Keep the feedback loop short.",
        kind: "reminder",
      }),
    );
  });

  test("supports explicit multiline content in a fenced reminder", () => {
    const result = extract([
      "```flashcard",
      "type: reminder",
      "content: First line.",
      "Second line.",
      "```",
    ].join("\n"));

    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]).toEqual(
      expect.objectContaining({
        answer: "",
        front: "First line.\nSecond line.",
        kind: "reminder",
        source: expect.objectContaining({ syntax: "fenced" }),
      }),
    );
  });

  test("reports an empty fenced reminder", () => {
    const result = extract("```flashcard\ntype: reminder\n```");

    expect(result.cards).toEqual([]);
    expect(result.warnings).toEqual([
      "Fenced reminder block missing required `content:` field; skipped.",
    ]);
  });

  test("uses the configured hashtag base", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      hashtag: { enabled: true, basicTag: "flash" },
    };
    const result = extract("Keep it simple. #flash-reminder", settings);

    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]!.kind).toBe("reminder");
  });

  test("keeps heading context separate from reminder content", () => {
    const result = extract("# Engineering\n\nKeep it simple. #card-reminder");

    expect(result.cards[0]).toEqual(
      expect.objectContaining({
        context: "Engineering",
        front: "Keep it simple.",
      }),
    );
  });
});
