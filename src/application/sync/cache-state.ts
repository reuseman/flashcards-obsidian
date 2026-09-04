import type { LiveAnkiState } from "./load-live-anki-state.js";
import type { IdentifiedFlashcard } from "../../core/domain/card.js";
import { computeRenderedFieldsHash } from "../../core/edits/card-hash.js";
import type { ExecuteSyncPlanResult } from "../../core/sync/sync-execution.js";
import { parseCardFrontmatter } from "../../core/sync/parse-card-frontmatter.js";
import {
  desiredManagedModel,
  readManagedFields,
} from "../../core/sync/managed-note-state.js";
import {
  desiredAnkiTags,
  sameTagSet,
} from "../../core/sync/tag-ownership.js";

export interface ExpectedAnkiCardState {
  deckName: string;
  fieldsHash: string;
  modelName: string;
  nid: number;
  sourceTags: string[];
}

/**
 * Complete proof material for a dependency-free card note. It is disposable
 * acceleration data, never an identity or deletion source.
 */
export interface SyncNoteCacheCandidate {
  atomicCues: string[];
  cards: ExpectedAnkiCardState[];
}

export function buildSyncNoteCacheCandidate(options: {
  atomicCues: string[];
  cards: IdentifiedFlashcard[];
  desiredFieldHashes: ReadonlyMap<string, string>;
  finalMarkdown: string;
  hasDynamicDependencies: boolean;
  lints: string[];
  results?: ExecuteSyncPlanResult;
}): SyncNoteCacheCandidate | undefined {
  if (
    options.cards.length === 0 ||
    options.hasDynamicDependencies ||
    options.lints.length > 0
  ) return undefined;
  if (
    options.results !== undefined &&
    [
      ...options.results.creates,
      ...options.results.updates,
      ...options.results.deletes,
    ].some((result) => result.status === "failed")
  ) return undefined;

  const finalEntries = new Map(
    parseCardFrontmatter(options.finalMarkdown).entries.map((entry) => [
      entry.blockId,
      entry,
    ]),
  );
  const cardIds = new Set(options.cards.map((card) => card.blockId));
  if ([...finalEntries.keys()].some((blockId) => !cardIds.has(blockId))) {
    return undefined;
  }

  const resultNids = new Map<string, number>();
  for (const result of options.results?.creates ?? []) {
    if (result.status === "ok" && result.nid !== undefined) {
      resultNids.set(result.op.card.blockId, result.nid);
    }
  }
  for (const result of options.results?.updates ?? []) {
    if (result.status === "ok") {
      resultNids.set(result.op.card.blockId, result.nid ?? result.op.nid);
    }
  }

  const expected: ExpectedAnkiCardState[] = [];
  const seenNids = new Set<number>();
  for (const card of options.cards) {
    const entry = finalEntries.get(card.blockId);
    const nid =
      resultNids.get(card.blockId) ??
      entry?.nid ??
      (/^\d{13}$/.test(card.blockId) ? Number(card.blockId) : undefined);
    const fieldsHash = options.desiredFieldHashes.get(card.blockId);
    if (
      nid === undefined ||
      fieldsHash === undefined ||
      card.deckName === undefined ||
      seenNids.has(nid)
    ) return undefined;
    seenNids.add(nid);
    expected.push({
      deckName: card.deckName,
      fieldsHash,
      modelName: desiredManagedModel(card),
      nid,
      sourceTags: [...card.tags],
    });
  }

  return { atomicCues: [...options.atomicCues], cards: expected };
}

export function cacheCandidateMatchesLive(
  candidate: SyncNoteCacheCandidate,
  live: LiveAnkiState,
): boolean {
  if (candidate.cards.length === 0) return false;

  for (const expected of candidate.cards) {
    if (!live.requestedNids.has(expected.nid)) return false;
    const note = live.noteByNid.get(expected.nid);
    if (note?.modelName !== expected.modelName) return false;

    const fields = readManagedFields(note.fields, expected.modelName);
    if (
      fields === undefined ||
      computeRenderedFieldsHash(fields) !== expected.fieldsHash
    ) return false;

    const liveTags = Array.isArray(note.tags) ? note.tags : [];
    if (
      !sameTagSet(
        liveTags,
        desiredAnkiTags(expected.sourceTags, liveTags),
      )
    ) return false;

    const cardIds = Array.isArray(note.cards) ? note.cards : [];
    if (cardIds.length === 0) return false;
    for (const cardId of cardIds) {
      const card = live.cardById.get(cardId);
      if (card?.deckName !== expected.deckName) return false;
    }
  }

  return true;
}
