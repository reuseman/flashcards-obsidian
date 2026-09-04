import { createHash } from "node:crypto";

import {
  computeCardHash,
  computeCueHash,
  computeRenderedFieldsHash,
} from "../../../src/core/edits/card-hash.js";
import type { Flashcard } from "../../../src/core/domain/card.js";

/**
 * Phase 4 slice 2 — content hash for `flashcards:` frontmatter map.
 *
 * Module under test (not yet implemented):
 *   src/core/edits/card-hash.ts
 *
 * Spec (locked by human in the slice brief):
 *   - Algorithm: SHA-256.
 *   - Input bytes: `kind + "\n" + context + "\n" + front + "\n" + back`
 *     (UTF-8). Absent context is empty; front == card.front, back ==
 *     card.answer, and kind is the literal CardKind string.
 *   - Output: take the leading 40 bits (5 bytes), encode as 8 base32 chars
 *     using the Crockford-style alphabet `abcdefghijkmnpqrstuvwxyz23456789`
 *     (no `l, o, 0, 1`), MSB-first, lowercase.
 *
 * Reference hashes were computed offline via Node `crypto`:
 *   computeCardHash({kind:"basic",   context:"", front:"hello", back:"world"}) === "w3xt27aj"
 *   computeCardHash({kind:"cloze",   context:"", front:"The ==heart== pumps.", back:""}) === "vtta9m9d"
 *   computeCardHash({kind:"basic",   context:"", front:"Q", back:"A"}) === "39vpcg6v"
 *   computeCardHash({kind:"basic",   context:"", front:"Q", back:"B"}) === "q3tghrv8"
 *   computeCardHash({kind:"reversed",context:"", front:"Q", back:"A"}) === "wtr72t85"
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
    ).toBe("w3xt27aj");
  });

  test("cloze / front-only / empty back", () => {
    expect(
      computeCardHash(card({ kind: "cloze", front: "The ==heart== pumps.", answer: "" })),
    ).toBe("vtta9m9d");
  });

  test("basic / Q / A", () => {
    expect(computeCardHash(card({ kind: "basic", front: "Q", answer: "A" }))).toBe("39vpcg6v");
  });

  test("reversed / Q / A", () => {
    expect(
      computeCardHash(card({ kind: "reversed", front: "Q", answer: "A" })),
    ).toBe("wtr72t85");
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
    expect(a).toBe("39vpcg6v");
    expect(b).toBe("q3tghrv8");
  });

  test("different kind → different hash", () => {
    const a = computeCardHash(card({ kind: "basic", front: "Q", answer: "A" }));
    const b = computeCardHash(card({ kind: "reversed", front: "Q", answer: "A" }));
    expect(a).not.toBe(b);
  });

  test("different context → different hash", () => {
    const a = computeCardHash(card({ context: "Course", front: "Q" }));
    const b = computeCardHash(card({ context: "Topic", front: "Q" }));
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

describe("computeRenderedFieldsHash", () => {
  test("is stable when Anki returns fields in a different key order", () => {
    expect(
      computeRenderedFieldsHash({ Front: "Q", Back: "A", Source: "S" }),
    ).toBe(
      computeRenderedFieldsHash({ Source: "S", Back: "A", Front: "Q" }),
    );
  });

  test("changes when a rendered field is edited", () => {
    expect(
      computeRenderedFieldsHash({ Front: "Q", Back: "A", Source: "S" }),
    ).not.toBe(
      computeRenderedFieldsHash({ Front: "manual edit", Back: "A", Source: "S" }),
    );
  });
});

/**
 * WI-9 — cue hash (design §4.4).
 *
 * `cue` = first 8 base32 chars of sha256 of `kind + "\n" + front` (no
 * `answer`/back component — this is what makes it stable across the
 * "editing the first paragraph only" case). Kind-qualified so a `title` and
 * a `reversed` item sharing the same front text get distinct cue values.
 *
 * `referenceHash` below is an independent re-implementation of the exact
 * bit-extraction algorithm documented as locked in `card-hash.ts`, applied
 * to different input bytes (`kind\nfront` instead of `kind\nfront\nback`).
 * It intentionally does NOT import anything from src — the point is to
 * cross-check `computeCueHash`'s output against the spec, not against
 * whatever `computeCardHash` happens to do internally.
 */
const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
function referenceHash(input: string): string {
  const digest = createHash("sha256").update(input, "utf8").digest();
  let out = "";
  for (let i = 0; i < 8; i++) {
    const bitOffset = i * 5;
    const byteIndex = bitOffset >> 3;
    const bitInByte = bitOffset & 7;
    const hi = digest[byteIndex] ?? 0;
    const lo = digest[byteIndex + 1] ?? 0;
    const window = (hi << 8) | lo;
    const shift = 16 - bitInByte - 5;
    const value = (window >> shift) & 0x1f;
    out += ALPHABET[value];
  }
  return out;
}

describe("computeCueHash — WI-9 cue field", () => {
  test("matches sha256(kind + \\n + front) reference, first 8 base32 chars", () => {
    const expected = referenceHash("basic\nWhat guarantees delivery?");
    expect(computeCueHash("basic", "What guarantees delivery?")).toBe(expected);
  });

  test("shape: 8 chars from the locked alphabet", () => {
    const HASH_RE = /^[abcdefghijkmnpqrstuvwxyz23456789]{8}$/;
    expect(computeCueHash("basic", "Some front text")).toMatch(HASH_RE);
  });

  test("determinism: same kind+front -> same cue", () => {
    expect(computeCueHash("basic", "Stable front")).toBe(
      computeCueHash("basic", "Stable front"),
    );
  });

  test("kind-qualified: `title` (basic) and `reversed` sharing the same front text get DISTINCT cues", () => {
    const titleCue = computeCueHash("basic", "TCP basics");
    const reversedCue = computeCueHash("reversed", "TCP basics");
    expect(titleCue).not.toBe(reversedCue);
  });

  test("different front text -> different cue (same kind)", () => {
    const a = computeCueHash("basic", "Question A");
    const b = computeCueHash("basic", "Question B");
    expect(a).not.toBe(b);
  });
});
