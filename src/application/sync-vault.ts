import type { AnkiConnectClient } from "../adapters/anki/anki-connect-client.js";
import type { ObsidianMarkdownRepository } from "../adapters/obsidian/obsidian-markdown-repository.js";
import type { FlashcardsSettings } from "../core/config/settings.js";
import { NoopLogger, type Logger } from "../core/logging/logger.js";
import {
  syncNote,
  type CardMediaError,
  type MediaPipeline,
  type SyncNoteResult,
} from "./sync-note.js";

export interface SyncVaultInput {
  ankiClient: AnkiConnectClient;
  generateBlockId?: () => string;
  logger?: Logger;
  mediaPipeline?: MediaPipeline;
  onProgress?: (current: number, total: number, notePath: string) => void;
  repository: ObsidianMarkdownRepository;
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
    generateBlockId,
    mediaPipeline,
    onProgress,
    repository,
    resolveLink,
    settings,
    vaultName,
  } = input;
  const logger: Logger = input.logger ?? new NoopLogger();

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
        ...(generateBlockId ? { generateBlockId } : {}),
        logger,
        ...(mediaPipeline ? { mediaPipeline } : {}),
        note,
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

  return {
    failedNotes,
    mediaErrors,
    noteCount: total,
    perNote,
    totalCreates,
    totalDeletes,
    totalUpdates,
  };
}
