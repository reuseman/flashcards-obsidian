import { parseNoteMetadata } from "../../../src/core/parse/note-metadata.js";

function withFrontmatter(body: string): string {
  return `---\n${body}\n---\n`;
}

describe("parseNoteMetadata — tags parsing", () => {
  test("inline comma-separated", () => {
    expect(parseNoteMetadata(withFrontmatter("tags: a, b, c")).tags).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  test("YAML flow list", () => {
    expect(parseNoteMetadata(withFrontmatter("tags: [a, b, c]")).tags).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  test("flow list with double-quoted entries", () => {
    expect(parseNoteMetadata(withFrontmatter('tags: ["a", "b"]')).tags).toEqual([
      "a",
      "b",
    ]);
  });

  test("flow list with single-quoted entries", () => {
    expect(parseNoteMetadata(withFrontmatter("tags: ['a', 'b']")).tags).toEqual([
      "a",
      "b",
    ]);
  });

  test("flow list with mixed quoted/unquoted entries", () => {
    expect(
      parseNoteMetadata(withFrontmatter(`tags: ["a", b, 'c']`)).tags,
    ).toEqual(["a", "b", "c"]);
  });

  test("inline mixed quoted/unquoted", () => {
    expect(parseNoteMetadata(withFrontmatter(`tags: "a", b`)).tags).toEqual([
      "a",
      "b",
    ]);
  });

  test("trims surrounding whitespace per entry", () => {
    expect(parseNoteMetadata(withFrontmatter("tags:  a ,  b  ")).tags).toEqual([
      "a",
      "b",
    ]);
  });

  test("drops empty / whitespace-only entries", () => {
    expect(parseNoteMetadata(withFrontmatter("tags: a, , b")).tags).toEqual([
      "a",
      "b",
    ]);
  });

  test("empty value yields []", () => {
    expect(parseNoteMetadata(withFrontmatter("tags:")).tags).toEqual([]);
  });

  test("whitespace-only value yields []", () => {
    expect(parseNoteMetadata(withFrontmatter("tags:    ")).tags).toEqual([]);
  });

  test("single tag", () => {
    expect(parseNoteMetadata(withFrontmatter("tags: solo")).tags).toEqual([
      "solo",
    ]);
  });

  test("no tags key in frontmatter yields []", () => {
    expect(
      parseNoteMetadata(withFrontmatter("cards-deck: Foo")).tags,
    ).toEqual([]);
  });

  test("no frontmatter at all yields []", () => {
    expect(parseNoteMetadata("just a body, no frontmatter").tags).toEqual([]);
  });

  test("preserves internal hyphens, underscores, and slashes (Anki nested tags)", () => {
    expect(
      parseNoteMetadata(withFrontmatter("tags: a-b, c_d, e/f")).tags,
    ).toEqual(["a-b", "c_d", "e/f"]);
  });

  test("YAML block-style multi-line list", () => {
    const md = ["---", "tags:", "  - a", "  - b", "---", ""].join("\n");
    expect(parseNoteMetadata(md).tags).toEqual(["a", "b"]);
  });

  test("YAML block list stops at the next property", () => {
    const md = [
      "---",
      "tags:",
      "  - first",
      "  - 'second tag'",
      "cards-deck: Study",
      "unrelated:",
      "  - not-a-tag",
      "---",
      "",
    ].join("\n");

    expect(parseNoteMetadata(md)).toEqual(expect.objectContaining({
      cardDeck: "Study",
      tags: ["first", "second tag"],
    }));
  });
});
