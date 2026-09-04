import type { FlashcardsSettings } from "../core/config/settings.js";
import { applyTextEdits } from "../core/edits/apply-text-edits.js";
import { writebackSyncResults } from "../core/edits/writeback-sync-results.js";
import { NoopLogger, type Logger } from "../core/logging/logger.js";
import {
  createNoopPerfTrace,
  type PerfTrace,
} from "../core/logging/perf-trace.js";
import type { ExecuteSyncPlanResult } from "../core/sync/sync-execution.js";
import type {
  PendingDeletion,
  PendingKindRecreation,
  PendingRebind,
} from "../core/sync/sync-plan.js";
import type {
  AnkiGateway,
  MarkdownNote,
  MarkdownRepository,
  SyncExecutionSession,
} from "./ports.js";
import { applyDeleteSafety } from "./sync/apply-delete-safety.js";
import {
  buildSyncNoteCacheCandidate,
  type SyncNoteCacheCandidate,
} from "./sync/cache-state.js";
import { executeSyncPlan } from "./sync/execute-sync-plan.js";
import type { LiveAnkiState } from "./sync/load-live-anki-state.js";
import {
  dropCardsWithUnresolvedMedia,
  prepareCardContent,
  type CardMediaError,
  type MediaPipeline,
  type MediaPipelineResult,
} from "./sync/prepare-card-content.js";
import { prepareNoteSource } from "./sync/prepare-note-source.js";
import { reconcileExistingCards } from "./sync/reconcile-existing-cards.js";

export type { CardMediaError, MediaPipeline, MediaPipelineResult };

export interface SyncNoteInput {
  ankiClient: AnkiGateway;
  confirmDeletions?: (pending: PendingDeletion[]) => Promise<boolean>;
  confirmKindRecreations?: (
    pending: PendingKindRecreation[],
  ) => Promise<boolean>;
  confirmRebinds?: (pending: PendingRebind[]) => Promise<boolean>;
  executionSession?: SyncExecutionSession;
  generateBlockId?: () => string;
  logger?: Logger;
  liveState?: LiveAnkiState;
  mediaPipeline?: MediaPipeline;
  note: MarkdownNote;
  perfTrace?: PerfTrace;
  repository: MarkdownRepository;
  resolveLink?: (target: string, sourcePath: string) => string | null;
  settings: FlashcardsSettings;
  vaultName: string;
}

export type SyncNoteStatus = "ok" | "skipped" | "failed";

export interface SyncNoteResult {
  /** Normalized non-cloze atomic cues used by the vault collision check. */
  atomicCues?: string[];
  /** Present only when a warm sync may safely verify this note without reading it. */
  cacheCandidate?: SyncNoteCacheCandidate;
  ankiResults?: ExecuteSyncPlanResult;
  error?: string;
  identityWritesApplied: number;
  lints: string[];
  mediaErrors?: CardMediaError[];
  notePath: string;
  parsedCardCount: number;
  recoveredMissingCount: number;
  status: SyncNoteStatus;
  writebackEditsApplied: number;
}

function logLints(logger: Logger, notePath: string, lints: string[]): void {
  for (const lint of lints) {
    if (lint.startsWith("error:")) logger.error(lint, { notePath });
    else logger.warn(lint, { notePath });
  }
}

/** Synchronize one Markdown note while keeping Obsidian authoritative. */
export async function syncNote(input: SyncNoteInput): Promise<SyncNoteResult> {
  const logger = input.logger ?? new NoopLogger();
  const trace = input.perfTrace ?? createNoopPerfTrace();
  logger.info("syncNote start", { notePath: input.note.path });

  const source = await prepareNoteSource({
    ...(input.confirmRebinds ? { confirmRebinds: input.confirmRebinds } : {}),
    ...(input.generateBlockId
      ? { generateBlockId: input.generateBlockId }
      : {}),
    logger,
    note: input.note,
    repository: input.repository,
    settings: input.settings,
    trace,
  });
  logLints(logger, input.note.path, source.lints);

  if (source.skip) {
    logger.debug("syncNote skipped (no flashcards parsed)", {
      notePath: input.note.path,
    });
    return {
      atomicCues: source.atomicCues,
      identityWritesApplied: 0,
      lints: source.lints,
      notePath: input.note.path,
      parsedCardCount: 0,
      recoveredMissingCount: 0,
      status: "skipped",
      writebackEditsApplied: 0,
    };
  }

  logger.debug("syncNote parsed cards", {
    notePath: input.note.path,
    parsedCardCount: source.parsedCardCount,
  });
  const content = await prepareCardContent({
    cards: source.identifiedCards,
    markdown: input.note.markdown,
    ...(input.mediaPipeline ? { mediaPipeline: input.mediaPipeline } : {}),
    notePath: input.note.path,
    ...(input.resolveLink ? { resolveLink: input.resolveLink } : {}),
    settings: input.settings,
    trace,
    vaultName: input.vaultName,
  });
  let recoveredMissingCount = 0;
  const resultBase = {
    atomicCues: source.atomicCues,
    identityWritesApplied: source.identityWritesApplied,
    lints: source.lints,
    notePath: input.note.path,
    parsedCardCount: source.parsedCardCount,
  };

  try {
    const reconciled = await reconcileExistingCards({
      cards: source.identifiedCards,
      client: input.ankiClient,
      ...(input.confirmKindRecreations
        ? { confirmKindRecreations: input.confirmKindRecreations }
        : {}),
      frontmatter: source.frontmatter,
      ...(input.liveState ? { liveState: input.liveState } : {}),
      plan: source.plan,
      desiredFieldHashes: content.desiredFieldHashes,
      preparedCardsByBlockId: content.preparedCardsByBlockId,
    });
    source.plan = reconciled.plan;
    recoveredMissingCount = reconciled.recoveredMissingCount;
  } catch (error) {
    return failedResult(
      resultBase,
      recoveredMissingCount,
      error,
      logger,
      "checking existing Anki notes",
    );
  }

  await applyDeleteSafety({
    cards: source.identifiedCards,
    ...(input.confirmDeletions ? { confirm: input.confirmDeletions } : {}),
    logger,
    notePath: input.note.path,
    plan: source.plan,
    settings: input.settings,
  });
  const mediaErrors = dropCardsWithUnresolvedMedia(
    source.plan,
    content,
    logger,
  );

  if (isEmptyPlan(source.plan)) {
    logger.info("syncNote ok (no plan ops after reconciliation)", {
      notePath: input.note.path,
      identityWritesApplied: source.identityWritesApplied,
      mediaErrors: mediaErrors.length,
    });
    const cacheCandidate = buildSyncNoteCacheCandidate({
      atomicCues: source.atomicCues,
      cards: source.identifiedCards,
      desiredFieldHashes: content.desiredFieldHashes,
      finalMarkdown: source.markdown,
      hasDynamicDependencies: content.hasDynamicDependencies,
      lints: source.lints,
    });
    return {
      ...resultBase,
      ...(cacheCandidate ? { cacheCandidate } : {}),
      ...(mediaErrors.length > 0 ? { mediaErrors } : {}),
      recoveredMissingCount,
      status: "ok",
      writebackEditsApplied: 0,
    };
  }

  logger.debug("syncNote sync plan", {
    notePath: input.note.path,
    creates: source.plan.create.length,
    updates: source.plan.update.length,
    deletes: source.plan.delete.length,
  });

  let results: ExecuteSyncPlanResult;
  try {
    if (
      content.upload &&
      (source.plan.create.length > 0 || source.plan.update.length > 0)
    ) {
      await trace.span("media.upload", content.upload);
    }
    results = await trace.span("anki.sync", () =>
      executeSyncPlan({
        client: input.ankiClient,
        ...(input.executionSession
          ? { executionSession: input.executionSession }
          : {}),
        highlightClozeEnabled: input.settings.highlightCloze.enabled,
        logger,
        notePath: input.note.path,
        plan: source.plan,
        renderedCardsByBlockId: content.renderedCardsByBlockId,
        ...(input.resolveLink ? { resolveLink: input.resolveLink } : {}),
        vaultName: input.vaultName,
      }),
    );
  } catch (error) {
    return failedResult(
      resultBase,
      recoveredMissingCount,
      error,
      logger,
      "sync execution",
    );
  }

  const writeback = trace.span("writeback", () =>
    writebackSyncResults({ markdown: source.markdown, results }),
  );
  const finalMarkdown = applyTextEdits(source.markdown, writeback.edits);
  if (finalMarkdown !== source.markdown) {
    await input.repository.saveNote(input.note, finalMarkdown);
  }

  const cacheCandidate = buildSyncNoteCacheCandidate({
    atomicCues: source.atomicCues,
    cards: source.identifiedCards,
    desiredFieldHashes: content.desiredFieldHashes,
    finalMarkdown,
    hasDynamicDependencies: content.hasDynamicDependencies,
    lints: source.lints,
    results,
  });
  logSuccess(logger, input.note.path, results);

  return {
    ...resultBase,
    ...(cacheCandidate ? { cacheCandidate } : {}),
    ankiResults: results,
    ...(mediaErrors.length > 0 ? { mediaErrors } : {}),
    recoveredMissingCount,
    status: "ok",
    writebackEditsApplied: writeback.edits.length,
  };
}

type ResultBase = Pick<
  SyncNoteResult,
  | "atomicCues"
  | "identityWritesApplied"
  | "lints"
  | "notePath"
  | "parsedCardCount"
>;

function failedResult(
  base: ResultBase,
  recoveredMissingCount: number,
  error: unknown,
  logger: Logger,
  stage: string,
): SyncNoteResult {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(`syncNote failed during ${stage}`, {
    notePath: base.notePath,
    error: message,
  });
  return {
    ...base,
    error: message,
    recoveredMissingCount,
    status: "failed",
    writebackEditsApplied: 0,
  };
}

function isEmptyPlan(plan: {
  create: unknown[];
  delete: unknown[];
  update: unknown[];
}): boolean {
  return (
    plan.create.length === 0 &&
    plan.update.length === 0 &&
    plan.delete.length === 0
  );
}

function logSuccess(
  logger: Logger,
  notePath: string,
  results: ExecuteSyncPlanResult,
): void {
  const okCreates = results.creates.filter(
    (item) => item.status === "ok",
  ).length;
  const okUpdates = results.updates.filter(
    (item) => item.status === "ok",
  ).length;
  const okDeletes = results.deletes.filter(
    (item) => item.status === "ok",
  ).length;
  logger.info("syncNote ok", {
    notePath,
    okCreates,
    okUpdates,
    okDeletes,
    failedOps:
      results.creates.length +
      results.updates.length +
      results.deletes.length -
      okCreates -
      okUpdates -
      okDeletes,
  });
}
