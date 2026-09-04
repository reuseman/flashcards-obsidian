import type { FlashcardsSettings } from "../../core/config/settings.js";
import type { IdentifiedFlashcard } from "../../core/domain/card.js";
import type { Logger } from "../../core/logging/logger.js";
import type { PendingDeletion, SyncPlan } from "../../core/sync/sync-plan.js";

interface ApplyDeleteSafetyInput {
  cards: IdentifiedFlashcard[];
  confirm?: (pending: PendingDeletion[]) => Promise<boolean>;
  logger: Logger;
  notePath: string;
  plan: SyncPlan;
  settings: FlashcardsSettings;
}

/** Require explicit approval before retaining deletion operations. */
export async function applyDeleteSafety(
  input: ApplyDeleteSafetyInput,
): Promise<void> {
  if (input.plan.delete.length === 0) return;

  const deckName =
    input.cards.find((card) => card.deckName !== undefined)?.deckName ??
    input.settings.defaultDeck;
  const pending = input.plan.delete.map<PendingDeletion>((operation) => ({
    blockId: operation.blockId,
    deckName,
    nid: operation.nid,
  }));

  for (const deletion of pending) {
    input.logger.info("syncNote pending deletion", {
      notePath: input.notePath,
      blockId: deletion.blockId,
      nid: deletion.nid,
      deckName: deletion.deckName,
    });
  }

  if (!input.settings.confirmBeforeDelete) return;
  const confirmed = input.confirm ? await input.confirm(pending) : false;
  if (!confirmed) input.plan.delete = [];
}
