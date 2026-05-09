import { DEFAULT_SETTINGS, type FlashcardsSettings } from "../../../src/core/config/settings.js";
import { extractCardsFromMarkdown } from "../../../src/core/parse/extract-cards.js";

const folderOn: FlashcardsSettings = { ...DEFAULT_SETTINGS, folderBasedDecks: true };
const folderOff: FlashcardsSettings = { ...DEFAULT_SETTINGS, folderBasedDecks: false };

describe("folder-based deck resolution", () => {
  describe("priority chain", () => {
    test("frontmatter cards-deck wins over folder when folderBasedDecks=true", () => {
      const md = ["---", "cards-deck: Explicit", "---", "", "Q:: A"].join("\n");
      const result = extractCardsFromMarkdown(md, {
        notePath: "Languages/German/note.md",
        settings: folderOn,
      });
      expect(result.cards).toHaveLength(1);
      expect(result.cards[0]?.deckName).toBe("Explicit");
    });

    test("frontmatter subdeck Parent::Child passes through unchanged", () => {
      const md = ["---", "cards-deck: Parent::Child", "---", "", "Q:: A"].join("\n");
      const result = extractCardsFromMarkdown(md, {
        notePath: "Languages/German/note.md",
        settings: folderOn,
      });
      expect(result.cards[0]?.deckName).toBe("Parent::Child");
    });

    test("folder used when folderBasedDecks=true and no frontmatter deck", () => {
      const result = extractCardsFromMarkdown("Q:: A", {
        notePath: "Languages/German/note.md",
        settings: folderOn,
      });
      expect(result.cards[0]?.deckName).toBe("Languages::German");
    });

    test("falls through to defaultDeck when folderBasedDecks=false even with folders", () => {
      const result = extractCardsFromMarkdown("Q:: A", {
        notePath: "Languages/German/note.md",
        settings: folderOff,
      });
      expect(result.cards[0]?.deckName).toBe(folderOff.defaultDeck);
    });

    test("defaults to defaultDeck for note in repo root with no folder", () => {
      const result = extractCardsFromMarkdown("Q:: A", {
        notePath: "note.md",
        settings: folderOn,
      });
      expect(result.cards[0]?.deckName).toBe(folderOn.defaultDeck);
    });

    test("empty/whitespace cards-deck treated as unset, falls through to folder", () => {
      const md = ["---", 'cards-deck: "   "', "---", "", "Q:: A"].join("\n");
      const result = extractCardsFromMarkdown(md, {
        notePath: "Languages/German/note.md",
        settings: folderOn,
      });
      expect(result.cards[0]?.deckName).toBe("Languages::German");
    });

    test("empty cards-deck with folderBasedDecks=false falls through to defaultDeck", () => {
      const md = ["---", 'cards-deck: ""', "---", "", "Q:: A"].join("\n");
      const result = extractCardsFromMarkdown(md, {
        notePath: "Languages/German/note.md",
        settings: folderOff,
      });
      expect(result.cards[0]?.deckName).toBe(folderOff.defaultDeck);
    });
  });

  describe("path normalization", () => {
    test("single-folder path produces single deck segment", () => {
      const result = extractCardsFromMarkdown("Q:: A", {
        notePath: "inbox/note.md",
        settings: folderOn,
      });
      expect(result.cards[0]?.deckName).toBe("inbox");
    });

    test("multi-segment path joined with ::", () => {
      const result = extractCardsFromMarkdown("Q:: A", {
        notePath: "a/b/c/note.md",
        settings: folderOn,
      });
      expect(result.cards[0]?.deckName).toBe("a::b::c");
    });

    test("leading slash is stripped", () => {
      const result = extractCardsFromMarkdown("Q:: A", {
        notePath: "/foo/note.md",
        settings: folderOn,
      });
      expect(result.cards[0]?.deckName).toBe("foo");
    });

    test("leading ./ is stripped", () => {
      const result = extractCardsFromMarkdown("Q:: A", {
        notePath: "./foo/note.md",
        settings: folderOn,
      });
      expect(result.cards[0]?.deckName).toBe("foo");
    });

    test("empty segments collapsed", () => {
      const result = extractCardsFromMarkdown("Q:: A", {
        notePath: "a//b/note.md",
        settings: folderOn,
      });
      expect(result.cards[0]?.deckName).toBe("a::b");
    });

    test("trailing/leading whitespace per segment trimmed", () => {
      const result = extractCardsFromMarkdown("Q:: A", {
        notePath: "a/ b /note.md",
        settings: folderOn,
      });
      expect(result.cards[0]?.deckName).toBe("a::b");
    });

    test("backslashes preserved as literal chars in segments (single folder)", () => {
      const result = extractCardsFromMarkdown("Q:: A", {
        notePath: "a\\b/note.md",
        settings: folderOn,
      });
      expect(result.cards[0]?.deckName).toBe("a\\b");
    });
  });

  describe("applies to all card kinds", () => {
    test("inline basic picks up folder deck", () => {
      const result = extractCardsFromMarkdown("Question:: Answer", {
        notePath: "Bio/Cells/note.md",
        settings: folderOn,
      });
      expect(result.cards).toHaveLength(1);
      expect(result.cards[0]).toMatchObject({
        kind: "basic",
        deckName: "Bio::Cells",
        source: { syntax: "inline" },
      });
    });

    test("cloze picks up folder deck", () => {
      const result = extractCardsFromMarkdown("The ==heart== pumps blood.", {
        notePath: "Bio/Cells/note.md",
        settings: folderOn,
      });
      expect(result.cards).toHaveLength(1);
      expect(result.cards[0]).toMatchObject({
        kind: "cloze",
        deckName: "Bio::Cells",
      });
    });

    test("fenced flashcard picks up folder deck", () => {
      const md = [
        "```flashcard",
        "type: basic",
        "front: What is ATP?",
        "back: Adenosine triphosphate",
        "```",
      ].join("\n");
      const result = extractCardsFromMarkdown(md, {
        notePath: "Bio/Cells/note.md",
        settings: folderOn,
      });
      expect(result.cards).toHaveLength(1);
      expect(result.cards[0]).toMatchObject({
        deckName: "Bio::Cells",
        source: { syntax: "fenced" },
      });
    });

    test("legacy #card hashtag picks up folder deck", () => {
      const result = extractCardsFromMarkdown("Question\n#card\nAnswer", {
        notePath: "Bio/Cells/note.md",
        settings: folderOn,
      });
      expect(result.cards).toHaveLength(1);
      expect(result.cards[0]).toMatchObject({
        deckName: "Bio::Cells",
        source: { syntax: "legacy-hashtag" },
      });
    });
  });
});
