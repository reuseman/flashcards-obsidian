import { DEFAULT_SETTINGS } from "../../../src/core/config/settings.js";
import { applyTextEdits } from "../../../src/core/edits/apply-text-edits.js";
import { insertCardAnchors } from "../../../src/core/edits/insert-card-anchors.js";
import { extractCardsFromMarkdown } from "../../../src/core/parse/extract-cards.js";

function extract(markdown: string) {
  return extractCardsFromMarkdown(markdown, {
    notePath: "Hashtag.md",
    settings: DEFAULT_SETTINGS,
  });
}

describe("hashtag card Markdown-node boundaries", () => {
  test("uses the rest of the tagged paragraph as the answer", () => {
    const result = extract("What is X? #card\nLine one.\nLine two.");

    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]).toMatchObject({
      answer: "Line one.\nLine two.",
      front: "What is X?",
      kind: "basic",
    });
  });

  test.each([
    ["paragraph", "Answer paragraph.", "Answer paragraph."],
    ["list", "- first\n- second", "- first\n- second"],
    ["blockquote", "> quoted answer", "> quoted answer"],
    ["code", "```ts\nconst answer = 1;\n```", "```ts\nconst answer = 1;\n```"],
  ])(
    "uses exactly the next %s node when the marker ends its paragraph",
    (_name, source, answer) => {
      const result = extract(
        `What is X? #card\n\n${source}\n\nNot part of the answer.`,
      );

      expect(result.cards).toHaveLength(1);
      expect(result.cards[0]).toMatchObject({ front: "What is X?", answer });
    },
  );

  test("extracts adjacent hashtag cards without either one swallowing the other", () => {
    const result = extract("Q1 #card\nA1\nQ2 #card\nA2");

    expect(result.cards).toHaveLength(2);
    expect(result.cards[0]).toMatchObject({ front: "Q1", answer: "A1" });
    expect(result.cards[1]).toMatchObject({ front: "Q2", answer: "A2" });
  });

  test("a heading card owns lower headings until the next same-level heading", () => {
    const markdown = [
      "## Mitochondria #card",
      "The powerhouse.",
      "",
      "### Detail",
      "Produces ATP.",
      "",
      "## Next topic",
      "Outside the card.",
    ].join("\n");
    const result = extract(markdown);

    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]).toMatchObject({
      answer: "The powerhouse.\n\n### Detail\nProduces ATP.",
      front: "Mitochondria",
    });
  });

  test("a standalone marker after a heading gives that heading the full section", () => {
    const markdown = [
      "## Mitochondria",
      "",
      "#card",
      "",
      "The powerhouse.",
      "",
      "### Detail",
      "",
      "Produces ATP.",
      "",
      "## Next topic",
      "Outside the card.",
    ].join("\n");
    const result = extract(markdown);

    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]).toMatchObject({
      answer: "The powerhouse.\n\n### Detail\n\nProduces ATP.",
      front: "Mitochondria",
      source: { syntax: "hashtag" },
    });
  });

  test("the next explicit card bounds a heading card", () => {
    const result = extract(
      [
        "## First #card",
        "First answer.",
        "",
        "Second #card",
        "Second answer.",
      ].join("\n"),
    );

    expect(result.cards).toHaveLength(2);
    expect(result.cards[0]).toMatchObject({
      answer: "First answer.",
      front: "First",
    });
    expect(result.cards[1]).toMatchObject({
      answer: "Second answer.",
      context: "First",
      front: "Second",
    });
  });

  test("marker text inside a blockquote is content, not a card control", () => {
    const result = extract("> Quoted question #card\n> Quoted answer");

    expect(result.cards).toHaveLength(0);
  });

  test("marker text with prose after it is content, not a card control", () => {
    const result = extract(
      "How do you tag? #card\nWrite #card here to mark it.",
    );

    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]?.answer).toBe("Write #card here to mark it.");
  });

  test("an empty heading card is skipped with a useful warning", () => {
    const result = extract("## What is recursion? #card");

    expect(result.cards).toHaveLength(0);
    expect(
      result.warnings.some((warning) => /empty answer/i.test(warning)),
    ).toBe(true);
  });

  test("a hashtag container owns inline and cloze-looking answer text", () => {
    const result = extract(
      [
        "What is syntax ownership? #card",
        "Answer::detail with TCP:::Transmission and ==highlight== plus {1:numbered}.",
      ].join("\n"),
    );

    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]).toMatchObject({
      front: "What is syntax ownership?",
      source: { syntax: "hashtag" },
    });
  });

  test("inserts the identity anchor at the owned node boundary", () => {
    const markdown = "What is X? #card\n\n- first\n- second\n\nOutside.";
    const result = extract(markdown);
    const anchored = insertCardAnchors({
      cards: result.cards,
      generateBlockId: () => "q-abcd",
      markdown,
    });
    const applied = applyTextEdits(markdown, anchored.edits);

    expect(anchored.cards[0]?.blockId).toBe("q-abcd");
    expect(applied).toBe(
      "What is X? #card\n\n- first\n- second\n^q-abcd\n\nOutside.",
    );
  });
});
