import { DEFAULT_SETTINGS } from "../../../src/core/config/settings.js";
import { extractCardsFromMarkdown } from "../../../src/core/parse/extract-cards.js";

function buildNote(frontmatter: string | null, body: string): string {
  if (frontmatter === null) return body;
  return `---\n${frontmatter}\n---\n\n${body}`;
}

function extractFirstCardTags(
  markdown: string,
  defaultTags: string[],
): string[] {
  const result = extractCardsFromMarkdown(markdown, {
    notePath: "Note.md",
    settings: { ...DEFAULT_SETTINGS, defaultTags, folderBasedDecks: false },
  });
  expect(result.cards).toHaveLength(1);
  return result.cards[0]!.tags;
}

describe("extractCardsFromMarkdown — tag merging (defaults + frontmatter)", () => {
  test("defaults come first, then frontmatter tags in order", () => {
    const md = buildNote("tags: a, b", "Question:: Answer");
    expect(extractFirstCardTags(md, ["obsidian"])).toEqual([
      "obsidian",
      "a",
      "b",
    ]);
  });

  test("dedups overlapping entries (keeps first occurrence)", () => {
    const md = buildNote("tags: y, z", "Question:: Answer");
    expect(extractFirstCardTags(md, ["x", "y"])).toEqual(["x", "y", "z"]);
  });

  test("empty defaults — only frontmatter tags", () => {
    const md = buildNote("tags: a", "Question:: Answer");
    expect(extractFirstCardTags(md, [])).toEqual(["a"]);
  });

  test("no tags key in frontmatter — only defaults", () => {
    const md = buildNote("cards-deck: Foo", "Question:: Answer");
    expect(extractFirstCardTags(md, ["obsidian"])).toEqual(["obsidian"]);
  });

  test("both empty yields []", () => {
    const md = buildNote(null, "Question:: Answer");
    expect(extractFirstCardTags(md, [])).toEqual([]);
  });

  test("block-style frontmatter tags are merged into card tags", () => {
    const md = buildNote("tags:\n  - course\n  - week-1", "Question:: Answer");
    expect(extractFirstCardTags(md, ["obsidian"])).toEqual([
      "obsidian",
      "course",
      "week-1",
    ]);
  });
});
