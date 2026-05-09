import type { Flashcard } from "../domain/card.js";

export interface SyncPlan {
  create: Flashcard[];
  delete: number[];
  update: Flashcard[];
}

export function createEmptySyncPlan(): SyncPlan {
  return {
    create: [],
    delete: [],
    update: [],
  };
}
