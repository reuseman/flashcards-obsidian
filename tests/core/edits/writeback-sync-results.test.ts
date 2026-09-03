import { applyTextEdits } from "../../../src/core/edits/apply-text-edits.js";
import { writebackSyncResults } from "../../../src/core/edits/writeback-sync-results.js";
import type {
  ExecuteSyncPlanResult,
  CreateOpResult,
  UpdateOpResult,
  DeleteOpResult,
} from "../../../src/core/sync/sync-execution.js";
import type {
  Flashcard,
  IdentifiedFlashcard,
} from "../../../src/core/domain/card.js";
import type {
  CreateOp,
  UpdateOp,
  DeleteOp,
} from "../../../src/core/sync/sync-plan.js";

/**
 * Phase 6 slice 6d — frontmatter writeback after sync execution.
 *
 * Module under test (not yet implemented):
 *   src/core/edits/writeback-sync-results.ts
 *
 * API:
 *   writebackSyncResults({ markdown, results }): { edits: TextEdit[] }
 *
 * Semantics locked in tasks.md (slice 6d):
 *  - CREATE ok + nid: ensure entry `{q-xxxx: { nid, hash }}` exists. Create if
 *    absent; if present hash-only, add nid; if present with stale nid,
 *    overwrite (executor's nid is authoritative).
 *  - UPDATE ok: REPLACE the `hash` field in the existing entry. nid preserved.
 *    Absent entry → silent skip.
 *  - DELETE ok: REMOVE the entry line entirely (including trailing newline).
 *    Absent entry → silent skip.
 *  - Failed ops produce no edits.
 *  - Order: CREATE → UPDATE → DELETE within a single pass (last write wins).
 *  - Idempotent: a second run produces zero edits.
 *  - Empty `flashcards:` key after all deletes is LEFT IN PLACE.
 *  - Numeric (v1) blockIds: written quoted ("NNN...": { nid: N, hash: H }).
 */

function baseSource(): Flashcard["source"] {
  return { endOffset: 0, line: 1, startOffset: 0, syntax: "inline" };
}

function makeCard(
  blockId: string,
  overrides: Partial<Flashcard> = {},
): IdentifiedFlashcard {
  return {
    answer: "A",
    deckName: "Default",
    front: "Q",
    kind: "basic",
    source: baseSource(),
    tags: [],
    ...overrides,
    blockId,
  };
}

function createOp(card: IdentifiedFlashcard, hash: string): CreateOp {
  return { card, hash };
}

function updateOp(
  card: IdentifiedFlashcard,
  nid: number,
  oldHash: string,
  newHash: string,
): UpdateOp {
  return { card, newHash, nid, oldHash };
}

function deleteOp(blockId: string, nid: number): DeleteOp {
  return { blockId, nid };
}

function results(
  parts: {
    creates?: CreateOpResult[];
    deletes?: DeleteOpResult[];
    updates?: UpdateOpResult[];
  } = {},
): ExecuteSyncPlanResult {
  return {
    creates: parts.creates ?? [],
    deletes: parts.deletes ?? [],
    updates: parts.updates ?? [],
  };
}

// ---------------------------------------------------------------------------
// CREATE writeback
// ---------------------------------------------------------------------------

describe("writebackSyncResults — CREATE", () => {
  test("successful CREATE with blockId absent → new entry written", () => {
    const md = [
      "---",
      "flashcards:",
      "---",
      "",
      "Q:: A ^q-abcd",
      "",
    ].join("\n");
    const card = makeCard("q-abcd");
    const r = results({
      creates: [{ nid: 12345, op: createOp(card, "ab12cd34"), status: "ok" }],
    });

    const { edits } = writebackSyncResults({ markdown: md, results: r });
    const applied = applyTextEdits(md, edits);
    expect(applied).toContain("  q-abcd: { nid: 12345, hash: ab12cd34 }");
  });

  test("successful CREATE with blockId present hash-only → nid added", () => {
    const md = [
      "---",
      "flashcards:",
      "  q-abcd: { hash: ab12cd34 }",
      "---",
      "",
      "Q:: A ^q-abcd",
    ].join("\n");
    const card = makeCard("q-abcd");
    const r = results({
      creates: [{ nid: 99999, op: createOp(card, "ab12cd34"), status: "ok" }],
    });

    const { edits } = writebackSyncResults({ markdown: md, results: r });
    const applied = applyTextEdits(md, edits);
    expect(applied).toContain("  q-abcd: { nid: 99999, hash: ab12cd34 }");
    // No duplicate entry line.
    expect(applied.match(/q-abcd:/g)?.length).toBe(1);
  });

  test("successful CREATE with stale nid present → nid overwritten", () => {
    const md = [
      "---",
      "flashcards:",
      "  q-abcd: { nid: 11111, hash: oldhashh }",
      "---",
    ].join("\n");
    const card = makeCard("q-abcd");
    const r = results({
      creates: [{ nid: 22222, op: createOp(card, "newhashh"), status: "ok" }],
    });

    const { edits } = writebackSyncResults({ markdown: md, results: r });
    const applied = applyTextEdits(md, edits);
    expect(applied).toContain("  q-abcd: { nid: 22222, hash: newhashh }");
    expect(applied).not.toContain("11111");
    expect(applied).not.toContain("oldhashh");
  });

  test("failed CREATE → no edit", () => {
    const md = [
      "---",
      "flashcards:",
      "---",
      "",
      "Q:: A ^q-abcd",
    ].join("\n");
    const card = makeCard("q-abcd");
    const r = results({
      creates: [
        { error: "boom", op: createOp(card, "ab12cd34"), status: "failed" },
      ],
    });

    const { edits } = writebackSyncResults({ markdown: md, results: r });
    expect(edits).toEqual([]);
  });

  test("multiple successful CREATEs → entries written in results order", () => {
    const md = [
      "---",
      "flashcards:",
      "---",
      "",
      "Q1:: A1 ^q-aaaa",
      "",
      "Q2:: A2 ^q-bbbb",
      "",
      "Q3:: A3 ^q-cccc",
    ].join("\n");
    const r = results({
      creates: [
        { nid: 1, op: createOp(makeCard("q-aaaa"), "hashaaaa"), status: "ok" },
        { nid: 2, op: createOp(makeCard("q-bbbb"), "hashbbbb"), status: "ok" },
        { nid: 3, op: createOp(makeCard("q-cccc"), "hashcccc"), status: "ok" },
      ],
    });

    const { edits } = writebackSyncResults({ markdown: md, results: r });
    const applied = applyTextEdits(md, edits);
    expect(applied).toContain("  q-aaaa: { nid: 1, hash: hashaaaa }");
    expect(applied).toContain("  q-bbbb: { nid: 2, hash: hashbbbb }");
    expect(applied).toContain("  q-cccc: { nid: 3, hash: hashcccc }");

    const idxA = applied.indexOf("q-aaaa:");
    const idxB = applied.indexOf("q-bbbb:");
    const idxC = applied.indexOf("q-cccc:");
    expect(idxA).toBeLessThan(idxB);
    expect(idxB).toBeLessThan(idxC);
  });
});

// ---------------------------------------------------------------------------
// UPDATE writeback
// ---------------------------------------------------------------------------

describe("writebackSyncResults — UPDATE", () => {
  it("replaces nid as well as hash after a successful model recreation", () => {
    const md = [
      "---",
      "flashcards:",
      "  q-abcd: { nid: 1111111111111, hash: oldhash }",
      "---",
      "Q::A ^q-abcd",
      "",
    ].join("\n");
    const op = updateOp(makeCard("q-abcd"), 1111111111111, "oldhash", "newhash");
    const result = writebackSyncResults({
      markdown: md,
      results: results({
        updates: [{ op, status: "ok", nid: 2222222222222 }],
      }),
    });

    expect(applyTextEdits(md, result.edits)).toContain(
      "q-abcd: { nid: 2222222222222, hash: newhash }",
    );
  });

  test("successful UPDATE: hash replaced; nid preserved", () => {
    const md = [
      "---",
      "flashcards:",
      "  q-abcd: { nid: 42, hash: oldhashh }",
      "---",
    ].join("\n");
    const card = makeCard("q-abcd");
    const r = results({
      updates: [
        {
          op: updateOp(card, 42, "oldhashh", "newhashh"),
          status: "ok",
        },
      ],
    });

    const { edits } = writebackSyncResults({ markdown: md, results: r });
    const applied = applyTextEdits(md, edits);
    expect(applied).toContain("  q-abcd: { nid: 42, hash: newhashh }");
    expect(applied).not.toContain("oldhashh");
  });

  test("failed UPDATE → no edit", () => {
    const md = [
      "---",
      "flashcards:",
      "  q-abcd: { nid: 42, hash: oldhashh }",
      "---",
    ].join("\n");
    const card = makeCard("q-abcd");
    const r = results({
      updates: [
        {
          error: "boom",
          op: updateOp(card, 42, "oldhashh", "newhashh"),
          status: "failed",
        },
      ],
    });

    const { edits } = writebackSyncResults({ markdown: md, results: r });
    expect(edits).toEqual([]);
  });

  test("UPDATE targeting absent blockId → silent skip (zero edits)", () => {
    const md = [
      "---",
      "flashcards:",
      "  q-zzzz: { nid: 99, hash: zzhash00 }",
      "---",
    ].join("\n");
    const card = makeCard("q-abcd");
    const r = results({
      updates: [
        {
          op: updateOp(card, 42, "oldhashh", "newhashh"),
          status: "ok",
        },
      ],
    });

    const { edits } = writebackSyncResults({ markdown: md, results: r });
    expect(edits).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// DELETE writeback
// ---------------------------------------------------------------------------

describe("writebackSyncResults — DELETE", () => {
  test("successful DELETE: entry line removed", () => {
    const md = [
      "---",
      "flashcards:",
      "  q-aaaa: { nid: 1, hash: hashaaaa }",
      "  q-bbbb: { nid: 2, hash: hashbbbb }",
      "---",
      "",
      "body",
    ].join("\n");
    const r = results({
      deletes: [{ op: deleteOp("q-aaaa", 1), status: "ok" }],
    });

    const { edits } = writebackSyncResults({ markdown: md, results: r });
    const applied = applyTextEdits(md, edits);
    expect(applied).not.toContain("q-aaaa");
    expect(applied).toContain("  q-bbbb: { nid: 2, hash: hashbbbb }");
    // Block isn't left with a blank-line gap.
    expect(applied).toContain(
      "flashcards:\n  q-bbbb: { nid: 2, hash: hashbbbb }\n---",
    );
  });

  test("failed DELETE → no edit", () => {
    const md = [
      "---",
      "flashcards:",
      "  q-aaaa: { nid: 1, hash: hashaaaa }",
      "---",
    ].join("\n");
    const r = results({
      deletes: [{ error: "boom", op: deleteOp("q-aaaa", 1), status: "failed" }],
    });
    const { edits } = writebackSyncResults({ markdown: md, results: r });
    expect(edits).toEqual([]);
  });

  test("DELETE targeting absent blockId → silent skip", () => {
    const md = [
      "---",
      "flashcards:",
      "  q-bbbb: { nid: 2, hash: hashbbbb }",
      "---",
    ].join("\n");
    const r = results({
      deletes: [{ op: deleteOp("q-aaaa", 1), status: "ok" }],
    });
    const { edits } = writebackSyncResults({ markdown: md, results: r });
    expect(edits).toEqual([]);
  });

  test("all DELETEs successful → empty `flashcards:` key remains", () => {
    const md = [
      "---",
      "flashcards:",
      "  q-aaaa: { nid: 1, hash: hashaaaa }",
      "  q-bbbb: { nid: 2, hash: hashbbbb }",
      "---",
      "",
      "body",
    ].join("\n");
    const r = results({
      deletes: [
        { op: deleteOp("q-aaaa", 1), status: "ok" },
        { op: deleteOp("q-bbbb", 2), status: "ok" },
      ],
    });
    const { edits } = writebackSyncResults({ markdown: md, results: r });
    const applied = applyTextEdits(md, edits);
    expect(applied).toContain("flashcards:");
    expect(applied).not.toContain("q-aaaa");
    expect(applied).not.toContain("q-bbbb");
  });
});

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

describe("writebackSyncResults — idempotency", () => {
  test("running on results that already match state → zero edits", () => {
    const md = [
      "---",
      "flashcards:",
      "  q-abcd: { nid: 42, hash: ab12cd34 }",
      "---",
    ].join("\n");
    const card = makeCard("q-abcd");
    const r = results({
      creates: [{ nid: 42, op: createOp(card, "ab12cd34"), status: "ok" }],
    });
    const { edits } = writebackSyncResults({ markdown: md, results: r });
    expect(edits).toEqual([]);
  });

  test("second pass after applying first → zero further edits", () => {
    const md = [
      "---",
      "flashcards:",
      "---",
      "",
      "Q:: A ^q-abcd",
    ].join("\n");
    const card = makeCard("q-abcd");
    const r = results({
      creates: [{ nid: 42, op: createOp(card, "ab12cd34"), status: "ok" }],
    });

    const first = writebackSyncResults({ markdown: md, results: r });
    const afterFirst = applyTextEdits(md, first.edits);
    const second = writebackSyncResults({ markdown: afterFirst, results: r });
    expect(second.edits).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Frontmatter creation
// ---------------------------------------------------------------------------

describe("writebackSyncResults — frontmatter creation", () => {
  test("no frontmatter at all + successful CREATEs → frontmatter block created", () => {
    const md = "Q:: A ^q-abcd\n";
    const card = makeCard("q-abcd");
    const r = results({
      creates: [{ nid: 42, op: createOp(card, "ab12cd34"), status: "ok" }],
    });

    const { edits } = writebackSyncResults({ markdown: md, results: r });
    const applied = applyTextEdits(md, edits);
    expect(applied).toContain("---\nflashcards:");
    expect(applied).toContain("  q-abcd: { nid: 42, hash: ab12cd34 }");
    expect(applied.match(/^---$/gm)?.length).toBeGreaterThanOrEqual(2);
  });

  test("frontmatter exists without `flashcards:` + successful CREATEs → key appended", () => {
    const md = [
      "---",
      "tags: [foo]",
      "---",
      "",
      "Q:: A ^q-abcd",
    ].join("\n");
    const card = makeCard("q-abcd");
    const r = results({
      creates: [{ nid: 42, op: createOp(card, "ab12cd34"), status: "ok" }],
    });

    const { edits } = writebackSyncResults({ markdown: md, results: r });
    const applied = applyTextEdits(md, edits);
    expect(applied).toContain("tags: [foo]");
    expect(applied).toContain("flashcards:");
    expect(applied).toContain("  q-abcd: { nid: 42, hash: ab12cd34 }");
  });
});

// ---------------------------------------------------------------------------
// Apply-edits round-trip
// ---------------------------------------------------------------------------

describe("writebackSyncResults — round-trip", () => {
  test("apply edits, re-run → zero further edits, expected markdown", () => {
    const md = [
      "---",
      "flashcards:",
      "  q-old1: { nid: 10, hash: oldhash1 }",
      "  q-del1: { nid: 20, hash: delhash1 }",
      "---",
      "",
      "body",
    ].join("\n");
    const r = results({
      creates: [
        {
          nid: 30,
          op: createOp(makeCard("q-new1"), "newhash1"),
          status: "ok",
        },
      ],
      updates: [
        {
          op: updateOp(makeCard("q-old1"), 10, "oldhash1", "freshha1"),
          status: "ok",
        },
      ],
      deletes: [{ op: deleteOp("q-del1", 20), status: "ok" }],
    });

    const first = writebackSyncResults({ markdown: md, results: r });
    const applied = applyTextEdits(md, first.edits);

    expect(applied).toContain("  q-old1: { nid: 10, hash: freshha1 }");
    expect(applied).toContain("  q-new1: { nid: 30, hash: newhash1 }");
    expect(applied).not.toContain("q-del1");

    const second = writebackSyncResults({ markdown: applied, results: r });
    expect(second.edits).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// v1 numeric blockId support
// ---------------------------------------------------------------------------

describe("writebackSyncResults — v1 numeric blockId", () => {
  test("CREATE result with 13-digit numeric blockId → quoted key written", () => {
    const md = [
      "---",
      "flashcards:",
      "---",
      "",
      "Q:: A ^1714056234891",
    ].join("\n");
    const card = makeCard("1714056234891");
    const r = results({
      creates: [
        {
          nid: 1714056234891,
          op: createOp(card, "v1hashaa"),
          status: "ok",
        },
      ],
    });

    const { edits } = writebackSyncResults({ markdown: md, results: r });
    const applied = applyTextEdits(md, edits);
    expect(applied).toContain(
      '  "1714056234891": { nid: 1714056234891, hash: v1hashaa }',
    );
    // Unquoted form must NOT appear (avoids YAML int-vs-string ambiguity).
    expect(applied).not.toMatch(/^ {2}1714056234891:/m);
  });
});

// ---------------------------------------------------------------------------
// Same blockId in CREATE + UPDATE (shouldn't happen — lock behavior)
// ---------------------------------------------------------------------------

describe("writebackSyncResults — same blockId in CREATE + UPDATE", () => {
  test("CREATE then UPDATE on same blockId in one pass: last write wins", () => {
    const md = [
      "---",
      "flashcards:",
      "---",
      "",
      "Q:: A ^q-7f3a",
    ].join("\n");
    const card = makeCard("q-7f3a");
    const r = results({
      creates: [
        { nid: 100, op: createOp(card, "createh1"), status: "ok" },
      ],
      updates: [
        {
          op: updateOp(card, 100, "createh1", "updateh2"),
          status: "ok",
        },
      ],
    });

    const { edits } = writebackSyncResults({ markdown: md, results: r });
    const applied = applyTextEdits(md, edits);
    // UPDATE ran after CREATE → final hash is the UPDATE's newHash.
    expect(applied).toContain("  q-7f3a: { nid: 100, hash: updateh2 }");
    expect(applied).not.toContain("createh1");
    expect(applied.match(/q-7f3a:/g)?.length).toBe(1);
  });
});
