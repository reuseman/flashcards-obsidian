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

export interface SyncPlan {
  create: CreateOp[];
  delete: DeleteOp[];
  update: UpdateOp[];
}
