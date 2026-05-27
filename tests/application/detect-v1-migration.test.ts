import { describe, expect, it } from "vitest";

import { detectV1Migration } from "../../src/application/detect-v1-migration.js";

/**
 * Phase 7 slice 7a — `detectV1Migration`.
 *
 * Module under test (does NOT yet exist):
 *   src/application/detect-v1-migration.ts
 *
 * Locked policy: SIMPLE scan over the body (post-frontmatter) for the
 * regex `\^\d{13}\b`. Does NOT exclude code blocks / HTML comments —
 * the count is a hint, not an exact answer (caller treats it that way).
 * Counts UNIQUE 13-digit values whose key is NOT already in the
 * `flashcards:` frontmatter map.
 */

describe("detectV1Migration", () => {
  it("returns 0 when there are no v1 anchors", () => {
    const md = ["---", "title: t", "---", "", "Q::A", ""].join("\n");
    expect(detectV1Migration({ markdown: md }).unmigrated).toBe(0);
  });

  it("counts every unmigrated v1 anchor when none are in the frontmatter", () => {
    const md = [
      "---",
      "title: t",
      "---",
      "",
      "Q1::A1 ^1111111111111",
      "",
      "Q2::A2 ^2222222222222",
      "",
      "Q3::A3 ^3333333333333",
      "",
    ].join("\n");
    expect(detectV1Migration({ markdown: md }).unmigrated).toBe(3);
  });

  it("excludes v1 anchors that already have a frontmatter entry", () => {
    const md = [
      "---",
      "flashcards:",
      '  "1111111111111": { hash: aaaaaaaa }',
      "---",
      "",
      "Q1::A1 ^1111111111111",
      "",
      "Q2::A2 ^2222222222222",
      "",
      "Q3::A3 ^3333333333333",
      "",
    ].join("\n");
    expect(detectV1Migration({ markdown: md }).unmigrated).toBe(2);
  });

  it("does NOT count anchors that appear only inside the frontmatter block (not in body)", () => {
    const md = [
      "---",
      "flashcards:",
      '  "1234567890123": { hash: aaaaaaaa }',
      "---",
      "",
      "no body anchors here",
      "",
    ].join("\n");
    expect(detectV1Migration({ markdown: md }).unmigrated).toBe(0);
  });

  it("COUNTS v1 anchors inside fenced code blocks (locked simple-scan policy)", () => {
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
    // Simple-scan policy: code-block exclusion would require a parser pass.
    expect(detectV1Migration({ markdown: md }).unmigrated).toBe(1);
  });
});
