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

export interface SyncPlan {
  create: CreateOp[];
  delete: DeleteOp[];
  update: UpdateOp[];
}
