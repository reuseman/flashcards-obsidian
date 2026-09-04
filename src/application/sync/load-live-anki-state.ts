import type {
  AnkiCardInfo,
  AnkiGateway,
  AnkiNoteInfo,
  MarkdownNote,
} from "../ports.js";
import { parseCardFrontmatter } from "../../core/sync/parse-card-frontmatter.js";

export interface LiveAnkiState {
  cardById: Map<number, AnkiCardInfo>;
  noteByNid: Map<number, AnkiNoteInfo>;
  requestedNids: Set<number>;
}

export interface LiveAnkiStateBatchOptions {
  cardBatchSize?: number;
  noteBatchSize?: number;
}

const DEFAULT_NOTE_BATCH_SIZE = 256;
const DEFAULT_CARD_BATCH_SIZE = 512;
const LEGACY_ANCHOR_RE = /^\^(\d{13})\s*$/gm;

function chunks<T>(values: T[], size: number): T[][] {
  if (!Number.isSafeInteger(size) || size < 1) {
    throw new Error("Anki batch size must be a positive integer");
  }
  const out: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    out.push(values.slice(index, index + size));
  }
  return out;
}

export async function loadLiveAnkiState(
  client: AnkiGateway,
  nids: Iterable<number>,
  options: LiveAnkiStateBatchOptions = {},
): Promise<LiveAnkiState> {
  const requestedNids = new Set(nids);
  const noteByNid = new Map<number, AnkiNoteInfo>();
  const cardById = new Map<number, AnkiCardInfo>();
  if (requestedNids.size === 0) {
    return { cardById, noteByNid, requestedNids };
  }

  const noteBatchSize = options.noteBatchSize ?? DEFAULT_NOTE_BATCH_SIZE;
  for (const batch of chunks([...requestedNids], noteBatchSize)) {
    for (const info of await client.notesInfo(batch)) {
      if (typeof info?.noteId === "number") noteByNid.set(info.noteId, info);
    }
  }

  const cardIds = new Set<number>();
  for (const info of noteByNid.values()) {
    for (const cardId of info.cards ?? []) {
      if (typeof cardId === "number") cardIds.add(cardId);
    }
  }
  const cardBatchSize = options.cardBatchSize ?? DEFAULT_CARD_BATCH_SIZE;
  for (const batch of chunks([...cardIds], cardBatchSize)) {
    for (const info of await client.cardsInfo(batch)) {
      if (typeof info?.cardId === "number") cardById.set(info.cardId, info);
    }
  }

  return { cardById, noteByNid, requestedNids };
}

export function mergeLiveAnkiStates(
  first: LiveAnkiState,
  second: LiveAnkiState,
): LiveAnkiState {
  return {
    cardById: new Map([...first.cardById, ...second.cardById]),
    noteByNid: new Map([...first.noteByNid, ...second.noteByNid]),
    requestedNids: new Set([...first.requestedNids, ...second.requestedNids]),
  };
}

function knownNids(note: MarkdownNote): Set<number> {
  const nids = new Set(
    parseCardFrontmatter(note.markdown).entries.flatMap((entry) =>
      entry.nid === undefined ? [] : [entry.nid],
    ),
  );
  for (const match of note.markdown.matchAll(LEGACY_ANCHOR_RE)) {
    nids.add(Number(match[1]));
  }
  return nids;
}

/**
 * Returns only IDs owned by one source note in this batch. Duplicate owners
 * must reconcile at note time so sequential writes cannot make a prefetched
 * snapshot stale for the second owner.
 */
export function uniqueKnownNids(notes: MarkdownNote[]): Set<number> {
  const owners = new Map<number, number>();
  for (const note of notes) {
    for (const nid of knownNids(note)) {
      owners.set(nid, (owners.get(nid) ?? 0) + 1);
    }
  }
  return new Set(
    [...owners].flatMap(([nid, count]) => (count === 1 ? [nid] : [])),
  );
}
