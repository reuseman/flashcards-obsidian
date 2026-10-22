import { format } from "prettier";

import { DEFAULT_SETTINGS } from "../../../src/core/config/settings.js";
import { applyTextEdits } from "../../../src/core/edits/apply-text-edits.js";
import { insertCardAnchors } from "../../../src/core/edits/insert-card-anchors.js";
import { extractCardsFromMarkdown } from "../../../src/core/parse/extract-cards.js";

const TABLE = [
  "| Item | Detail   |",
  "| ---- | -------- |",
  "| test | ==word== |",
].join("\n");

function identify(markdown: string, ids = ["q-abcd", "q-efgh"]) {
  let next = 0;
  return insertCardAnchors({
    cards: extractCardsFromMarkdown(markdown, {
      notePath: "Tables.md",
      settings: DEFAULT_SETTINGS,
    }).cards,
    generateBlockId: () => {
      const id = ids[next++];
      if (!id) throw new Error("Unexpected identity generation");
      return id;
    },
    markdown,
  });
}

describe("table card anchors", () => {
  test.each([
    TABLE,
    "Item | Detail\n:--- | ---:\ntest | ==word==",
    "| Detail |\n| --- |\n| ==word== |",
    "| ==Header== |\n| ---------- |",
  ])("separates a new table anchor and keeps it stable through formatting: %s", async (table) => {
    const first = identify(table);
    const written = applyTextEdits(table, first.edits);
    expect(written).toBe(`${table}\n\n^q-abcd`);

    const formatted = await format(written, { parser: "markdown" });
    const second = identify(formatted, []);
    expect(second.cards.map((card) => card.blockId)).toEqual(["q-abcd"]);
    expect(second.edits).toEqual([]);
  });

  test.each(["q-abcd", "1700000000000"])("retains adjacent and separated existing %s anchors with LF and CRLF", (id) => {
    for (const newline of ["\n", "\r\n"]) {
      for (const gap of [newline, newline.repeat(2)]) {
        const markdown = `${TABLE.replaceAll("\n", newline)}${gap}^${id}${newline}`;
        const result = identify(markdown, []);
        expect(result.cards.map((card) => card.blockId)).toEqual([id]);
        expect(result.edits).toEqual([]);
      }
    }
  });

  test("uses CRLF when writing an anchor after a CRLF table", () => {
    const table = TABLE.replaceAll("\n", "\r\n");
    const result = identify(`${table}\r\n`);
    expect(applyTextEdits(`${table}\r\n`, result.edits)).toBe(`${table}\r\n\r\n^q-abcd\r\n`);
  });

  test("separates an anchor after a hashtag answer ending in a table", () => {
    const markdown = `Question #card\n\n${TABLE}`;
    const result = identify(markdown);
    expect(result.cards).toHaveLength(1);
    expect(applyTextEdits(markdown, result.edits)).toBe(`${markdown}\n\n^q-abcd`);
    expect(identify(applyTextEdits(markdown, result.edits), []).edits).toEqual([]);
  });

  test.each([
    "Some unrelated paragraph\n^q-wxyz",
    "Next:: Answer ^q-wxyz",
    "## Next #card\nAnswer\n^q-wxyz",
    "- Next:: Answer ^q-wxyz",
  ])("does not use an ID from the following block: %s", (following) => {
    const result = identify(`${TABLE}\n\n${following}`);
    expect(result.cards[0]?.blockId).toBe("q-abcd");
    if (result.cards.length > 1) {
      expect(result.cards[1]?.blockId).toBe("q-wxyz");
    }
  });

  test("does not take a leading ID inside the next card's source range", () => {
    const result = identify(`${TABLE}\n\n^q-wxyz\nNext:: Answer`);
    expect(result.cards).toHaveLength(2);
    expect(result.cards.map((card) => card.blockId)).toEqual(["q-abcd", "q-efgh"]);
  });

  test("does not take an ID that continues into unrelated prose", () => {
    const result = identify(`${TABLE}\n\n^q-wxyz\nSome unrelated prose`);
    expect(result.cards[0]?.blockId).toBe("q-abcd");
  });

  test("retains a separated ID before an immediately following heading", () => {
    const result = identify(`${TABLE}\n\n^q-wxyz\n## Next #card\nAnswer`);
    expect(result.cards.map((card) => card.blockId)).toEqual(["q-wxyz", "q-abcd"]);
  });

  test.each([
    "^q-abcd-extra",
    "^q-abcd text",
    "^123456789012",
    "^12345678901234",
  ])("does not adopt an incomplete or non-standalone anchor: %s", (anchor) => {
    const result = identify(`${TABLE}\n\n${anchor}`, ["q-efgh"]);
    expect(result.cards[0]?.blockId).toBe("q-efgh");
    expect(result.edits).toHaveLength(1);
  });

  test("keeps ordinary pipe prose spacing unchanged", () => {
    const markdown = "A ==word== | a pipe";
    const result = identify(markdown);
    expect(applyTextEdits(markdown, result.edits)).toBe(`${markdown}\n^q-abcd`);
  });
});
