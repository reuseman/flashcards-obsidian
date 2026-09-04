import type {
  AnkiGateway,
  MarkdownNote,
} from "../../application/ports.js";
import type { SyncNoteResult } from "../../application/sync-note.js";
import {
  cacheCandidateMatchesLive,
  type SyncNoteCacheCandidate,
} from "../../application/sync/cache-state.js";
import { loadLiveAnkiState } from "../../application/sync/load-live-anki-state.js";

interface ScanAdapter {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
}

export interface MarkdownNoteDescriptor {
  file: unknown;
  mtime: number;
  name: string;
  path: string;
  size: number;
}

interface IncrementalRepository {
  listMarkdownNotes(): Promise<MarkdownNoteDescriptor[]>;
  readMarkdownNote(descriptor: MarkdownNoteDescriptor): Promise<MarkdownNote>;
}

interface EmptyScanIndexEntry {
  kind: "empty";
  mtime: number;
  size: number;
}

interface CardScanIndexEntry {
  candidate: SyncNoteCacheCandidate;
  kind: "cards";
  mtime: number;
  size: number;
}

type ScanIndexEntry = EmptyScanIndexEntry | CardScanIndexEntry;

interface ScanIndex {
  formatVersion: 2;
  notes: Record<string, ScanIndexEntry>;
  settingsKey: string;
}

type IncrementalResult = Pick<
  SyncNoteResult,
  "cacheCandidate" | "notePath" | "parsedCardCount" | "status"
> & { lints?: string[] };

export interface IncrementalVaultScan {
  cachedAtomicCues: Array<{ cues: string[]; notePath: string }>;
  finish(results: IncrementalResult[]): Promise<void>;
  /** Lazily reads selected note bodies; consume exactly once. */
  notes: AsyncIterable<MarkdownNote>;
  processedNoteCount: number;
  skippedUnchangedCardNoteCount: number;
  skippedUnchangedNoteCount: number;
}

export interface PrepareIncrementalVaultSyncOptions {
  adapter: ScanAdapter;
  ankiClient?: AnkiGateway;
  indexPath: string;
  repository: IncrementalRepository;
  settingsKey: string;
}

function descriptorMatches(
  descriptor: MarkdownNoteDescriptor,
  entry: ScanIndexEntry,
): boolean {
  return entry.mtime === descriptor.mtime && entry.size === descriptor.size;
}

async function verifiedCardPaths(
  candidates: Array<{
    descriptor: MarkdownNoteDescriptor;
    entry: CardScanIndexEntry;
  }>,
  client: AnkiGateway | undefined,
): Promise<Set<string>> {
  const verified = new Set<string>();
  if (client === undefined || candidates.length === 0) return verified;

  // A duplicated nid is an invalid cache proof. Both owners take the slow
  // sequential path so a write by the first cannot stale the second's view.
  const ownerCounts = new Map<number, number>();
  for (const { entry } of candidates) {
    for (const nid of new Set(entry.candidate.cards.map((card) => card.nid))) {
      ownerCounts.set(nid, (ownerCounts.get(nid) ?? 0) + 1);
    }
  }
  const eligible = candidates.filter(({ entry }) =>
    entry.candidate.cards.every((card) => ownerCounts.get(card.nid) === 1),
  );
  if (eligible.length === 0) return verified;

  try {
    const live = await loadLiveAnkiState(
      client,
      eligible.flatMap(({ entry }) =>
        entry.candidate.cards.map((card) => card.nid),
      ),
    );
    for (const { descriptor, entry } of eligible) {
      if (cacheCandidateMatchesLive(entry.candidate, live)) {
        verified.add(descriptor.path);
      }
    }
  } catch {
    // The index is acceleration only. Any transport or shape uncertainty
    // selects the existing complete sync path below.
  }
  return verified;
}

/**
 * Selects notes for a vault sync without making the cache authoritative.
 * Unchanged card notes skip their body only after batched live Anki state
 * exactly matches the expected state produced by their previous full sync.
 */
export async function prepareIncrementalVaultSync(
  options: PrepareIncrementalVaultSyncOptions,
): Promise<IncrementalVaultScan> {
  const descriptors = await options.repository.listMarkdownNotes();
  const previous = await readIndex(options.adapter, options.indexPath);
  const reusable = previous?.settingsKey === options.settingsKey;

  const unchangedEmptyPaths = new Set<string>();
  const cardCandidates: Array<{
    descriptor: MarkdownNoteDescriptor;
    entry: CardScanIndexEntry;
  }> = [];
  if (reusable) {
    for (const descriptor of descriptors) {
      const entry = previous.notes[descriptor.path];
      if (entry === undefined || !descriptorMatches(descriptor, entry)) continue;
      if (entry.kind === "empty") unchangedEmptyPaths.add(descriptor.path);
      else cardCandidates.push({ descriptor, entry });
    }
  }

  const unchangedCardPaths = await verifiedCardPaths(
    cardCandidates,
    options.ankiClient,
  );
  const skippedPaths = new Set([
    ...unchangedEmptyPaths,
    ...unchangedCardPaths,
  ]);
  const selected = descriptors.filter(
    (descriptor) => !skippedPaths.has(descriptor.path),
  );

  async function* readSelectedNotes(): AsyncGenerator<MarkdownNote> {
    for (const descriptor of selected) {
      yield await options.repository.readMarkdownNote(descriptor);
    }
  }

  const cachedAtomicCues = cardCandidates.flatMap(({ descriptor, entry }) =>
    unchangedCardPaths.has(descriptor.path) &&
    entry.candidate.atomicCues.length > 0
      ? [{ cues: [...entry.candidate.atomicCues], notePath: descriptor.path }]
      : [],
  );

  return {
    cachedAtomicCues,
    notes: readSelectedNotes(),
    processedNoteCount: selected.length,
    skippedUnchangedCardNoteCount: unchangedCardPaths.size,
    skippedUnchangedNoteCount: skippedPaths.size,
    async finish(results): Promise<void> {
      // Sync may write anchors/frontmatter. Re-list so a successful first sync
      // does not persist the stale pre-write mtime/size and miss its next fast
      // path opportunity.
      const refreshedDescriptors = await options.repository.listMarkdownNotes();
      const resultByPath = new Map(
        results.map((result) => [result.notePath, result]),
      );
      const next: ScanIndex = {
        formatVersion: 2,
        notes: {},
        settingsKey: options.settingsKey,
      };

      for (const descriptor of refreshedDescriptors) {
        const result = resultByPath.get(descriptor.path);
        if (
          result?.status === "skipped" &&
          result.parsedCardCount === 0 &&
          (result.lints?.length ?? 0) === 0
        ) {
          next.notes[descriptor.path] = {
            kind: "empty",
            mtime: descriptor.mtime,
            size: descriptor.size,
          };
          continue;
        }
        if (result?.status === "ok" && result.cacheCandidate !== undefined) {
          next.notes[descriptor.path] = {
            candidate: result.cacheCandidate,
            kind: "cards",
            mtime: descriptor.mtime,
            size: descriptor.size,
          };
          continue;
        }

        if (skippedPaths.has(descriptor.path) && reusable) {
          const prior = previous.notes[descriptor.path];
          if (prior !== undefined) {
            next.notes[descriptor.path] = {
              ...prior,
              mtime: descriptor.mtime,
              size: descriptor.size,
            };
          }
        }
      }

      await options.adapter.write(options.indexPath, JSON.stringify(next));
    },
  };
}

async function readIndex(
  adapter: ScanAdapter,
  path: string,
): Promise<ScanIndex | undefined> {
  try {
    if (!(await adapter.exists(path))) return undefined;
    const value: unknown = JSON.parse(await adapter.read(path));
    return isScanIndex(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function isCacheCandidate(value: unknown): value is SyncNoteCacheCandidate {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<SyncNoteCacheCandidate>;
  if (
    !Array.isArray(candidate.atomicCues) ||
    !candidate.atomicCues.every((cue) => typeof cue === "string") ||
    !Array.isArray(candidate.cards) ||
    candidate.cards.length === 0
  ) return false;
  return candidate.cards.every((card: unknown) => {
    if (typeof card !== "object" || card === null) return false;
    const item = card as Record<string, unknown>;
    return (
      typeof item.deckName === "string" &&
      typeof item.fieldsHash === "string" &&
      typeof item.modelName === "string" &&
      typeof item.nid === "number" &&
      Number.isSafeInteger(item.nid) &&
      Array.isArray(item.sourceTags) &&
      item.sourceTags.every((tag) => typeof tag === "string")
    );
  });
}

function isScanEntry(value: unknown): value is ScanIndexEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  if (typeof entry.mtime !== "number" || typeof entry.size !== "number") {
    return false;
  }
  if (entry.kind === "empty") return true;
  return entry.kind === "cards" && isCacheCandidate(entry.candidate);
}

function isScanIndex(value: unknown): value is ScanIndex {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ScanIndex>;
  return (
    candidate.formatVersion === 2 &&
    typeof candidate.settingsKey === "string" &&
    typeof candidate.notes === "object" &&
    candidate.notes !== null &&
    Object.values(candidate.notes).every(isScanEntry)
  );
}
