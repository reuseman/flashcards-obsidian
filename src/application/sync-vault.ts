import type { AnkiGateway, MarkdownNote, MarkdownRepository } from "./ports.js";
import type { FlashcardsSettings } from "../core/config/settings.js";
import { extractCardsFromMarkdown } from "../core/parse/extract-cards.js";
import type { PendingDeletion } from "../core/sync/sync-plan.js";
import { NoopLogger, type Logger } from "../core/logging/logger.js";
import { createPerfTrace } from "../core/logging/perf-trace.js";
import {
  syncNote,
  type CardMediaError,
  type MediaPipeline,
  type SyncNoteResult,
} from "./sync-note.js";

/**
 * Cue-collision lint (design §4.8, item 4): identical normalized cue on
 * DIFFERENT notes, vault-level sync only — a single-note sync has no
 * visibility into other notes' cues, so this can never live in `syncNote`.
 * Re-extracts each note (already parsed once inside `syncNote`, but there is
 * no cheap way to share that result across the black-box call without
 * threading extra plumbing through it) purely to gather cue candidates.
 */
function normalizeCue(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function detectCueCollisions(
  notes: MarkdownNote[],
  settings: FlashcardsSettings,
): string[] {
  const cueToNotePaths = new Map<string, Set<string>>();

  for (const note of notes) {
    const { cards } = extractCardsFromMarkdown(note.markdown, {
      notePath: note.path,
      settings,
    });
    for (const card of cards) {
      if (card.source.syntax !== "atomic" || card.kind === "cloze") continue;
      const cue = normalizeCue(card.front);
      const notePaths = cueToNotePaths.get(cue) ?? new Set<string>();
      notePaths.add(note.path);
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
  confirmDeletions?: (pending: PendingDeletion[]) => Promise<boolean>;
  generateBlockId?: () => string;
  logger?: Logger;
  mediaPipeline?: MediaPipeline;
  onProgress?: (current: number, total: number, notePath: string) => void;
  repository: MarkdownRepository;
  resolveLink?: (target: string, sourcePath: string) => string | null;
  settings: FlashcardsSettings;
  vaultName: string;
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
    confirmDeletions,
    generateBlockId,
    mediaPipeline,
    onProgress,
    repository,
    resolveLink,
    settings,
    vaultName,
  } = input;
  const logger: Logger = input.logger ?? new NoopLogger();
  const trace = createPerfTrace(logger, settings.perfTracing === true, "syncVault");

  const notes = await repository.getAllMarkdownNotes();
  const total = notes.length;

  logger.info("syncVault start", { noteCount: total });

  const perNote: SyncNoteResult[] = [];
  const mediaErrors: NoteMediaErrors[] = [];
  let totalCreates = 0;
  let totalUpdates = 0;
  let totalDeletes = 0;
  let failedNotes = 0;

  for (let i = 0; i < notes.length; i++) {
    const note = notes[i]!;
    let result: SyncNoteResult;
    try {
      result = await syncNote({
        ankiClient,
        ...(confirmDeletions ? { confirmDeletions } : {}),
        ...(generateBlockId ? { generateBlockId } : {}),
        logger,
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
    onProgress?.(i + 1, total, note.path);
  }

  logger.info("syncVault end", {
    noteCount: total,
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

  const collisionLints = detectCueCollisions(notes, settings);
  for (const lint of collisionLints) {
    logger.warn(lint);
  }
  const lints = [...perNote.flatMap((r) => r.lints), ...collisionLints];

  trace.finish();

  return {
    failedNotes,
    lints,
    mediaErrors,
    noteCount: total,
    perNote,
    totalCreates,
    totalDeletes,
    totalUpdates,
  };
}
