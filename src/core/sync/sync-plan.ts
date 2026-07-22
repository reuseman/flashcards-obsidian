import type { IdentifiedFlashcard } from "../domain/card.js";

export interface CreateOp {
  card: IdentifiedFlashcard;
  hash: string;
}

export interface UpdateOp {
  card: IdentifiedFlashcard;
  newHash: string;
  nid: number;
  oldHash: string;
}

export interface DeleteOp {
  blockId: string;
  nid: number;
}

/**
 * A delete the core is about to enact, surfaced to the confirmer seam.
 * Front text is intentionally absent: at delete time the card is gone from the
 * note and the frontmatter map stores only `{ nid, hash }` (spec §4.5).
 */
export interface PendingDeletion {
  blockId: string;
  deckName: string;
  nid: number;
}

/**
 * A candidate cue-rephrase pairing (spec §4.7, WI-11): a single atomic orphan
 * paired 1:1 with a single atomic CREATE within the same note. Additive
 * metadata only — `plan.create`/`plan.delete` are unaffected by its presence.
 * The application layer decides, via a confirm seam, whether to collapse the
 * pair into a scheduling-preserving UPDATE.
 */
export interface PendingRebind {
  blockId: string;
  deckName: string;
  newFront: string;
  nid: number;
}

export interface SyncPlan {
  create: CreateOp[];
  delete: DeleteOp[];
  // Optional: omitted when there are no atomic orphans/creates to consider at
  // all (keeps callers that predate WI-11 comparing exact plan literals
  // unaffected); present (possibly `[]`) once pairing candidates exist.
  rebinds?: PendingRebind[];
  update: UpdateOp[];
}
