import { computeCardHash } from "../../../src/core/edits/card-hash.js";
import type { Flashcard } from "../../../src/core/domain/card.js";

/**
 * Phase 4 slice 2 — content hash for `flashcards:` frontmatter map.
 *
 * Module under test (not yet implemented):
 *   src/core/edits/card-hash.ts
 *
 * Spec (locked by human in the slice brief):
 *   - Algorithm: SHA-256.
 *   - Input bytes: `kind + "\n" + front + "\n" + back` (UTF-8). Front == card.front,
 *     back == card.answer (domain naming), kind is the literal CardKind string.
 *   - Output: take the leading 40 bits (5 bytes), encode as 8 base32 chars
 *     using the Crockford-style alphabet `abcdefghijkmnpqrstuvwxyz23456789`
 *     (no `l, o, 0, 1`), MSB-first, lowercase.
 *
 * Reference hashes were computed offline via Node `crypto`:
 *   computeCardHash({kind:"basic",   front:"hello", back:"world"}) === "fwp6tmp9"
 *   computeCardHash({kind:"cloze",   front:"The ==heart== pumps.", back:""}) === "edwnvhju"
 *   computeCardHash({kind:"basic",   front:"Q", back:"A"}) === "ibsf6y7q"
 *   computeCardHash({kind:"basic",   front:"Q", back:"B"}) === "u53u7d6t"
 *   computeCardHash({kind:"reversed",front:"Q", back:"A"}) === "5nhk8xvx"
 */

const HASH_RE = /^[abcdefghijkmnpqrstuvwxyz23456789]{8}$/;

function card(overrides: Partial<Flashcard> = {}): Flashcard {
  return {
    answer: "A",
    front: "Q",
    kind: "basic",
    source: { endOffset: 0, line: 1, startOffset: 0, syntax: "inline" },
    tags: [],
    ...overrides,
  };
}

describe("computeCardHash — shape", () => {
  test("returns 8 chars from the locked alphabet", () => {
    expect(computeCardHash(card())).toMatch(HASH_RE);
  });

  test("never contains ambiguous chars `l`, `o`, `0`, `1`", () => {
    // Probe a handful of inputs to make accidental alphabet drift cheap to catch.
    const inputs: Flashcard[] = [
      card({ front: "a", answer: "b" }),
      card({ front: "longer text here", answer: "another answer" }),
      card({ kind: "cloze", front: "x ==y== z", answer: "" }),
      card({ kind: "reversed", front: "front", answer: "back" }),
      card({ front: "üñïçødé", answer: "💡" }),
    ];
    for (const c of inputs) {
      const h = computeCardHash(c);
      expect(h).toMatch(HASH_RE);
      expect(h).not.toMatch(/[lo01]/);
    }
  });
});

describe("computeCardHash — known vectors", () => {
  // Pin algorithm + alphabet. If any of these change, the on-disk hashes
  // already written by users become meaningless — that's a breaking change.
  test("basic / hello / world", () => {
    expect(
      computeCardHash(card({ kind: "basic", front: "hello", answer: "world" })),
    ).toBe("fwp6tmp9");
  });

  test("cloze / front-only / empty back", () => {
    expect(
      computeCardHash(card({ kind: "cloze", front: "The ==heart== pumps.", answer: "" })),
    ).toBe("edwnvhju");
  });

  test("basic / Q / A", () => {
    expect(computeCardHash(card({ kind: "basic", front: "Q", answer: "A" }))).toBe("ibsf6y7q");
  });

  test("reversed / Q / A", () => {
    expect(
      computeCardHash(card({ kind: "reversed", front: "Q", answer: "A" })),
    ).toBe("5nhk8xvx");
  });
});

describe("computeCardHash — sensitivity", () => {
  test("determinism: same input → same hash", () => {
    const c = card({ front: "stable", answer: "stable" });
    expect(computeCardHash(c)).toBe(computeCardHash(c));
  });

  test("different front → different hash", () => {
    const a = computeCardHash(card({ front: "Q", answer: "A" }));
    const b = computeCardHash(card({ front: "Q!", answer: "A" }));
    expect(a).not.toBe(b);
  });

  test("different back → different hash", () => {
    const a = computeCardHash(card({ front: "Q", answer: "A" }));
    const b = computeCardHash(card({ front: "Q", answer: "B" }));
    expect(a).not.toBe(b);
    // Cross-check against the locked vector.
    expect(a).toBe("ibsf6y7q");
    expect(b).toBe("u53u7d6t");
  });

  test("different kind → different hash", () => {
    const a = computeCardHash(card({ kind: "basic", front: "Q", answer: "A" }));
    const b = computeCardHash(card({ kind: "reversed", front: "Q", answer: "A" }));
    expect(a).not.toBe(b);
  });

  test("tags are NOT included in the hash", () => {
    const a = computeCardHash(card({ front: "Q", answer: "A", tags: [] }));
    const b = computeCardHash(card({ front: "Q", answer: "A", tags: ["alpha", "beta"] }));
    expect(a).toBe(b);
  });

  test("deckName is NOT included in the hash", () => {
    const a = computeCardHash(card({ front: "Q", answer: "A" }));
    const b = computeCardHash(card({ front: "Q", answer: "A", deckName: "Some::Deck" }));
    expect(a).toBe(b);
  });

  test("source positions are NOT included in the hash", () => {
    const a = computeCardHash(card({
      front: "Q",
      answer: "A",
      source: { endOffset: 0, line: 1, startOffset: 0, syntax: "inline" },
    }));
    const b = computeCardHash(card({
      front: "Q",
      answer: "A",
      source: { endOffset: 9999, line: 42, startOffset: 1234, syntax: "fenced" },
    }));
    expect(a).toBe(b);
  });
});
