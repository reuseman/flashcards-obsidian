import type { AnkiGateway } from "../ports.js";
import {
  computeCardHash,
  computeRenderedFieldsHash,
} from "../../core/edits/card-hash.js";
import type { IdentifiedFlashcard } from "../../core/domain/card.js";
import {
  ANKI_MODEL_BASIC,
  ANKI_MODEL_CLOZE,
  ANKI_MODEL_REMINDER,
  ANKI_MODEL_REVERSED,
} from "../../core/render/render-card.js";
import type { ParsedCardFrontmatter } from "../../core/sync/parse-card-frontmatter.js";
import type {
  ExistingAnkiCard,
  PendingKindRecreation,
  SyncPlan,
  UpdateOp,
} from "../../core/sync/sync-plan.js";
import {
  desiredAnkiTags,
  sameTagSet,
} from "../../core/sync/tag-ownership.js";

export interface ReconcileExistingCardsInput {
  cards: IdentifiedFlashcard[];
  client: AnkiGateway;
  confirmKindRecreations?: (
    pending: PendingKindRecreation[],
  ) => Promise<boolean>;
  desiredFieldHashes?: ReadonlyMap<string, string>;
  frontmatter: ParsedCardFrontmatter;
  plan: SyncPlan;
  preparedCardsByBlockId?: ReadonlyMap<string, IdentifiedFlashcard>;
}

export interface ReconcileExistingCardsResult {
  plan: SyncPlan;
  recoveredMissingCount: number;
}

function desiredModel(card: IdentifiedFlashcard): string {
  if (card.kind === "cloze") return ANKI_MODEL_CLOZE;
  if (card.kind === "reminder") return ANKI_MODEL_REMINDER;
  if (card.kind === "reversed") return ANKI_MODEL_REVERSED;
  return ANKI_MODEL_BASIC;
}

function crossesClozeBoundary(fromModel: string, toModel: string): boolean {
  return (fromModel === ANKI_MODEL_CLOZE) !== (toModel === ANKI_MODEL_CLOZE);
}

function ownedFieldNames(modelName: string): string[] {
  if (modelName === ANKI_MODEL_REMINDER) {
    return ["Content", "Context", "Source"];
  }
  return modelName === ANKI_MODEL_CLOZE
    ? ["Text", "Extra", "Context", "Source"]
    : ["Front", "Back", "Context", "Source"];
}

function readOwnedFields(
  fields: Record<string, { order?: number; value?: string }> | undefined,
  modelName: string,
): Record<string, string> | undefined {
  if (fields === undefined) return undefined;
  const out: Record<string, string> = {};
  for (const name of ownedFieldNames(modelName)) {
    out[name] = fields[name]?.value ?? "";
  }
  return out;
}

/**
 * Enrich the pure source/frontmatter diff with live Anki state.
 *
 * This is where four storage-aware policies live:
 * - a stale nid becomes CREATE;
 * - a source deck mismatch becomes a metadata-only UPDATE;
 * - an existing UPDATE learns its current model/cards/tags;
 * - a cloze boundary change is either marked for confirmed recreation or
 *   removed from this run.
 */
export async function reconcileExistingCards(
  input: ReconcileExistingCardsInput,
): Promise<ReconcileExistingCardsResult> {
  const plan: SyncPlan = {
    ...input.plan,
    create: input.plan.create.map((op) => ({
      ...op,
      card: input.preparedCardsByBlockId?.get(op.card.blockId) ?? op.card,
    })),
    delete: [...input.plan.delete],
    update: input.plan.update.map((op) => ({
      ...op,
      card: input.preparedCardsByBlockId?.get(op.card.blockId) ?? op.card,
    })),
  };
  const entryByBlockId = new Map(
    input.frontmatter.entries.map((entry) => [entry.blockId, entry]),
  );
  const bindings = input.cards.flatMap((card) => {
    const entry = entryByBlockId.get(card.blockId);
    const nid = entry?.nid ?? (/^\d{13}$/.test(card.blockId) ? Number(card.blockId) : undefined);
    return nid === undefined ? [] : [{ card, entry, nid }];
  });

  if (bindings.length === 0) {
    return { plan, recoveredMissingCount: 0 };
  }

  const requestedNids = [...new Set(bindings.map((binding) => binding.nid))];
  const noteInfos = await input.client.notesInfo(requestedNids);
  const noteByNid = new Map(
    noteInfos.flatMap((info) =>
      typeof info?.noteId === "number" ? [[info.noteId, info] as const] : [],
    ),
  );
  const cardIds = [
    ...new Set(
      [...noteByNid.values()].flatMap((info) =>
        Array.isArray(info.cards)
          ? info.cards.filter((cardId): cardId is number => typeof cardId === "number")
          : [],
      ),
    ),
  ];
  const cardInfos = cardIds.length > 0 ? await input.client.cardsInfo(cardIds) : [];
  const cardById = new Map(
    cardInfos.flatMap((info) =>
      typeof info?.cardId === "number" ? [[info.cardId, info] as const] : [],
    ),
  );

  let recoveredMissingCount = 0;
  const pending: PendingKindRecreation[] = [];
  const pendingBlockIds = new Set<string>();

  for (const { card, entry, nid } of bindings) {
    const preparedCard =
      input.preparedCardsByBlockId?.get(card.blockId) ?? card;
    const noteInfo = noteByNid.get(nid);
    if (!noteInfo) {
      plan.update = plan.update.filter((op) => op.card.blockId !== card.blockId);
      if (!plan.create.some((op) => op.card.blockId === card.blockId)) {
        plan.create.push({ card: preparedCard, hash: computeCardHash(card) });
      }
      recoveredMissingCount += 1;
      continue;
    }

    const existingCards: ExistingAnkiCard[] = (noteInfo.cards ?? []).flatMap(
      (cardId) => {
        const info = cardById.get(cardId);
        return info && typeof info.deckName === "string"
          ? [{ cardId, deckName: info.deckName }]
          : [];
      },
    );
    const targetModel = desiredModel(preparedCard);
    const currentModel = noteInfo.modelName ?? targetModel;
    const deckMismatch = existingCards.some(
      (existingCard) => existingCard.deckName !== card.deckName,
    );
    const modelMismatch = currentModel !== targetModel;
    const liveFields = readOwnedFields(noteInfo.fields, currentModel);
    const liveFieldsHash =
      liveFields === undefined
        ? undefined
        : computeRenderedFieldsHash(liveFields);
    const desiredFieldsHash = input.desiredFieldHashes?.get(card.blockId);
    const fieldMismatch =
      liveFieldsHash !== undefined &&
      (desiredFieldsHash !== undefined
        ? liveFieldsHash !== desiredFieldsHash
        : entry?.sync !== liveFieldsHash);
    const liveTags = Array.isArray(noteInfo.tags) ? [...noteInfo.tags] : [];
    const tagMismatch = !sameTagSet(
      liveTags,
      desiredAnkiTags(card.tags, liveTags),
    );
    let update = plan.update.find((op) => op.card.blockId === card.blockId);

    if (!update && (deckMismatch || modelMismatch || tagMismatch || fieldMismatch)) {
      const hash = computeCardHash(card);
      update = {
        card: preparedCard,
        newHash: hash,
        nid,
        oldHash: entry?.hash ?? hash,
      };
      plan.update.push(update);
    }

    if (!update) continue;
    update.existing = {
      cards: existingCards,
      ...(liveFields !== undefined ? { fields: liveFields } : {}),
      modelName: currentModel,
      tags: liveTags,
    };

    if (modelMismatch && crossesClozeBoundary(currentModel, targetModel)) {
      pending.push({
        blockId: card.blockId,
        fromModel: currentModel,
        front: card.front,
        nid,
        toModel: targetModel,
      });
      pendingBlockIds.add(card.blockId);
    }
  }

  if (pending.length > 0) {
    const confirmed = input.confirmKindRecreations
      ? await input.confirmKindRecreations(pending)
      : false;
    if (confirmed) {
      for (const op of plan.update) {
        if (pendingBlockIds.has(op.card.blockId)) op.recreate = true;
      }
    } else {
      plan.update = plan.update.filter(
        (op: UpdateOp) => !pendingBlockIds.has(op.card.blockId),
      );
    }
  }

  return { plan, recoveredMissingCount };
}
