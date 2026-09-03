import type { ExecuteSyncPlanInput } from "../ports.js";
import {
  ANKI_MODEL_BASIC,
  ANKI_MODEL_CLOZE,
  ANKI_MODEL_REVERSED,
  getAnkiModelSpecs,
  renderCardForAnki,
} from "../../core/render/render-card.js";
import type { ExecuteSyncPlanResult } from "../../core/sync/sync-execution.js";
import type { IdentifiedFlashcard } from "../../core/domain/card.js";
import { NoopLogger, type Logger } from "../../core/logging/logger.js";

const REQUIRED_MODELS = [
  ANKI_MODEL_BASIC,
  ANKI_MODEL_REVERSED,
  ANKI_MODEL_CLOZE,
];

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function renderFor(
  card: IdentifiedFlashcard,
  notePath: string,
  vaultName: string,
  resolveLink: ((target: string, sourcePath: string) => string | null) | undefined,
) {
  return renderCardForAnki(card, {
    deckName: card.deckName ?? "",
    notePath,
    tags: card.tags,
    vaultName,
    ...(resolveLink ? { resolveLink } : {}),
  });
}

function crossesClozeBoundary(fromModel: string, toModel: string): boolean {
  return (fromModel === ANKI_MODEL_CLOZE) !== (toModel === ANKI_MODEL_CLOZE);
}

export async function executeSyncPlan(
  input: ExecuteSyncPlanInput,
): Promise<ExecuteSyncPlanResult> {
  const { client, notePath, plan, resolveLink, vaultName } = input;
  const logger: Logger = input.logger ?? new NoopLogger();

  logger.debug("executeSyncPlan start", {
    notePath,
    createCount: plan.create.length,
    updateCount: plan.update.length,
    deleteCount: plan.delete.length,
  });

  // 1. Validate CREATE ops have deckName before any network call.
  for (const op of plan.create) {
    if (op.card.deckName === undefined) {
      throw new Error(
        `Card has no resolved deckName: ${op.card.blockId}`,
      );
    }
  }

  // 2. Bootstrap models — create-if-missing, otherwise extend-in-place.
  // Anki model names are case-insensitive for uniqueness; we use v1's lowercase
  // names so a profile carrying v1 models gets upgraded rather than duplicated.
  // Upgrade path: add the `Source` field if absent, then rewrite card templates
  // so `{{Source}}` actually renders. CSS is left alone (may be user-customized)
  // — CSS migration is a separate pipeline step (see backlog).
  const existingModels = await client.modelNames();
  const existingModelSet = new Set(existingModels);
  const specs = getAnkiModelSpecs();
  for (const name of REQUIRED_MODELS) {
    const spec = specs.find((s) => s.modelName === name);
    if (spec === undefined) continue;
    if (!existingModelSet.has(name)) {
      logger.info("bootstrap: creating missing model", { model: name });
      await client.createModel(spec);
      continue;
    }
    const fields = await client.modelFieldNames(name);
    if (!fields.includes("Source")) {
      logger.info("bootstrap: extending v1 model with Source field", {
        model: name,
        existingFields: fields,
      });
      await client.modelFieldAdd(name, "Source", fields.length);
      const templates: Record<string, { Front: string; Back: string }> = {};
      for (const tpl of spec.cardTemplates) {
        const tplName = tpl.Name ?? "Card 1";
        templates[tplName] = { Front: tpl.Front, Back: tpl.Back };
      }
      await client.updateModelTemplates(name, templates);
    } else {
      logger.debug("bootstrap: model already v2-shaped", { model: name });
    }
  }

  // 3. Bootstrap decks needed by CREATEs, confirmed recreations, and source-
  // owned deck moves.
  const updatesNeedingDeck = plan.update.filter((op) => {
    if (op.recreate) return true;
    return op.existing?.cards.some(
      (card) => card.deckName !== op.card.deckName,
    ) === true;
  });
  if (plan.create.length > 0 || updatesNeedingDeck.length > 0) {
    const existingDecks = await client.deckNames();
    const existingDeckSet = new Set(existingDecks);
    const seen = new Set<string>();
    const cardsNeedingDeck = [
      ...plan.create.map((op) => op.card),
      ...updatesNeedingDeck.map((op) => op.card),
    ];
    for (const card of cardsNeedingDeck) {
      const deck = card.deckName;
      if (deck === undefined) {
        throw new Error(`Card has no resolved deckName: ${card.blockId}`);
      }
      if (seen.has(deck)) continue;
      seen.add(deck);
      if (!existingDeckSet.has(deck)) {
        await client.createDeck(deck);
      }
    }
  }

  const result: ExecuteSyncPlanResult = {
    creates: [],
    updates: [],
    deletes: [],
  };

  // 4. CREATE ops.
  for (const op of plan.create) {
    try {
      const rendered = renderFor(op.card, notePath, vaultName, resolveLink);
      const nid = await client.addNote({
        deckName: rendered.deckName,
        modelName: rendered.modelName,
        fields: rendered.fields,
        tags: rendered.tags,
      });
      // AnkiConnect raises an error string on duplicates rather than returning
      // null; the throw is caught below. A defensive null check is retained
      // because the type permits it, but is not expected at runtime.
      if (nid === null) {
        logger.warn("CREATE failed: addNote returned null", { blockId: op.card.blockId });
        result.creates.push({ op, status: "failed", error: "addNote returned null" });
      } else {
        logger.debug("CREATE ok", { blockId: op.card.blockId, nid });
        result.creates.push({ op, status: "ok", nid });
      }
    } catch (e) {
      const msg = errorMessage(e);
      logger.warn("CREATE failed", { blockId: op.card.blockId, error: msg });
      result.creates.push({ op, status: "failed", error: msg });
    }
  }

  // 5. UPDATE ops.
  for (const op of plan.update) {
    try {
      const rendered = renderFor(op.card, notePath, vaultName, resolveLink);
      const existing = op.existing;

      if (op.recreate) {
        const replacementNid = await client.addNote({
          deckName: rendered.deckName,
          modelName: rendered.modelName,
          fields: rendered.fields,
          // Tag ownership is intentionally undecided. Recreation therefore
          // preserves the live Anki tags exactly instead of treating source
          // tags as authoritative.
          tags: existing?.tags ?? rendered.tags,
        });
        if (replacementNid === null) {
          throw new Error("addNote returned null");
        }
        try {
          await client.deleteNotes([op.nid]);
        } catch (deleteError) {
          // Keep the old note authoritative when cleanup fails. Roll back the
          // newly-created replacement so a retry does not accumulate orphans.
          try {
            await client.deleteNotes([replacementNid]);
          } catch (rollbackError) {
            throw new Error(
              `${errorMessage(deleteError)}; replacement rollback failed: ${errorMessage(rollbackError)}`,
            );
          }
          throw deleteError;
        }
        logger.debug("UPDATE recreated", {
          blockId: op.card.blockId,
          nid: op.nid,
          replacementNid,
        });
        result.updates.push({ op, status: "ok", nid: replacementNid });
        continue;
      }

      const modelMismatch =
        existing !== undefined && existing.modelName !== rendered.modelName;
      if (
        modelMismatch &&
        crossesClozeBoundary(existing.modelName, rendered.modelName)
      ) {
        throw new Error("Cloze model changes require confirmed recreation");
      }

      if (modelMismatch) {
        await client.updateNoteModel(
          op.nid,
          rendered.modelName,
          rendered.fields,
          existing.tags,
        );
      } else if (op.oldHash !== op.newHash) {
        await client.updateNoteFields(op.nid, rendered.fields);
      }

      const deckMismatch = existing?.cards.some(
        (card) => card.deckName !== rendered.deckName,
      ) === true;
      if (deckMismatch) {
        let cardIds = existing.cards.map((card) => card.cardId);
        // Model conversion can add or remove templates/cards. Refresh ids so
        // every surviving/generated card moves together.
        if (modelMismatch) {
          const [refreshed] = await client.notesInfo([op.nid]);
          cardIds = (refreshed?.cards ?? []).filter(
            (cardId): cardId is number => typeof cardId === "number",
          );
        }
        if (cardIds.length > 0) {
          await client.changeDeck(cardIds, rendered.deckName);
        }
      }
      logger.debug("UPDATE ok", { blockId: op.card.blockId, nid: op.nid });
      result.updates.push({ op, status: "ok" });
    } catch (e) {
      const msg = errorMessage(e);
      logger.warn("UPDATE failed", { blockId: op.card.blockId, nid: op.nid, error: msg });
      result.updates.push({ op, status: "failed", error: msg });
    }
  }

  // 6. DELETE ops (one-by-one).
  for (const op of plan.delete) {
    try {
      await client.deleteNotes([op.nid]);
      logger.debug("DELETE ok", { blockId: op.blockId, nid: op.nid });
      result.deletes.push({ op, status: "ok" });
    } catch (e) {
      const msg = errorMessage(e);
      logger.warn("DELETE failed", { blockId: op.blockId, nid: op.nid, error: msg });
      result.deletes.push({ op, status: "failed", error: msg });
    }
  }

  logger.debug("executeSyncPlan end", {
    notePath,
    okCreates: result.creates.filter((c) => c.status === "ok").length,
    failedCreates: result.creates.filter((c) => c.status === "failed").length,
    okUpdates: result.updates.filter((u) => u.status === "ok").length,
    failedUpdates: result.updates.filter((u) => u.status === "failed").length,
    okDeletes: result.deletes.filter((d) => d.status === "ok").length,
    failedDeletes: result.deletes.filter((d) => d.status === "failed").length,
  });

  return result;
}
