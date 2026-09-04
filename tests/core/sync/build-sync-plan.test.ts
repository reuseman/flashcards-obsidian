import { buildSyncPlan } from "../../../src/core/sync/build-sync-plan.js";
import type { ParsedCardFrontmatter } from "../../../src/core/sync/parse-card-frontmatter.js";
import type {
  Flashcard,
  IdentifiedFlashcard,
} from "../../../src/core/domain/card.js";

/**
 * Phase 5 — pure sync plan diff.
 *
 * Module under test (not yet implemented):
 *   src/core/sync/build-sync-plan.ts
 *
 * SyncPlan shape (locked, replaces the stale `src/core/sync/sync-plan.ts`):
 *   interface CreateOp { card: IdentifiedFlashcard; hash: string }
 *   interface UpdateOp { card: IdentifiedFlashcard; nid: number; oldHash: string; newHash: string }
 *   interface DeleteOp { blockId: string; nid: number }
 *   interface SyncPlan { create: CreateOp[]; update: UpdateOp[]; delete: DeleteOp[] }
 *
 * API:
 *   buildSyncPlan({ cards, frontmatter, computeHash }): SyncPlan
 *
 * v2-anchor rules (q-xxxx blockIds):
 *   1. Parsed card, no fm entry             → CREATE (hash from computeHash).
 *   2. Parsed card, fm entry without nid    → CREATE.
 *   3. Parsed card, fm has nid+hash, match  → no-op.
 *   4. Parsed card, fm has nid+hash, differ → UPDATE (oldHash from fm, newHash computed).
 *   5. Parsed card, fm has nid but no hash  → UPDATE (oldHash = "", newHash computed).
 *   6. fm entry (q-xxxx) with nid, no parsed card → DELETE.
 *   7. fm entry (q-xxxx) without nid, no parsed card → SKIP.
 *
 * v1-anchor rules (13-digit numeric blockIds):
 *   A. Parsed v1 card, no fm entry          → SKIP (opt-in migration).
 *   B. Parsed v1 card, fm hash present, hashes differ → UPDATE with stored nid,
 *      falling back to parseInt(blockId).
 *      Hashes match → no-op.
 *   C. fm entry (numeric key), no parsed card → DELETE with stored nid,
 *      falling back to parseInt(blockId).
 *
 * Order stability:
 *   - create / update preserve input `cards` order.
 *   - delete preserves frontmatter entries order.
 *
 * `computeHash` is injected so tests can stub it (no SHA-256 by hand).
 */

function baseSource(): Flashcard["source"] {
  return { endOffset: 0, line: 1, startOffset: 0, syntax: "inline" };
}

function id(
  blockId: string,
  overrides: Partial<Flashcard> = {},
): IdentifiedFlashcard {
  return {
    answer: "A",
    front: "Q",
    kind: "basic",
    source: baseSource(),
    tags: [],
    ...overrides,
    blockId,
  };
}

function fm(
  entries: ParsedCardFrontmatter["entries"],
  skipped = 0,
): ParsedCardFrontmatter {
  return { entries, skippedLineCount: skipped };
}

/** Stub computeHash: deterministic, blockId-prefixed. */
function stubHash(prefix = "newhash-"): (card: IdentifiedFlashcard) => string {
  return (card) => `${prefix}${card.blockId}`;
}

describe("buildSyncPlan — empty inputs", () => {
  test("no cards + no fm entries → empty plan", () => {
    const plan = buildSyncPlan({
      cards: [],
      computeHash: stubHash(),
      frontmatter: fm([]),
    });
    expect(plan).toEqual({ create: [], delete: [], update: [] });
  });
});

describe("buildSyncPlan — v2 rule 1 (no fm entry → CREATE)", () => {
  test("single parsed v2 card with no fm map → one CREATE", () => {
    const card = id("q-abcd");
    const plan = buildSyncPlan({
      cards: [card],
      computeHash: stubHash(),
      frontmatter: fm([]),
    });
    expect(plan.create).toEqual([{ card, hash: "newhash-q-abcd" }]);
    expect(plan.update).toEqual([]);
    expect(plan.delete).toEqual([]);
  });
});

describe("buildSyncPlan — v2 rule 2 (fm entry without nid → CREATE)", () => {
  test("fm entry has hash but no nid → still CREATE (never synced)", () => {
    const card = id("q-abcd");
    const plan = buildSyncPlan({
      cards: [card],
      computeHash: stubHash(),
      frontmatter: fm([{ blockId: "q-abcd", hash: "stalehsh" }]),
    });
    expect(plan.create).toEqual([{ card, hash: "newhash-q-abcd" }]);
    expect(plan.update).toEqual([]);
    expect(plan.delete).toEqual([]);
  });
});

describe("buildSyncPlan — v2 rule 3 (nid+hash match → no-op)", () => {
  test("fm has nid+hash matching computed hash → no plan entry", () => {
    const card = id("q-abcd");
    const compute = stubHash();
    const matchingHash = compute(card);
    const plan = buildSyncPlan({
      cards: [card],
      computeHash: compute,
      frontmatter: fm([{ blockId: "q-abcd", hash: matchingHash, nid: 111 }]),
    });
    expect(plan).toEqual({ create: [], delete: [], update: [] });
  });
});

describe("buildSyncPlan — v2 rule 4 (nid+hash differ → UPDATE)", () => {
  test("hashes differ → UPDATE with oldHash from fm, newHash computed", () => {
    const card = id("q-abcd");
    const plan = buildSyncPlan({
      cards: [card],
      computeHash: stubHash(),
      frontmatter: fm([{ blockId: "q-abcd", hash: "oldhash1", nid: 111 }]),
    });
    expect(plan.update).toEqual([
      { card, newHash: "newhash-q-abcd", nid: 111, oldHash: "oldhash1" },
    ]);
    expect(plan.create).toEqual([]);
    expect(plan.delete).toEqual([]);
  });
});

describe("buildSyncPlan — v2 rule 5 (nid only, no hash → UPDATE, oldHash sentinel)", () => {
  test("scalar-shorthand-style entry → UPDATE with oldHash = ''", () => {
    const card = id("q-abcd");
    const plan = buildSyncPlan({
      cards: [card],
      computeHash: stubHash(),
      frontmatter: fm([{ blockId: "q-abcd", nid: 222 }]),
    });
    expect(plan.update).toEqual([
      { card, newHash: "newhash-q-abcd", nid: 222, oldHash: "" },
    ]);
  });
});

describe("buildSyncPlan — v2 rule 6 (fm has nid, no parsed card → DELETE)", () => {
  test("fm entry q-xxxx with nid but card removed from note → DELETE", () => {
    const plan = buildSyncPlan({
      cards: [],
      computeHash: stubHash(),
      frontmatter: fm([{ blockId: "q-gone", hash: "old", nid: 333 }]),
    });
    expect(plan.delete).toEqual([{ blockId: "q-gone", nid: 333 }]);
  });
});

describe("buildSyncPlan — v2 rule 7 (q-xxxx without nid, no parsed card → SKIP)", () => {
  test("dangling local state, never synced → not in any set", () => {
    const plan = buildSyncPlan({
      cards: [],
      computeHash: stubHash(),
      frontmatter: fm([{ blockId: "q-gone", hash: "stale" }]),
    });
    expect(plan).toEqual({ create: [], delete: [], update: [] });
  });
});

describe("buildSyncPlan — v1 rule A (no fm entry → SKIP, opt-in)", () => {
  test("v1 anchor with no fm entry → no plan entry", () => {
    const card = id("1700000000001");
    const plan = buildSyncPlan({
      cards: [card],
      computeHash: stubHash(),
      frontmatter: fm([]),
    });
    expect(plan).toEqual({ create: [], delete: [], update: [] });
  });
});

describe("buildSyncPlan — v1 rule B (fm hash present)", () => {
  test("hashes match → no-op", () => {
    const card = id("1700000000001");
    const compute = stubHash();
    const matching = compute(card);
    const plan = buildSyncPlan({
      cards: [card],
      computeHash: compute,
      frontmatter: fm([{ blockId: "1700000000001", hash: matching }]),
    });
    expect(plan).toEqual({ create: [], delete: [], update: [] });
  });

  test("hashes differ → UPDATE with nid = parseInt(blockId)", () => {
    const card = id("1700000000001");
    const plan = buildSyncPlan({
      cards: [card],
      computeHash: stubHash(),
      frontmatter: fm([{ blockId: "1700000000001", hash: "oldhash" }]),
    });
    expect(plan.update).toEqual([
      {
        card,
        newHash: "newhash-1700000000001",
        nid: 1700000000001,
        oldHash: "oldhash",
      },
    ]);
  });

  test("a recovered v1 binding updates the stored replacement nid", () => {
    const card = id("1700000000001");
    const plan = buildSyncPlan({
      cards: [card],
      computeHash: stubHash(),
      frontmatter: fm([
        {
          blockId: "1700000000001",
          hash: "oldhash",
          nid: 1788507933645,
        },
      ]),
    });

    expect(plan.update).toEqual([
      {
        card,
        newHash: "newhash-1700000000001",
        nid: 1788507933645,
        oldHash: "oldhash",
      },
    ]);
  });
});

describe("buildSyncPlan — v1 rule C (numeric key, no parsed card → DELETE)", () => {
  test("DELETE with nid = parseInt(blockId)", () => {
    const plan = buildSyncPlan({
      cards: [],
      computeHash: stubHash(),
      frontmatter: fm([{ blockId: "1700000000002", hash: "old" }]),
    });
    expect(plan.delete).toEqual([
      { blockId: "1700000000002", nid: 1700000000002 },
    ]);
  });

  test("a recovered v1 binding deletes the stored replacement nid", () => {
    const plan = buildSyncPlan({
      cards: [],
      computeHash: stubHash(),
      frontmatter: fm([
        {
          blockId: "1700000000002",
          hash: "old",
          nid: 1788507933999,
        },
      ]),
    });

    expect(plan.delete).toEqual([
      { blockId: "1700000000002", nid: 1788507933999 },
    ]);
  });
});

describe("buildSyncPlan — mixed v1 + v2", () => {
  test("one of each rule type in a single note", () => {
    const v2Create = id("q-aaaa");
    const v2Update = id("q-bbbb");
    const v2Noop = id("q-cccc");
    const v1Update = id("1700000000010");
    const compute = stubHash();
    const noopHash = compute(v2Noop);

    const plan = buildSyncPlan({
      cards: [v2Create, v2Update, v2Noop, v1Update],
      computeHash: compute,
      frontmatter: fm([
        // for v2Update — differing hash
        { blockId: "q-bbbb", hash: "oldB", nid: 1001 },
        // for v2Noop — matching hash
        { blockId: "q-cccc", hash: noopHash, nid: 1002 },
        // for v1Update — differing hash
        { blockId: "1700000000010", hash: "oldV1" },
        // orphan v2 with nid → DELETE
        { blockId: "q-dead", hash: "x", nid: 9999 },
        // orphan v1 → DELETE
        { blockId: "1700000000099", hash: "y" },
        // orphan v2 without nid → SKIP
        { blockId: "q-skip", hash: "z" },
      ]),
    });

    expect(plan.create).toEqual([{ card: v2Create, hash: compute(v2Create) }]);
    expect(plan.update).toEqual([
      {
        card: v2Update,
        newHash: compute(v2Update),
        nid: 1001,
        oldHash: "oldB",
      },
      {
        card: v1Update,
        newHash: compute(v1Update),
        nid: 1700000000010,
        oldHash: "oldV1",
      },
    ]);
    expect(plan.delete).toEqual([
      { blockId: "q-dead", nid: 9999 },
      { blockId: "1700000000099", nid: 1700000000099 },
    ]);
  });
});

describe("buildSyncPlan — order stability", () => {
  test("create order matches input cards order", () => {
    const cards = [id("q-cccc"), id("q-aaaa"), id("q-bbbb")];
    const plan = buildSyncPlan({
      cards,
      computeHash: stubHash(),
      frontmatter: fm([]),
    });
    expect(plan.create.map((o) => o.card.blockId)).toEqual([
      "q-cccc",
      "q-aaaa",
      "q-bbbb",
    ]);
  });

  test("update order matches input cards order", () => {
    const cards = [id("q-cccc"), id("q-aaaa"), id("q-bbbb")];
    const plan = buildSyncPlan({
      cards,
      computeHash: stubHash(),
      frontmatter: fm([
        // intentionally out-of-order vs cards
        { blockId: "q-aaaa", hash: "old", nid: 1 },
        { blockId: "q-bbbb", hash: "old", nid: 2 },
        { blockId: "q-cccc", hash: "old", nid: 3 },
      ]),
    });
    expect(plan.update.map((o) => o.card.blockId)).toEqual([
      "q-cccc",
      "q-aaaa",
      "q-bbbb",
    ]);
  });

  test("delete order matches frontmatter entries order", () => {
    const plan = buildSyncPlan({
      cards: [],
      computeHash: stubHash(),
      frontmatter: fm([
        { blockId: "q-zzzz", hash: "x", nid: 1 },
        { blockId: "q-aaaa", hash: "y", nid: 2 },
        { blockId: "q-mmmm", hash: "z", nid: 3 },
      ]),
    });
    expect(plan.delete.map((o) => o.blockId)).toEqual([
      "q-zzzz",
      "q-aaaa",
      "q-mmmm",
    ]);
  });
});

describe("buildSyncPlan — idempotency", () => {
  test("two invocations on the same inputs produce equal plans", () => {
    const cards = [id("q-aaaa"), id("q-bbbb"), id("1700000000001")];
    const frontmatter = fm([
      { blockId: "q-bbbb", hash: "oldB", nid: 10 },
      { blockId: "1700000000001", hash: "oldV1" },
      { blockId: "q-orphan", hash: "x", nid: 99 },
    ]);
    const first = buildSyncPlan({ cards, computeHash: stubHash(), frontmatter });
    const second = buildSyncPlan({ cards, computeHash: stubHash(), frontmatter });
    expect(second).toEqual(first);
  });
});

describe("buildSyncPlan — computeHash injection", () => {
  test("computeHash is called once per parsed card", () => {
    const cards = [id("q-aaaa"), id("q-bbbb"), id("1700000000001")];
    const calls: string[] = [];
    const compute = (c: IdentifiedFlashcard): string => {
      calls.push(c.blockId);
      return `h-${c.blockId}`;
    };
    buildSyncPlan({
      cards,
      computeHash: compute,
      frontmatter: fm([]),
    });
    // Each parsed card is hashed exactly once.
    expect(calls.sort()).toEqual(["1700000000001", "q-aaaa", "q-bbbb"]);
  });

  test("injected hash result is used as newHash in CREATE", () => {
    const card = id("q-abcd");
    const plan = buildSyncPlan({
      cards: [card],
      computeHash: () => "INJECTED",
      frontmatter: fm([]),
    });
    expect(plan.create[0]?.hash).toBe("INJECTED");
  });

  test("injected hash result is used as newHash in UPDATE", () => {
    const card = id("q-abcd");
    const plan = buildSyncPlan({
      cards: [card],
      computeHash: () => "INJECTED",
      frontmatter: fm([{ blockId: "q-abcd", hash: "old", nid: 7 }]),
    });
    expect(plan.update[0]?.newHash).toBe("INJECTED");
    expect(plan.update[0]?.oldHash).toBe("old");
  });
});

// ===========================================================================
// WI-11 — cue-rephrase rebind pairing (spec §4.7).
//
// `SyncPlan` gains a `rebinds: PendingRebind[]` field. When, and only when, a
// note's plan contains EXACTLY ONE atomic orphan (a frontmatter entry with a
// `cue`, no matching parsed card, hence in `plan.delete`) and EXACTLY ONE
// atomic CREATE (a parsed card with `source.syntax === "atomic"`, hence in
// `plan.create`), buildSyncPlan additionally reports that pairing as a
// `PendingRebind { blockId, nid, newFront, deckName }` — `blockId`/`nid` from
// the orphan, `newFront`/`deckName` from the atomic CREATE's card. This is
// pure, additive metadata: `plan.create`/`plan.delete` are UNCHANGED by its
// presence — the application layer (`syncNote`) decides, based on a confirm
// seam, whether to act on it.
//
// Ambiguous counts (more than one orphan and/or more than one atomic create)
// and non-atomic orphans/creates must never pair — `rebinds` stays `[]`.
// ===========================================================================

function atomicId(
  blockId: string,
  overrides: Partial<Flashcard> = {},
): IdentifiedFlashcard {
  return id(blockId, {
    deckName: "Some Deck",
    ...overrides,
    source: { ...baseSource(), syntax: "atomic" },
  });
}

describe("buildSyncPlan — WI-11 rebind pairing (single atomic orphan + single atomic CREATE)", () => {
  test("pairs the lone atomic orphan with the lone atomic CREATE into plan.rebinds", () => {
    const newCard = atomicId("q-newc", { front: "New front text" });
    const frontmatter = fm([
      { blockId: "q-oldc", cue: "cue-old-hash", hash: "oldhash", nid: 1234567890123 },
    ]);
    const plan = buildSyncPlan({
      cards: [newCard],
      computeHash: stubHash(),
      frontmatter,
    });

    expect(plan.rebinds).toEqual([
      {
        blockId: "q-oldc",
        deckName: "Some Deck",
        newFront: "New front text",
        nid: 1234567890123,
      },
    ]);
  });

  test("plan.create and plan.delete are unaffected by the pairing (additive metadata only)", () => {
    const newCard = atomicId("q-newc", { front: "New front text" });
    const frontmatter = fm([
      { blockId: "q-oldc", cue: "cue-old-hash", hash: "oldhash", nid: 1234567890123 },
    ]);
    const plan = buildSyncPlan({
      cards: [newCard],
      computeHash: stubHash(),
      frontmatter,
    });

    expect(plan.create.map((o) => o.card.blockId)).toEqual(["q-newc"]);
    expect(plan.delete).toEqual([{ blockId: "q-oldc", nid: 1234567890123 }]);
  });
});

describe("buildSyncPlan — WI-11 rebind pairing: ambiguity never pairs", () => {
  test("two atomic orphans + one atomic CREATE → no pairing", () => {
    const newCard = atomicId("q-newc");
    const frontmatter = fm([
      { blockId: "q-orph1", cue: "cueA", hash: "h1", nid: 1111111111111 },
      { blockId: "q-orph2", cue: "cueB", hash: "h2", nid: 2222222222222 },
    ]);
    const plan = buildSyncPlan({
      cards: [newCard],
      computeHash: stubHash(),
      frontmatter,
    });

    expect(plan.rebinds).toEqual([]);
    expect(plan.delete).toHaveLength(2);
    expect(plan.create).toHaveLength(1);
  });

  test("one atomic orphan + two atomic CREATEs → no pairing", () => {
    const newCard1 = atomicId("q-newc1");
    const newCard2 = atomicId("q-newc2");
    const frontmatter = fm([
      { blockId: "q-orph1", cue: "cueA", hash: "h1", nid: 1111111111111 },
    ]);
    const plan = buildSyncPlan({
      cards: [newCard1, newCard2],
      computeHash: stubHash(),
      frontmatter,
    });

    expect(plan.rebinds).toEqual([]);
    expect(plan.delete).toHaveLength(1);
    expect(plan.create).toHaveLength(2);
  });
});

describe("buildSyncPlan — WI-11 rebind pairing: non-atomic participants never pair", () => {
  test("an anchored (non-atomic) orphan entry — no `cue` — never pairs, even 1:1 with an atomic CREATE", () => {
    const newCard = atomicId("q-newc");
    // No `cue` on this entry: it was written by an anchored (fenced/inline/
    // hashtag/cloze) card, not an atomic one.
    const frontmatter = fm([
      { blockId: "q-anchored", hash: "h1", nid: 1111111111111 },
    ]);
    const plan = buildSyncPlan({
      cards: [newCard],
      computeHash: stubHash(),
      frontmatter,
    });

    expect(plan.rebinds).toEqual([]);
    expect(plan.delete).toEqual([{ blockId: "q-anchored", nid: 1111111111111 }]);
    expect(plan.create).toHaveLength(1);
  });

  test("an atomic orphan 1:1 with a non-atomic (anchored) CREATE never pairs", () => {
    const anchoredCard = id("q-newanchor"); // baseSource() → syntax: "inline"
    const frontmatter = fm([
      { blockId: "q-oldc", cue: "cue-old-hash", hash: "oldhash", nid: 1234567890123 },
    ]);
    const plan = buildSyncPlan({
      cards: [anchoredCard],
      computeHash: stubHash(),
      frontmatter,
    });

    expect(plan.rebinds).toEqual([]);
    expect(plan.delete).toEqual([{ blockId: "q-oldc", nid: 1234567890123 }]);
    expect(plan.create).toHaveLength(1);
  });
});
