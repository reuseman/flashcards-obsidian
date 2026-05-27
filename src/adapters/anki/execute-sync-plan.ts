import type { AnkiConnectClient } from "./anki-connect-client.js";
import {
  ANKI_MODEL_BASIC,
  ANKI_MODEL_CLOZE,
  ANKI_MODEL_REVERSED,
  getAnkiModelSpecs,
  renderCardForAnki,
} from "./render-card.js";
import type {
  CreateOp,
  DeleteOp,
  SyncPlan,
  UpdateOp,
} from "../../core/sync/sync-plan.js";
import type { IdentifiedFlashcard } from "../../core/domain/card.js";
import { NoopLogger, type Logger } from "../../core/logging/logger.js";

export interface CreateOpResult {
  op: CreateOp;
  status: "ok" | "failed";
  nid?: number;
  error?: string;
}

export interface UpdateOpResult {
  op: UpdateOp;
  status: "ok" | "failed";
  error?: string;
}

export interface DeleteOpResult {
  op: DeleteOp;
  status: "ok" | "failed";
  error?: string;
}

export interface ExecuteSyncPlanResult {
  creates: CreateOpResult[];
  updates: UpdateOpResult[];
  deletes: DeleteOpResult[];
}

export interface ExecuteSyncPlanInput {
  client: AnkiConnectClient;
  logger?: Logger;
  notePath: string;
  plan: SyncPlan;
  vaultName: string;
}

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
) {
  return renderCardForAnki(card, {
    deckName: card.deckName ?? "",
    notePath,
    tags: card.tags,
    vaultName,
  });
}

export async function executeSyncPlan(
  input: ExecuteSyncPlanInput,
): Promise<ExecuteSyncPlanResult> {
  const { client, notePath, plan, vaultName } = input;
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

  // 3. Bootstrap decks (only if there are CREATE ops).
  if (plan.create.length > 0) {
    const existingDecks = await client.deckNames();
    const existingDeckSet = new Set(existingDecks);
    const seen = new Set<string>();
    for (const op of plan.create) {
      const deck = op.card.deckName as string;
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
      const rendered = renderFor(op.card, notePath, vaultName);
      const nid = await client.addNote({
        deckName: rendered.deckName,
        modelName: rendered.modelName,
        fields: rendered.fields as unknown as Record<string, string>,
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
      const rendered = renderFor(op.card, notePath, vaultName);
      await client.updateNoteFields(
        op.nid,
        rendered.fields as unknown as Record<string, string>,
      );
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
