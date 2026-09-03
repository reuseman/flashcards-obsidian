import type { MarkdownNote } from "../../application/ports.js";
import type { SyncNoteResult } from "../../application/sync-note.js";

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

interface ScanIndexEntry {
  cardFree: boolean;
  mtime: number;
  size: number;
}

interface ScanIndex {
  formatVersion: 1;
  notes: Record<string, ScanIndexEntry>;
  settingsKey: string;
}

export interface IncrementalVaultScan {
  finish(
    results: Array<
      Pick<SyncNoteResult, "notePath" | "parsedCardCount" | "status"> & {
        lints?: string[];
      }
    >,
  ): Promise<void>;
  notes: MarkdownNote[];
  skippedUnchangedNoteCount: number;
}

export interface PrepareIncrementalVaultSyncOptions {
  adapter: ScanAdapter;
  indexPath: string;
  repository: IncrementalRepository;
  settingsKey: string;
}

/**
 * Skips only unchanged files that a prior successful parse proved contain no
 * cards. Card-bearing and uncertain notes still take the full reconciliation
 * path, so this cache cannot hide Anki drift.
 */
export async function prepareIncrementalVaultSync(
  options: PrepareIncrementalVaultSyncOptions,
): Promise<IncrementalVaultScan> {
  const descriptors = await options.repository.listMarkdownNotes();
  const previous = await readIndex(options.adapter, options.indexPath);
  const reusable = previous?.settingsKey === options.settingsKey;
  const selected = descriptors.filter((descriptor) => {
    if (!reusable) return true;
    const entry = previous.notes[descriptor.path];
    return !(
      entry?.cardFree === true &&
      entry.mtime === descriptor.mtime &&
      entry.size === descriptor.size
    );
  });
  const notes = await Promise.all(
    selected.map((descriptor) =>
      options.repository.readMarkdownNote(descriptor),
    ),
  );

  return {
    notes,
    skippedUnchangedNoteCount: descriptors.length - selected.length,
    async finish(results): Promise<void> {
      const resultByPath = new Map(
        results.map((result) => [result.notePath, result]),
      );
      const selectedPaths = new Set(selected.map((item) => item.path));
      const next: ScanIndex = {
        formatVersion: 1,
        notes: {},
        settingsKey: options.settingsKey,
      };

      for (const descriptor of descriptors) {
        const result = resultByPath.get(descriptor.path);
        if (result !== undefined) {
          next.notes[descriptor.path] = {
            cardFree:
              result.status === "skipped" &&
              result.parsedCardCount === 0 &&
              (result.lints?.length ?? 0) === 0,
            mtime: descriptor.mtime,
            size: descriptor.size,
          };
          continue;
        }

        const prior = reusable ? previous.notes[descriptor.path] : undefined;
        next.notes[descriptor.path] = {
          cardFree:
            !selectedPaths.has(descriptor.path) && prior?.cardFree === true,
          mtime: descriptor.mtime,
          size: descriptor.size,
        };
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
    if (!isScanIndex(value)) return undefined;
    return value;
  } catch {
    return undefined;
  }
}

function isScanIndex(value: unknown): value is ScanIndex {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ScanIndex>;
  return (
    candidate.formatVersion === 1 &&
    typeof candidate.settingsKey === "string" &&
    typeof candidate.notes === "object" &&
    candidate.notes !== null
  );
}
