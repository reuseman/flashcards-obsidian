import { describe, expect, it } from "vitest";

import { backfillV1Anchors } from "../../src/application/backfill-v1-anchors.js";
import { applyTextEdits } from "../../src/core/edits/apply-text-edits.js";
import { computeCardHash } from "../../src/core/edits/card-hash.js";
import { extractCardsFromMarkdown } from "../../src/core/parse/extract-cards.js";
import { DEFAULT_SETTINGS } from "../../src/core/config/settings.js";

/**
 * Phase 7 slice 7a — `backfillV1Anchors`.
 *
 * Module under test (does NOT yet exist):
 *   src/application/backfill-v1-anchors.ts
 *
 * Behavior locked here:
 *  - Scan body (not frontmatter) for `^<13-digit>` anchors.
 *  - For each unique v1 anchor missing from the `flashcards:` map,
 *    emit a TextEdit appending `<id>: { hash: <h> }`.
 *  - Hash MUST equal `computeCardHash(parsedCard)` for the card whose
 *    parsed source range ends with that anchor.
 *  - Orphan v1 anchors (no matching parsed card, e.g. inside fenced code
 *    blocks) are skipped.
 *  - Idempotent: rerunning on a backfilled markdown produces zero edits.
 *  - When `flashcards:` is missing, the key is created (slice-2-style insert).
 *  - When frontmatter is absent entirely, a fresh block is prepended.
 */

const NOTE_PATH = "notes/sample.md";
const SETTINGS = DEFAULT_SETTINGS;

function run(markdown: string) {
  return backfillV1Anchors({ markdown, notePath: NOTE_PATH, settings: SETTINGS });
}

function parsedCards(markdown: string) {
  return extractCardsFromMarkdown(markdown, {
    notePath: NOTE_PATH,
    settings: SETTINGS,
  }).cards;
}

describe("backfillV1Anchors — single anchor", () => {
  it("adds an entry with the computed hash for a v1 anchor not in frontmatter", () => {
    const md = [
      "---",
      "title: t",
      "---",
      "",
      "Q::A ^1234567890123",
      "",
    ].join("\n");

    const { edits, backfilledCount } = run(md);
    expect(backfilledCount).toBe(1);
    expect(edits.length).toBeGreaterThan(0);

    const result = applyTextEdits(md, edits);
    // The 13-digit key, quoted, with a hash field, should now be present.
    expect(result).toMatch(/"1234567890123": \{ hash: [a-z0-9]+ \}/);

    // Hash must match what computeCardHash would produce for the parsed card.
    // The parser strips trailing identity anchors from front/answer (slice
    // "anchor strip"), so the card's answer is just "A" — identify the card
    // by its source range containing the anchor offset instead.
    const cards = parsedCards(md);
    const anchorPos = md.indexOf("^1234567890123");
    const target = cards.find(
      (c) => anchorPos >= c.source.startOffset && anchorPos < c.source.endOffset,
    );
    expect(target).toBeDefined();
    const expectedHash = computeCardHash(target!);
    expect(result).toContain(`"1234567890123": { hash: ${expectedHash} }`);
  });
});

describe("backfillV1Anchors — idempotency", () => {
  it("returns zero edits when the v1 entry is already in the frontmatter", () => {
    const md = [
      "---",
      "flashcards:",
      '  "1234567890123": { hash: abcd1234 }',
      "---",
      "",
      "Q::A ^1234567890123",
      "",
    ].join("\n");

    const { edits, backfilledCount } = run(md);
    expect(edits).toEqual([]);
    expect(backfilledCount).toBe(0);
  });

  it("running backfill twice on the same markdown is a fixed point", () => {
    const md = [
      "---",
      "title: t",
      "---",
      "",
      "Q::A ^1234567890123",
      "",
    ].join("\n");

    const first = run(md);
    const after = applyTextEdits(md, first.edits);
    const second = run(after);
    expect(second.edits).toEqual([]);
    expect(second.backfilledCount).toBe(0);
  });
});

describe("backfillV1Anchors — multiple anchors", () => {
  it("only backfills v1 anchors missing from the frontmatter", () => {
    const md = [
      "---",
      "flashcards:",
      '  "1111111111111": { hash: existing1 }',
      "---",
      "",
      "Q1::A1 ^1111111111111",
      "",
      "Q2::A2 ^2222222222222",
      "",
      "Q3::A3 ^3333333333333",
      "",
    ].join("\n");

    const { edits, backfilledCount } = run(md);
    expect(backfilledCount).toBe(2);

    const result = applyTextEdits(md, edits);
    // Existing entry untouched.
    expect(result).toContain('"1111111111111": { hash: existing1 }');
    // New ones added.
    expect(result).toMatch(/"2222222222222": \{ hash: [a-z0-9]+ \}/);
    expect(result).toMatch(/"3333333333333": \{ hash: [a-z0-9]+ \}/);
  });
});

describe("backfillV1Anchors — exclusions", () => {
  it("does not migrate a v1 anchor that lives inside a fenced code block (orphan)", () => {
    const md = [
      "---",
      "title: t",
      "---",
      "",
      "```",
      "Q::A ^1234567890123",
      "```",
      "",
    ].join("\n");

    const { edits, backfilledCount } = run(md);
    expect(edits).toEqual([]);
    expect(backfilledCount).toBe(0);
  });

  it("touches only v1 anchors when mixed with v2 (q-xxxx) anchors", () => {
    const md = [
      "---",
      "flashcards:",
      "  q-abcd: { hash: hhhhhhhh }",
      "---",
      "",
      "Q1::A1 ^q-abcd",
      "",
      "Q2::A2 ^9999999999999",
      "",
    ].join("\n");

    const { edits, backfilledCount } = run(md);
    expect(backfilledCount).toBe(1);

    const result = applyTextEdits(md, edits);
    // v2 entry untouched.
    expect(result).toContain("q-abcd: { hash: hhhhhhhh }");
    // v1 entry added.
    expect(result).toMatch(/"9999999999999": \{ hash: [a-z0-9]+ \}/);
  });
});

describe("backfillV1Anchors — frontmatter shapes", () => {
  it("creates the `flashcards:` key when frontmatter exists but lacks it", () => {
    const md = [
      "---",
      "title: t",
      "---",
      "",
      "Q::A ^1234567890123",
      "",
    ].join("\n");

    const { edits, backfilledCount } = run(md);
    expect(backfilledCount).toBe(1);

    const result = applyTextEdits(md, edits);
    expect(result).toContain("title: t");
    expect(result).toMatch(/flashcards:\n\s+"1234567890123": \{ hash: [a-z0-9]+ \}/);
  });

  it("creates a fresh frontmatter block when none exists", () => {
    const md = ["Q::A ^1234567890123", ""].join("\n");

    const { edits, backfilledCount } = run(md);
    expect(backfilledCount).toBe(1);

    const result = applyTextEdits(md, edits);
    expect(result.startsWith("---\n")).toBe(true);
    expect(result).toMatch(/flashcards:\n\s+"1234567890123": \{ hash: [a-z0-9]+ \}/);
    // Body preserved after the block.
    expect(result).toContain("Q::A ^1234567890123");
  });
});

describe("backfillV1Anchors — hash correctness", () => {
  it("hash equals computeCardHash of the parsed card carrying that anchor", () => {
    const md = [
      "---",
      "title: t",
      "---",
      "",
      "Foo::Bar ^1234567890123",
      "",
    ].join("\n");

    const cards = parsedCards(md);
    const anchorPos = md.indexOf("^1234567890123");
    const card = cards.find(
      (c) => anchorPos >= c.source.startOffset && anchorPos < c.source.endOffset,
    );
    expect(card).toBeDefined();
    const expected = computeCardHash(card!);

    const { edits } = run(md);
    const result = applyTextEdits(md, edits);
    expect(result).toContain(`"1234567890123": { hash: ${expected} }`);
  });
});
