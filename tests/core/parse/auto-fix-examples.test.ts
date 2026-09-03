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
    expect(cards.map((card) => [card.source.syntax, card.front])).toEqual([
      ["inline", "Computer science > Recursion > What is recursion?"],
      [
        "cloze",
        "Computer science > Recursion > Cloze > The ==base case== stops recursion.",
      ],
      [
        "fenced",
        "Computer science > Recursion > Fenced card > What does a stack frame store?",
      ],
      [
        "hashtag",
        "Computer science > Recursion > Hashtag card > What is tail recursion?",
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
      front:
        "Markdown preservation > What do **TCP** and [UDP](https://en.wikipedia.org/wiki/User_Datagram_Protocol) provide?",
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
      front: "Atomic cards > What is the main idea?",
      source: { syntax: "atomic" },
      tags: ["obsidian", "atomic-example"],
    });
  });

});
