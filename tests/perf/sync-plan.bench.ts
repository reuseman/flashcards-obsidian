import { bench } from "vitest";

import { buildSyncPlan } from "../../src/core/sync/build-sync-plan.js";
import type { IdentifiedFlashcard } from "../../src/core/domain/card.js";
import type {
  FrontmatterCardEntry,
  ParsedCardFrontmatter,
} from "../../src/core/sync/parse-card-frontmatter.js";

/**
 * Synthetic 1000-card scenario exercising every code path in buildSyncPlan:
 *   - 800 cards that match frontmatter (no-op)
 *   -  80 cards with stale hash (UPDATE)
 *   -  60 cards with no frontmatter entry (CREATE)
 *   -  60 orphan frontmatter entries with nid (DELETE)
 *
 * Deterministic construction so the bench identity stays stable across runs.
 */

const TOTAL_PARSED = 940; // 800 + 80 + 60
const STALE_START = 800;
const NEW_START = 880;
const ORPHAN_COUNT = 60;

const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

function blockIdFor(n: number): string {
  // Deterministic 4-char id keyed by n; matches V2_KEY_RE shape.
  const a = ALPHABET[n % ALPHABET.length]!;
  const b = ALPHABET[(n >>> 5) % ALPHABET.length]!;
  const c = ALPHABET[(n >>> 10) % ALPHABET.length]!;
  const d = ALPHABET[(n >>> 15) % ALPHABET.length]!;
  return `q-${a}${b}${c}${d}`;
}

function makeCard(n: number): IdentifiedFlashcard {
  return {
    answer: `Answer ${n}`,
    blockId: blockIdFor(n),
    front: `Question ${n}?`,
    kind: "basic",
    source: { endOffset: 0, line: n + 1, startOffset: 0, syntax: "inline" },
    tags: [],
  };
}

const cards: IdentifiedFlashcard[] = [];
for (let i = 0; i < TOTAL_PARSED; i++) cards.push(makeCard(i));

const fmEntries: FrontmatterCardEntry[] = [];
// 800 matching + 80 stale: frontmatter knows them, but stale ones carry "stale-hash".
for (let i = 0; i < NEW_START; i++) {
  fmEntries.push({
    blockId: blockIdFor(i),
    hash: i < STALE_START ? `hash-${i}` : "stale-hash",
    nid: 1_000_000 + i,
  });
}
// 60 orphans: frontmatter has them but the parsed card list does not.
for (let i = 0; i < ORPHAN_COUNT; i++) {
  const n = 10_000 + i; // disjoint from any parsed blockId space
  fmEntries.push({
    blockId: blockIdFor(n),
    hash: `orphan-${i}`,
    nid: 2_000_000 + i,
  });
}

const frontmatter: ParsedCardFrontmatter = {
  entries: fmEntries,
  skippedLineCount: 0,
};

// Precomputed hash map so `computeHash` is O(1) per call — the bench measures
// buildSyncPlan, not our test harness.
const hashByBlockId = new Map<string, string>();
for (let i = 0; i < STALE_START; i++) {
  hashByBlockId.set(blockIdFor(i), `hash-${i}`);
}

const computeHash = (card: IdentifiedFlashcard): string =>
  hashByBlockId.get(card.blockId) ?? `hash-fresh-${card.blockId}`;

bench(
  "build-sync-plan-1000",
  () => {
    buildSyncPlan({ cards, computeHash, frontmatter });
  },
  { iterations: 50, warmupIterations: 5, time: 1000 },
);
