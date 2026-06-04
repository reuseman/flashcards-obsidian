import { describe, expect, it } from "vitest";

import { migrationCheck } from "../../src/application/migration-check.js";
import type { MarkdownNote } from "../../src/application/ports.js";

/**
 * Phase 7 slice 7b — pure module `migration-check.ts`.
 *
 * Module under test (does NOT yet exist):
 *   src/application/migration-check.ts
 *
 * Contract:
 *   - decisionMade=true → always { decision: "skip" } regardless of content.
 *   - decisionMade=false, no unmigrated anchors anywhere → { decision: "skip" }.
 *   - decisionMade=false, N>0 unmigrated → { decision: "ask", unmigratedCount, affectedNoteCount }.
 *
 * Uses the REAL detectV1Migration so frontmatter-aware dedup is exercised
 * end-to-end.
 */

function makeNote(path: string, markdown: string): MarkdownNote {
  return {
    file: {} as MarkdownNote["file"],
    markdown,
    name: path.replace(/\.md$/, "").split("/").pop() ?? path,
    path,
  };
}

const ANCHOR_A = "Some line ^1700000000001\n";
const ANCHOR_B_TWO = "L1 ^1700000000010\nL2 ^1700000000011\n";
const ANCHOR_C_THREE = [
  "x ^1700000000100",
  "y ^1700000000101",
  "z ^1700000000102",
  "",
].join("\n");

// ===========================================================================

describe("migrationCheck — decision already made", () => {
  it("returns skip even when notes contain unmigrated v1 anchors", () => {
    const notes = [makeNote("a.md", ANCHOR_A)];
    const result = migrationCheck({ notes, decisionMade: true });
    expect(result).toEqual({ decision: "skip" });
  });
});

// ===========================================================================

describe("migrationCheck — empty vault", () => {
  it("returns skip when no notes are provided", () => {
    const result = migrationCheck({ notes: [], decisionMade: false });
    expect(result).toEqual({ decision: "skip" });
  });
});

// ===========================================================================

describe("migrationCheck — no v1 anchors anywhere", () => {
  it("returns skip when notes have no unmigrated anchors", () => {
    const notes = [
      makeNote("a.md", "Plain note.\n"),
      makeNote("b.md", "Q::A\n"),
    ];
    const result = migrationCheck({ notes, decisionMade: false });
    expect(result).toEqual({ decision: "skip" });
  });
});

// ===========================================================================

describe("migrationCheck — single note with 3 unmigrated anchors", () => {
  it("returns ask with the right totals", () => {
    const notes = [makeNote("a.md", ANCHOR_C_THREE)];
    const result = migrationCheck({ notes, decisionMade: false });
    expect(result).toEqual({
      decision: "ask",
      unmigratedCount: 3,
      affectedNoteCount: 1,
    });
  });
});

// ===========================================================================

describe("migrationCheck — multi-note aggregation", () => {
  it("sums unmigratedCount across notes and counts affected notes only", () => {
    const notes = [
      makeNote("a.md", ANCHOR_B_TWO), // 2
      makeNote("b.md", ANCHOR_A), // 1
      makeNote("c.md", "no anchors here\n"), // 0
    ];
    const result = migrationCheck({ notes, decisionMade: false });
    expect(result).toEqual({
      decision: "ask",
      unmigratedCount: 3,
      affectedNoteCount: 2,
    });
  });
});

// ===========================================================================

describe("migrationCheck — anchor already in frontmatter", () => {
  it("does not count anchors whose key already appears in flashcards: map", () => {
    const markdown = [
      "---",
      "flashcards:",
      "  '1700000000001': { hash: abcd1234 }",
      "---",
      "Some line ^1700000000001",
      "Another line ^1700000000002",
      "",
    ].join("\n");
    const notes = [makeNote("a.md", markdown)];
    const result = migrationCheck({ notes, decisionMade: false });
    // Only the second anchor (1700000000002) is unmigrated.
    expect(result).toEqual({
      decision: "ask",
      unmigratedCount: 1,
      affectedNoteCount: 1,
    });
  });
});
