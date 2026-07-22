import type { IdentifiedFlashcard } from "../domain/card.js";
import type {
  FrontmatterCardEntry,
  ParsedCardFrontmatter,
} from "./parse-card-frontmatter.js";
import type { PendingRebind, SyncPlan } from "./sync-plan.js";

const V1_BLOCK_ID_RE = /^\d{13}$/;

export interface BuildSyncPlanInput {
  cards: IdentifiedFlashcard[];
  computeHash: (card: IdentifiedFlashcard) => string;
  frontmatter: ParsedCardFrontmatter;
}

/**
 * Pure diff between parsed cards and the frontmatter sync map.
 *
 * Rules (see `tests/core/sync/build-sync-plan.test.ts` for the spec):
 *   v2 (q-xxxx blockIds):
 *     1. no fm entry            → CREATE
 *     2. fm entry, no nid       → CREATE
 *     3. fm nid+hash, match     → no-op
 *     4. fm nid+hash, differ    → UPDATE
 *     5. fm nid, no hash        → UPDATE (oldHash = "")
 *     6. fm entry has nid, card gone → DELETE
 *     7. fm entry no nid, card gone  → SKIP
 *
 *   v1 (13-digit numeric blockIds):
 *     A. no fm entry            → SKIP (opt-in migration)
 *     B. fm hash present, differ → UPDATE (nid = parseInt(blockId))
 *        fm hash match           → no-op
 *     C. fm entry, card gone    → DELETE (nid = parseInt(blockId))
 */
export function buildSyncPlan(input: BuildSyncPlanInput): SyncPlan {
  const { cards, computeHash, frontmatter } = input;

  const fmByBlockId = new Map<string, FrontmatterCardEntry>();
  for (const entry of frontmatter.entries) {
    fmByBlockId.set(entry.blockId, entry);
  }
  const parsedBlockIds = new Set(cards.map((c) => c.blockId));

  const create: SyncPlan["create"] = [];
  const update: SyncPlan["update"] = [];
  const del: SyncPlan["delete"] = [];

  // Walk parsed cards in input order — drives create/update.
  for (const card of cards) {
    const newHash = computeHash(card);
    const fm = fmByBlockId.get(card.blockId);
    const isV1 = V1_BLOCK_ID_RE.test(card.blockId);

    if (isV1) {
      // Rule A / B.
      if (!fm) continue;
      if (fm.hash === undefined) continue; // defensive — v1 entries always carry a hash
      if (fm.hash === newHash) continue;
      update.push({
        card,
        newHash,
        nid: Number.parseInt(card.blockId, 10),
        oldHash: fm.hash,
      });
      continue;
    }

    // v2 anchor.
    if (!fm || fm.nid === undefined) {
      // Rule 1, Rule 2.
      create.push({ card, hash: newHash });
      continue;
    }
    if (fm.hash === undefined) {
      // Rule 5.
      update.push({ card, newHash, nid: fm.nid, oldHash: "" });
      continue;
    }
    if (fm.hash === newHash) continue; // Rule 3
    // Rule 4.
    update.push({ card, newHash, nid: fm.nid, oldHash: fm.hash });
  }

  // Walk frontmatter entries in their order — drives deletes for orphans.
  for (const entry of frontmatter.entries) {
    if (parsedBlockIds.has(entry.blockId)) continue;
    const isV1 = V1_BLOCK_ID_RE.test(entry.blockId);
    if (isV1) {
      // Rule C.
      del.push({
        blockId: entry.blockId,
        nid: Number.parseInt(entry.blockId, 10),
      });
      continue;
    }
    // v2: Rule 6 vs Rule 7.
    if (entry.nid === undefined) continue;
    del.push({ blockId: entry.blockId, nid: entry.nid });
  }

  // Cue-rephrase rebind pairing (spec §4.7, WI-11). "Atomic orphan" = a
  // DELETE whose frontmatter source entry carries `cue` (only atomic cards
  // ever get `cue` written). "Atomic CREATE" = a CREATE whose card came from
  // the atomic syntax. Exactly one of each ⇒ pair; any other count ⇒ no
  // pairing (never fuzzy-matched). Additive metadata only — `create`/`delete`
  // above are untouched by this.
  const atomicOrphans = del.filter(
    (d) => fmByBlockId.get(d.blockId)?.cue !== undefined,
  );
  const atomicCreates = create.filter((c) => c.card.source.syntax === "atomic");

  let rebinds: PendingRebind[] | undefined;
  if (atomicOrphans.length > 0 || atomicCreates.length > 0) {
    if (atomicOrphans.length === 1 && atomicCreates.length === 1) {
      const orphan = atomicOrphans[0]!;
      const createOp = atomicCreates[0]!;
      rebinds = [
        {
          blockId: orphan.blockId,
          deckName: createOp.card.deckName ?? "",
          newFront: createOp.card.front,
          nid: orphan.nid,
        },
      ];
    } else {
      rebinds = [];
    }
  }

  return {
    create,
    delete: del,
    ...(rebinds !== undefined ? { rebinds } : {}),
    update,
  };
}
