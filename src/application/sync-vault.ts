import type { AnkiGateway, MarkdownNote, MarkdownRepository } from "./ports.js";
import type { SyncExecutionSession } from "./ports.js";
import type { FlashcardsSettings } from "../core/config/settings.js";
import type {
  PendingDeletion,
  PendingKindRecreation,
  PendingRebind,
} from "../core/sync/sync-plan.js";
import { NoopLogger, type Logger } from "../core/logging/logger.js";
import { createPerfTrace } from "../core/logging/perf-trace.js";
import {
  syncNote,
  type CardMediaError,
  type MediaPipeline,
  type SyncNoteResult,
} from "./sync-note.js";
import {
  loadLiveAnkiState,
  uniqueKnownNids,
  type LiveAnkiState,
} from "./sync/load-live-anki-state.js";

/**
 * Cue-collision lint (design §4.8, item 4): identical normalized cue on
 * different notes. Evidence comes from each note's first extraction pass or
 * from a verified incremental-cache entry.
 */
function detectCueCollisions(
  evidence: Array<{ cues: string[]; notePath: string }>,
): string[] {
  const cueToNotePaths = new Map<string, Set<string>>();

  for (const item of evidence) {
    for (const cue of item.cues) {
      const notePaths = cueToNotePaths.get(cue) ?? new Set<string>();
      notePaths.add(item.notePath);
      cueToNotePaths.set(cue, notePaths);
    }
  }

  const lints: string[] = [];
  for (const notePaths of cueToNotePaths.values()) {
    if (notePaths.size > 1) {
      lints.push(
        `warn: cue collision across notes — ${[...notePaths].join(", ")}`,
      );
    }
  }
  return lints;
}

export interface SyncVaultInput {
  ankiClient: AnkiGateway;
  cachedAtomicCues?: Array<{ cues: string[]; notePath: string }>;
  confirmDeletions?: (pending: PendingDeletion[]) => Promise<boolean>;
  confirmKindRecreations?: (
    pending: PendingKindRecreation[],
  ) => Promise<boolean>;
  confirmRebinds?: (pending: PendingRebind[]) => Promise<boolean>;
  executionSession?: SyncExecutionSession;
  generateBlockId?: () => string;
  logger?: Logger;
  mediaPipeline?: MediaPipeline;
  notes?: Iterable<MarkdownNote> | AsyncIterable<MarkdownNote>;
  /** Benchmark/diagnostic hook; not used by normal synchronization. */
  onBatchLoaded?: (noteCount: number, markdownBytes: number) => void;
  onProgress?: (current: number, total: number, notePath: string) => void;
  repository: MarkdownRepository;
  resolveLink?: (target: string, sourcePath: string) => string | null;
  settings: FlashcardsSettings;
  /** Required for accurate progress when `notes` is an async iterable. */
  processedNoteCount?: number;
  skippedUnchangedNoteCount?: number;
  vaultName: string;
}

const NOTE_BATCH_SIZE = 256;
const NOTE_BATCH_MARKDOWN_CHAR_LIMIT = 4 * 1024 * 1024;

async function* noteBatches(
  notes: Iterable<MarkdownNote> | AsyncIterable<MarkdownNote>,
): AsyncGenerator<MarkdownNote[]> {
  let batch: MarkdownNote[] = [];
  let markdownChars = 0;
  for await (const note of notes) {
    if (
      batch.length > 0 &&
      (batch.length === NOTE_BATCH_SIZE ||
        markdownChars + note.markdown.length > NOTE_BATCH_MARKDOWN_CHAR_LIMIT)
    ) {
      yield batch;
      batch = [];
      markdownChars = 0;
    }
    batch.push(note);
    markdownChars += note.markdown.length;
  }
  if (batch.length > 0) yield batch;
}

export interface NoteMediaErrors {
  notePath: string;
  errors: CardMediaError[];
}

export interface SyncVaultResult {
  failedNotes: number;
  lints: string[];
  mediaErrors: NoteMediaErrors[];
  noteCount: number;
  perNote: SyncNoteResult[];
  processedNoteCount: number;
  skippedUnchangedNoteCount: number;
  totalCreates: number;
  totalDeletes: number;
  totalUpdates: number;
}

/**
 * Sequentially syncs every markdown note in the vault. Per-note throws are
 * caught and reported as a `failed` result; vault iteration continues.
 *
 * Totals count only `status === "ok"` ops in each note's ankiResults.
 */
export async function syncVault(
  input: SyncVaultInput,
): Promise<SyncVaultResult> {
  const {
    ankiClient,
    cachedAtomicCues = [],
    confirmDeletions,
    confirmKindRecreations,
    confirmRebinds,
    executionSession: providedExecutionSession,
    generateBlockId,
    mediaPipeline,
    notes: providedNotes,
    onBatchLoaded,
    onProgress,
    repository,
    resolveLink,
    settings,
    processedNoteCount: declaredProcessedNoteCount,
    skippedUnchangedNoteCount = 0,
    vaultName,
  } = input;
  const logger: Logger = input.logger ?? new NoopLogger();
  const trace = createPerfTrace(logger, settings.perfTracing === true, "syncVault");

  const notes = providedNotes ?? (await repository.getAllMarkdownNotes());
  const expectedProcessedNoteCount =
    declaredProcessedNoteCount ?? (Array.isArray(notes) ? notes.length : 0);
  const total = expectedProcessedNoteCount;
  const expectedNoteCount = expectedProcessedNoteCount + skippedUnchangedNoteCount;

  logger.info("syncVault start", {
    noteCount: expectedNoteCount,
    processedNoteCount: expectedProcessedNoteCount,
    skippedUnchangedNoteCount,
  });

  const perNote: SyncNoteResult[] = [];
  const mediaErrors: NoteMediaErrors[] = [];
  let totalCreates = 0;
  let totalUpdates = 0;
  let totalDeletes = 0;
  let failedNotes = 0;
  const executionSession: SyncExecutionSession = providedExecutionSession ?? {};

  let current = 0;
  for await (const batch of noteBatches(notes)) {
    if (onBatchLoaded !== undefined) {
      const encoder = new TextEncoder();
      onBatchLoaded(
        batch.length,
        batch.reduce(
          (bytes, note) => bytes + encoder.encode(note.markdown).byteLength,
          0,
        ),
      );
    }
    let liveState: LiveAnkiState | undefined;
    try {
      liveState = await loadLiveAnkiState(
        ankiClient,
        uniqueKnownNids(batch),
      );
    } catch (error) {
      logger.warn("syncVault batched Anki preflight failed; using note fallback", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    for (const note of batch) {
    let result: SyncNoteResult;
    try {
      result = await syncNote({
        ankiClient,
        ...(confirmDeletions ? { confirmDeletions } : {}),
        ...(confirmKindRecreations ? { confirmKindRecreations } : {}),
        ...(confirmRebinds ? { confirmRebinds } : {}),
        executionSession,
        ...(generateBlockId ? { generateBlockId } : {}),
        logger,
        ...(liveState ? { liveState } : {}),
        ...(mediaPipeline ? { mediaPipeline } : {}),
        note,
        perfTrace: trace,
        repository,
        ...(resolveLink ? { resolveLink } : {}),
        settings,
        vaultName,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error("syncVault note threw", { notePath: note.path, error: msg });
      result = {
        error: msg,
        identityWritesApplied: 0,
        lints: [],
        notePath: note.path,
        parsedCardCount: 0,
        recoveredMissingCount: 0,
        status: "failed",
        writebackEditsApplied: 0,
      };
    }

    if (result.status === "failed") failedNotes += 1;
    if (result.ankiResults) {
      for (const c of result.ankiResults.creates)
        if (c.status === "ok") totalCreates += 1;
      for (const u of result.ankiResults.updates)
        if (u.status === "ok") totalUpdates += 1;
      for (const d of result.ankiResults.deletes)
        if (d.status === "ok") totalDeletes += 1;
    }

    if (result.mediaErrors && result.mediaErrors.length > 0) {
      mediaErrors.push({
        notePath: result.notePath,
        errors: result.mediaErrors,
      });
    }

    perNote.push(result);
    current += 1;
    onProgress?.(current, total || current, note.path);
    }
  }

  const processedNoteCount = perNote.length;
  const noteCount = processedNoteCount + skippedUnchangedNoteCount;

  logger.info("syncVault end", {
    noteCount,
    processedNoteCount,
    skippedUnchangedNoteCount,
    totalCreates,
    totalUpdates,
    totalDeletes,
    failedNotes,
  });
  if (failedNotes > 0) {
    const failures = perNote
      .filter((r) => r.status === "failed")
      .map((r) => ({ notePath: r.notePath, error: r.error }));
    logger.warn("syncVault failures", { failures });
  }

  const collisionLints = detectCueCollisions([
    ...cachedAtomicCues,
    ...perNote.map((result) => ({
      cues: result.atomicCues ?? [],
      notePath: result.notePath,
    })),
  ]);
  for (const lint of collisionLints) {
    logger.warn(lint);
  }
  const lints = [...perNote.flatMap((r) => r.lints), ...collisionLints];

  trace.finish();

  return {
    failedNotes,
    lints,
    mediaErrors,
    noteCount,
    perNote,
    processedNoteCount,
    skippedUnchangedNoteCount,
    totalCreates,
    totalDeletes,
    totalUpdates,
  };
}
