import { readFileSync } from "node:fs";
import { join } from "node:path";

import { DEFAULT_SETTINGS } from "../../../src/core/config/settings.js";
import { extractCardsFromMarkdown } from "../../../src/core/parse/extract-cards.js";

const EXAMPLES = join(
  __dirname,
  "../../../test-vault/scenarios/auto-fixes",
);

function extract(filename: string) {
  const markdown = readFileSync(join(EXAMPLES, filename), "utf8");
  return extractCardsFromMarkdown(markdown, {
    notePath: `scenarios/auto-fixes/${filename}`,
    settings: DEFAULT_SETTINGS,
  }).cards;
}

describe("manual AUTO-fix examples", () => {
  it("shows heading context on every supported card syntax", () => {
    const cards = extract("01-context-headings.md");

    expect(cards).toHaveLength(4);
    expect(
      cards.map((card) => [card.source.syntax, card.context, card.front]),
    ).toEqual([
      ["inline", "Computer science > Recursion", "What is recursion?"],
      [
        "cloze",
        "Computer science > Recursion > Cloze",
        "The ==base case== stops recursion.",
      ],
      [
        "fenced",
        "Computer science > Recursion > Fenced card",
        "What does a stack frame store?",
      ],
      [
        "hashtag",
        "Computer science > Recursion > Hashtag card",
        "What is tail recursion?",
      ],
    ]);
  });

  it("passes block-style YAML tags to the card", () => {
    const cards = extract("03-yaml-block-tags.md");

    expect(cards).toHaveLength(1);
    expect(cards[0]?.tags).toEqual(["obsidian", "biology", "week-1"]);
  });

  it("preserves Markdown without creating cards from inline code", () => {
    const cards = extract("04-markdown-preservation.md");

    expect(cards).toHaveLength(3);
    expect(cards[0]).toMatchObject({
      answer: "Use *reliable delivery* with `TCP`; use datagrams with `UDP`.",
      context: "Markdown preservation",
      front: "What do **TCP** and [UDP](https://en.wikipedia.org/wiki/User_Datagram_Protocol) provide?",
    });
    expect(cards[1]?.front).toContain("`pump()`");
    expect(cards[1]?.front).toContain("**==blood==**");
    expect(cards[2]?.front).toContain(
      "![[../../features/content/diagram.png]]",
    );
  });

  it("shows context on an atomic card", () => {
    const cards = extract("05-atomic-context.md");

    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      answer: "The first paragraph becomes the answer of the atomic card.",
      context: "Atomic cards",
      front: "What is the main idea?",
      source: { syntax: "atomic" },
      tags: ["obsidian", "atomic-example"],
    });
  });

  it("provides basic, reversed, and cloze notes for existing-card checks", () => {
    const cards = extract("06-existing-card-sync.md");

    expect(cards).toHaveLength(3);
    expect(cards.map((card) => card.kind)).toEqual([
      "basic",
      "reversed",
      "cloze",
    ]);
    expect(cards.every((card) => card.deckName === "Flashcards V2 checks")).toBe(
      true,
    );
    expect(cards.every((card) => card.tags.includes("flashcards-v2-sync-check"))).toBe(
      true,
    );
  });

  it("provides strict cloze and hashtag-boundary examples without duplicates", () => {
    const cards = extract("07-strict-grammar.md");

    expect(cards).toHaveLength(3);
    expect(cards.map((card) => card.source.syntax)).toEqual([
      "cloze",
      "hashtag",
      "hashtag",
    ]);
    expect(cards[1]?.answer).toContain("### Lower heading");
    expect(cards[2]?.answer).toBe("- first item\n- second item");
  });

  it("provides one manual example for each accepted parser feature", () => {
    const cards = extract("08-accepted-features.md");

    expect(cards).toHaveLength(5);
    expect(cards.map((card) => card.source.syntax)).toEqual([
      "hashtag",
      "callout",
      "inline",
      "cloze",
      "fenced",
    ]);
    expect(cards[2]?.answer).toContain("child paragraph");
    expect(cards[3]?.front).toContain("{2:lungs}");
    expect(cards[4]).toMatchObject({
      answer: "This optional back becomes the Anki Extra field.",
      kind: "cloze",
    });
  });
});
