import { parseCardFrontmatter } from "../../../src/core/sync/parse-card-frontmatter.js";

/**
 * Phase 5 — frontmatter `flashcards:` map parser.
 *
 * Module under test (not yet implemented):
 *   src/core/sync/parse-card-frontmatter.ts
 *
 * Output shape (locked):
 *   interface FrontmatterCardEntry { blockId: string; nid?: number; hash?: string }
 *   interface ParsedCardFrontmatter {
 *     entries: FrontmatterCardEntry[];
 *     skippedLineCount: number;
 *   }
 *
 * Supported entry shapes inside the `flashcards:` sub-block:
 *   q-xxxx: { hash: ab12cd34 }
 *   q-xxxx: { nid: 1714056234891, hash: ab12cd34 }
 *   q-xxxx: 1714056234891           (scalar shorthand → nid only)
 *   q-xxxx: { nid: 1714056234891 }  (object form, nid only)
 *   "1714056234891": { hash: ... }  (v1 numeric key, post-migration)
 *   "1714056234891": 1714056234891  (degenerate, allowed)
 *
 * Locked ambiguities (commented inline):
 *  - Block-style multi-line entry values (q-xxxx:\n  hash: ...) are NOT supported.
 *    They are counted as skipped lines.
 *  - Whitespace tolerance: only standard YAML spacing
 *    (`q-xxxx: { hash: ab12cd34 }`, with optional single leading/trailing spaces).
 *    Tighter or weirder spacing (`q-xxxx:{hash:ab12}` or `q-xxxx : { hash : ab12 }`)
 *    is rejected → counted as skipped.
 *  - Duplicate keys: last wins; the first occurrence is counted as a skipped line.
 *  - Missing `flashcards:` key entirely → empty entries, no skipped lines.
 *  - Empty `flashcards:` key (no children) → empty entries, no skipped lines.
 *  - Missing frontmatter entirely → empty entries.
 */

describe("parseCardFrontmatter — missing/empty inputs", () => {
  test("no frontmatter at all → empty entries", () => {
    const md = "Just a body, no fm.\n";
    const result = parseCardFrontmatter(md);
    expect(result.entries).toEqual([]);
    expect(result.skippedLineCount).toBe(0);
  });

  test("frontmatter without `flashcards:` key → empty entries", () => {
    const md = ["---", "tags: [a, b]", "cards-deck: MyDeck", "---", "", "Body"].join("\n");
    const result = parseCardFrontmatter(md);
    expect(result.entries).toEqual([]);
    expect(result.skippedLineCount).toBe(0);
  });

  test("empty `flashcards:` key with no children → empty entries", () => {
    const md = ["---", "flashcards:", "---", "", "Body"].join("\n");
    const result = parseCardFrontmatter(md);
    expect(result.entries).toEqual([]);
    expect(result.skippedLineCount).toBe(0);
  });

  test("empty markdown → empty entries", () => {
    const result = parseCardFrontmatter("");
    expect(result.entries).toEqual([]);
    expect(result.skippedLineCount).toBe(0);
  });
});

describe("parseCardFrontmatter — single-entry shapes", () => {
  test("object with hash only (slice 2 emitted)", () => {
    const md = [
      "---",
      "flashcards:",
      "  q-abcd: { hash: ab12cd34 }",
      "---",
    ].join("\n");
    const result = parseCardFrontmatter(md);
    expect(result.entries).toEqual([
      { blockId: "q-abcd", hash: "ab12cd34" },
    ]);
    expect(result.skippedLineCount).toBe(0);
  });

  test("object with nid + hash", () => {
    const md = [
      "---",
      "flashcards:",
      "  q-abcd: { nid: 1714056234891, hash: ab12cd34 }",
      "---",
    ].join("\n");
    const result = parseCardFrontmatter(md);
    expect(result.entries).toEqual([
      { blockId: "q-abcd", hash: "ab12cd34", nid: 1714056234891 },
    ]);
    expect(result.skippedLineCount).toBe(0);
  });

  test("scalar shorthand → nid only", () => {
    const md = [
      "---",
      "flashcards:",
      "  q-abcd: 1714056234891",
      "---",
    ].join("\n");
    const result = parseCardFrontmatter(md);
    expect(result.entries).toEqual([
      { blockId: "q-abcd", nid: 1714056234891 },
    ]);
    expect(result.skippedLineCount).toBe(0);
  });

  test("object with nid only", () => {
    const md = [
      "---",
      "flashcards:",
      "  q-abcd: { nid: 1714056234891 }",
      "---",
    ].join("\n");
    const result = parseCardFrontmatter(md);
    expect(result.entries).toEqual([
      { blockId: "q-abcd", nid: 1714056234891 },
    ]);
    expect(result.skippedLineCount).toBe(0);
  });

  test("numeric (v1) key with hash → blockId is the 13-digit string", () => {
    const md = [
      "---",
      "flashcards:",
      '  "1714056234891": { hash: ab12cd34 }',
      "---",
    ].join("\n");
    const result = parseCardFrontmatter(md);
    expect(result.entries).toEqual([
      { blockId: "1714056234891", hash: "ab12cd34" },
    ]);
    expect(result.skippedLineCount).toBe(0);
  });

  test("numeric (v1) key with degenerate scalar (same number)", () => {
    const md = [
      "---",
      "flashcards:",
      '  "1714056234891": 1714056234891',
      "---",
    ].join("\n");
    const result = parseCardFrontmatter(md);
    expect(result.entries).toEqual([
      { blockId: "1714056234891", nid: 1714056234891 },
    ]);
    expect(result.skippedLineCount).toBe(0);
  });

  test("numeric key without quotes is accepted as v1 key", () => {
    const md = [
      "---",
      "flashcards:",
      "  1714056234891: { hash: ab12cd34 }",
      "---",
    ].join("\n");
    const result = parseCardFrontmatter(md);
    expect(result.entries).toEqual([
      { blockId: "1714056234891", hash: "ab12cd34" },
    ]);
    expect(result.skippedLineCount).toBe(0);
  });
});

describe("parseCardFrontmatter — mixed entries", () => {
  test("object + scalar + numeric key in one map", () => {
    const md = [
      "---",
      "flashcards:",
      "  q-aaaa: { hash: aaaa1111 }",
      "  q-bbbb: 1700000000001",
      '  "1700000000002": { hash: bbbb2222 }',
      "  q-cccc: { nid: 1700000000003, hash: cccc3333 }",
      "---",
    ].join("\n");
    const result = parseCardFrontmatter(md);
    expect(result.entries).toEqual([
      { blockId: "q-aaaa", hash: "aaaa1111" },
      { blockId: "q-bbbb", nid: 1700000000001 },
      { blockId: "1700000000002", hash: "bbbb2222" },
      { blockId: "q-cccc", hash: "cccc3333", nid: 1700000000003 },
    ]);
    expect(result.skippedLineCount).toBe(0);
  });
});

describe("parseCardFrontmatter — indentation tolerance", () => {
  test("2-space indent", () => {
    const md = ["---", "flashcards:", "  q-abcd: { hash: ab12cd34 }", "---"].join("\n");
    const result = parseCardFrontmatter(md);
    expect(result.entries).toEqual([{ blockId: "q-abcd", hash: "ab12cd34" }]);
  });

  test("4-space indent", () => {
    const md = ["---", "flashcards:", "    q-abcd: { hash: ab12cd34 }", "---"].join("\n");
    const result = parseCardFrontmatter(md);
    expect(result.entries).toEqual([{ blockId: "q-abcd", hash: "ab12cd34" }]);
  });

  test("tab indent", () => {
    const md = ["---", "flashcards:", "\tq-abcd: { hash: ab12cd34 }", "---"].join("\n");
    const result = parseCardFrontmatter(md);
    expect(result.entries).toEqual([{ blockId: "q-abcd", hash: "ab12cd34" }]);
  });
});

describe("parseCardFrontmatter — unparseable lines counted as skipped", () => {
  test("garbage line is skipped, others parsed", () => {
    const md = [
      "---",
      "flashcards:",
      "  q-aaaa: { hash: aaaa1111 }",
      "  ???not-a-valid-entry???",
      "  q-bbbb: { hash: bbbb2222 }",
      "---",
    ].join("\n");
    const result = parseCardFrontmatter(md);
    expect(result.entries).toEqual([
      { blockId: "q-aaaa", hash: "aaaa1111" },
      { blockId: "q-bbbb", hash: "bbbb2222" },
    ]);
    expect(result.skippedLineCount).toBe(1);
  });

  test("block-style multi-line entry (NOT supported) → skipped lines", () => {
    // Locked: block-style nested values are not supported in this slice.
    // The continuation lines under `q-abcd:` are counted as skipped.
    const md = [
      "---",
      "flashcards:",
      "  q-abcd:",
      "    hash: ab12cd34",
      "  q-bbbb: { hash: bbbb2222 }",
      "---",
    ].join("\n");
    const result = parseCardFrontmatter(md);
    // The valid one is parsed.
    expect(result.entries).toContainEqual({ blockId: "q-bbbb", hash: "bbbb2222" });
    // The block-style entry produces no parsed entry.
    expect(result.entries.find((e) => e.blockId === "q-abcd")).toBeUndefined();
    // skippedLineCount > 0 (at least one of the two lines is counted).
    expect(result.skippedLineCount).toBeGreaterThan(0);
  });

  test("weird spacing rejected (locked)", () => {
    // `q-xxxx : { hash : ab12 }` — extra spacing around the colons is not standard.
    const md = [
      "---",
      "flashcards:",
      "  q-abcd : { hash : ab12cd34 }",
      "---",
    ].join("\n");
    const result = parseCardFrontmatter(md);
    expect(result.entries).toEqual([]);
    expect(result.skippedLineCount).toBe(1);
  });

  test("duplicate key — last wins, first counted as skipped (locked)", () => {
    const md = [
      "---",
      "flashcards:",
      "  q-abcd: { hash: aaaa1111 }",
      "  q-abcd: { hash: bbbb2222 }",
      "---",
    ].join("\n");
    const result = parseCardFrontmatter(md);
    expect(result.entries).toEqual([{ blockId: "q-abcd", hash: "bbbb2222" }]);
    expect(result.skippedLineCount).toBe(1);
  });
});

describe("parseCardFrontmatter — robust to surrounding frontmatter", () => {
  test("tags + cards-deck before, body keys after — only `flashcards:` sub-block parsed", () => {
    const md = [
      "---",
      "tags: [foo, bar]",
      "cards-deck: MyDeck",
      "flashcards:",
      "  q-abcd: { hash: ab12cd34 }",
      "title: Hello",
      "---",
      "",
      "Body",
    ].join("\n");
    const result = parseCardFrontmatter(md);
    expect(result.entries).toEqual([{ blockId: "q-abcd", hash: "ab12cd34" }]);
    expect(result.skippedLineCount).toBe(0);
  });

  test("block-style `tags:` list nearby must not bleed into flashcards parse", () => {
    const md = [
      "---",
      "tags:",
      "  - foo",
      "  - bar",
      "flashcards:",
      "  q-abcd: { hash: ab12cd34 }",
      "---",
      "",
      "Body",
    ].join("\n");
    const result = parseCardFrontmatter(md);
    // The `- foo`/`- bar` are siblings of `tags:`, not of `flashcards:`.
    expect(result.entries).toEqual([{ blockId: "q-abcd", hash: "ab12cd34" }]);
    expect(result.skippedLineCount).toBe(0);
  });

  test("sibling key after the sub-block ends parsing", () => {
    const md = [
      "---",
      "flashcards:",
      "  q-abcd: { hash: ab12cd34 }",
      "tags: [a, b]",
      "  q-bogus: should-not-be-parsed",
      "---",
    ].join("\n");
    const result = parseCardFrontmatter(md);
    // q-bogus is below `tags:` — outside the flashcards sub-block.
    expect(result.entries).toEqual([{ blockId: "q-abcd", hash: "ab12cd34" }]);
  });
});

describe("parseCardFrontmatter — order preservation", () => {
  test("entries preserve order from the sub-block", () => {
    const md = [
      "---",
      "flashcards:",
      "  q-cccc: { hash: cccc1111 }",
      "  q-aaaa: { hash: aaaa1111 }",
      "  q-bbbb: { hash: bbbb1111 }",
      "---",
    ].join("\n");
    const result = parseCardFrontmatter(md);
    expect(result.entries.map((e) => e.blockId)).toEqual([
      "q-cccc",
      "q-aaaa",
      "q-bbbb",
    ]);
  });
});

/**
 * WI-9 — optional `cue` field on `flashcards:` entries (design §4.4).
 *
 * `cue` marks an atomic (anchorless) card entry. Entries without `cue` are
 * body-anchored cards — existing shapes/behaviour above must stay untouched.
 * Accepted shapes (locked ordering per brief §4.4 example, `cue` first):
 *   q-xxxx: { cue: C, hash: H }
 *   q-xxxx: { cue: C, nid: N, hash: H }
 */
describe("parseCardFrontmatter — WI-9 `cue` field", () => {
  test("object with cue + hash (no nid yet) parses cue", () => {
    const md = [
      "---",
      "flashcards:",
      "  q-ab3k: { cue: f8chars8, hash: ab12cd34 }",
      "---",
    ].join("\n");
    const result = parseCardFrontmatter(md);
    expect(result.entries).toEqual([
      { blockId: "q-ab3k", cue: "f8chars8", hash: "ab12cd34" },
    ]);
    expect(result.skippedLineCount).toBe(0);
  });

  test("object with cue + nid + hash parses all three fields", () => {
    const md = [
      "---",
      "flashcards:",
      "  q-ab3k: { cue: f8chars8, nid: 1734567890123, hash: h8chars8 }",
      "---",
    ].join("\n");
    const result = parseCardFrontmatter(md);
    expect(result.entries).toEqual([
      {
        blockId: "q-ab3k",
        cue: "f8chars8",
        hash: "h8chars8",
        nid: 1734567890123,
      },
    ]);
    expect(result.skippedLineCount).toBe(0);
  });

  test("entries WITHOUT `cue` (anchored cards) still parse with `cue` left undefined", () => {
    const md = [
      "---",
      "flashcards:",
      "  q-abcd: { nid: 1714056234891, hash: ab12cd34 }",
      "---",
    ].join("\n");
    const result = parseCardFrontmatter(md);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.cue).toBeUndefined();
    // Byte-identical shape to the pre-WI-9 contract — no `cue` key materializes.
    expect(result.entries[0]).toEqual({
      blockId: "q-abcd",
      hash: "ab12cd34",
      nid: 1714056234891,
    });
  });

  test("mixed note: one atomic (cue) entry and one anchored (no cue) entry both parse correctly", () => {
    const md = [
      "---",
      "flashcards:",
      "  q-ab3k: { cue: f8chars8, nid: 1734567890123, hash: h8chars8 }",
      "  q-zzzz: { nid: 1714056234891, hash: ab12cd34 }",
      "---",
    ].join("\n");
    const result = parseCardFrontmatter(md);
    const atomic = result.entries.find((e) => e.blockId === "q-ab3k");
    const anchored = result.entries.find((e) => e.blockId === "q-zzzz");
    expect(atomic?.cue).toBe("f8chars8");
    expect(anchored?.cue).toBeUndefined();
  });
});
