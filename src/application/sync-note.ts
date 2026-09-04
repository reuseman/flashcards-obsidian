import { executeSyncPlan } from "./sync/execute-sync-plan.js";
import type { ExecuteSyncPlanResult } from "../core/sync/sync-execution.js";
import type {
  AnkiGateway,
  MarkdownNote,
  MarkdownRepository,
} from "./ports.js";
import type { FlashcardsSettings } from "../core/config/settings.js";
import { NoopLogger, type Logger } from "../core/logging/logger.js";
import { createNoopPerfTrace, type PerfTrace } from "../core/logging/perf-trace.js";
import { applyTextEdits } from "../core/edits/apply-text-edits.js";
import {
  computeCardHash,
  computeRenderedFieldsHash,
} from "../core/edits/card-hash.js";
import { writeCardFrontmatter } from "../core/edits/write-card-frontmatter.js";
import { writebackSyncResults } from "../core/edits/writeback-sync-results.js";
import { extractMedia, type MediaRef } from "../core/render/extract-media.js";
import {
  rewriteMedia,
  type MediaRewriteMap,
} from "../core/render/rewrite-media.js";
import { renderCardForAnki } from "../core/render/render-card.js";
import { buildSyncPlan } from "../core/sync/build-sync-plan.js";
import { parseCardFrontmatter } from "../core/sync/parse-card-frontmatter.js";
import type { PendingDeletion, PendingRebind } from "../core/sync/sync-plan.js";
import type { PendingKindRecreation } from "../core/sync/sync-plan.js";
import { reconcileExistingCards } from "./sync/reconcile-existing-cards.js";
import {
  defaultGenerateBlockId,
  previewSyncPlan,
} from "./preview-sync-plan.js";

/**
 * Outcome of the per-note media phase. `resolved` maps original short
 * filenames to their content-hashed final name + kind (image|audio); cards
 * whose refs touch an entry in `errors` are dropped from this run.
 *
 * Resolution is eager so the desired Anki fields include current media
 * content hashes. Upload is deferred until reconciliation proves that at
 * least one card needs to be created or updated.
 */
export interface MediaPipelineResult {
  rewriteMap: MediaRewriteMap;
  errors: Array<{ filename: string; reason: "not-found" | "read-failed" }>;
  /** Upload resolved bytes only when at least one Anki field needs them. */
  upload?: () => Promise<void>;
}

export type MediaPipeline = (
  refs: MediaRef[],
  sourcePath: string,
) => Promise<MediaPipelineResult>;

export interface CardMediaError {
  blockId: string;
  errors: Array<{ filename: string; reason: "not-found" | "read-failed" }>;
}

export interface SyncNoteInput {
  ankiClient: AnkiGateway;
  confirmDeletions?: (pending: PendingDeletion[]) => Promise<boolean>;
  confirmKindRecreations?: (
    pending: PendingKindRecreation[],
  ) => Promise<boolean>;
  confirmRebinds?: (pending: PendingRebind[]) => Promise<boolean>;
  generateBlockId?: () => string;
  logger?: Logger;
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
    if (lint.startsWith("error:")) {
      logger.error(lint, { notePath });
    } else {
      logger.warn(lint, { notePath });
    }
  }
}

export async function syncNote(input: SyncNoteInput): Promise<SyncNoteResult> {
  const {
    ankiClient,
    generateBlockId = defaultGenerateBlockId,
    note,
    repository,
    resolveLink,
    settings,
    vaultName,
  } = input;
  const logger: Logger = input.logger ?? new NoopLogger();
  const trace: PerfTrace = input.perfTrace ?? createNoopPerfTrace();

  logger.info("syncNote start", { notePath: note.path });

  // Phase A — local edits.
  const preview = trace.span("extract", () =>
    previewSyncPlan({
      generateBlockId,
      markdown: note.markdown,
      notePath: note.path,
      settings,
    }),
  );
  const { cards, identifiedCards, insertEdits, lints } = preview;
  logLints(logger, note.path, lints);

  // Zero cards normally means "nothing to do", but a cue-bearing orphan
  // (spec §4.2, final-review fix #2) must still reach delete-safety below —
  // `previewSyncPlan` already folded that into `preview.plan` when relevant.
  if (cards.length === 0 && preview.plan.delete.length === 0) {
    logger.debug("syncNote skipped (no flashcards parsed)", { notePath: note.path });
    return {
      identityWritesApplied: 0,
      lints,
      notePath: note.path,
      parsedCardCount: 0,
      recoveredMissingCount: 0,
      status: "skipped",
      writebackEditsApplied: 0,
    };
  }

  logger.debug("syncNote parsed cards", {
    notePath: note.path,
    parsedCardCount: cards.length,
  });

  // Cue-rephrase rebind pairing (spec §4.7, WI-11). Resolved BEFORE the
  // frontmatter writeback below so a confirmed rebind never materializes a
  // throwaway entry for the atomic CREATE's transient blockId — instead the
  // CREATE's card is re-pointed at the orphan's blockId and the plan is
  // rebuilt, which routes it through the ordinary Rule-4 UPDATE path (correct
  // oldHash, no duplicate frontmatter entry, cue naturally recomputed).
  let plan = preview.plan;
  const rebindCandidates = plan.rebinds ?? [];
  if (rebindCandidates.length === 1) {
    const rebind = rebindCandidates[0]!;
    const confirmed = input.confirmRebinds
      ? await input.confirmRebinds(rebindCandidates)
      : false; // safe default: no confirmer wired ⇒ ordinary delete-safety flow.
    if (confirmed) {
      const createOp = plan.create.find(
        (op) => op.card.source.syntax === "atomic",
      )!;
      const idx = identifiedCards.indexOf(createOp.card);
      if (idx < 0) {
        // Should be structurally impossible — `createOp.card` came from
        // `identifiedCards` via `buildSyncPlan` without copying. Never
        // silently drop a user-confirmed rebind: log and fall through to the
        // ordinary (unrebound) plan instead.
        logger.error("syncNote rebind: createOp.card not found in identifiedCards", {
          notePath: note.path,
          blockId: rebind.blockId,
        });
      } else {
        identifiedCards[idx] = { ...createOp.card, blockId: rebind.blockId };
        plan = buildSyncPlan({
          cards: identifiedCards,
          computeHash: computeCardHash,
          frontmatter: parseCardFrontmatter(note.markdown),
        });
      }
    }
  }

  const markdownA = applyTextEdits(note.markdown, insertEdits);

  const writeFm = writeCardFrontmatter({
    cards: identifiedCards,
    markdown: markdownA,
  });
  const markdownB = applyTextEdits(markdownA, writeFm.edits);

  const identityWritesApplied = insertEdits.length + writeFm.edits.length;

  if (markdownB !== note.markdown) {
    await repository.saveNote(note, markdownB);
  }

  // Resolve media before live reconciliation, even when the Markdown source
  // hash is unchanged. Content-hashed filenames make media-byte changes part
  // of the desired rendered fields without making them part of card identity.
  // Upload stays deferred until reconciliation proves a create/update needs it.
  const mediaErrors: CardMediaError[] = [];
  let allRefs: MediaRef[] = [];
  let mediaMap: MediaRewriteMap = {};
  let mediaResolutionErrors: MediaPipelineResult["errors"] = [];
  let uploadResolvedMedia: (() => Promise<void>) | undefined;
  if (input.mediaPipeline) {
    allRefs = trace.span("media.resolve", () => extractMedia(note.markdown));
    if (allRefs.length > 0) {
      const outcome = await trace.span("media.prepare", async () =>
        input.mediaPipeline!(allRefs, note.path),
      );
      mediaMap = outcome.rewriteMap;
      mediaResolutionErrors = outcome.errors;
      uploadResolvedMedia = outcome.upload;
    }
  }

  const preparedCardsByBlockId = new Map(
    identifiedCards.map((card) => {
      const prepared = {
        ...card,
        answer: rewriteMedia(card.answer, mediaMap),
        ...(card.context !== undefined
          ? { context: rewriteMedia(card.context, mediaMap) }
          : {}),
        front: rewriteMedia(card.front, mediaMap),
      };
      return [card.blockId, prepared] as const;
    }),
  );
  const desiredFieldHashes = new Map(
    [...preparedCardsByBlockId].map(([blockId, card]) => {
      const rendered = renderCardForAnki(card, {
        deckName: card.deckName ?? "",
        highlightClozeEnabled: settings.highlightCloze.enabled,
        notePath: note.path,
        tags: card.tags,
        vaultName,
        ...(resolveLink ? { resolveLink } : {}),
      });
      return [blockId, computeRenderedFieldsHash(rendered.fields)] as const;
    }),
  );

  let recoveredMissingCount = 0;
  try {
    const reconciled = await reconcileExistingCards({
      cards: identifiedCards,
      client: ankiClient,
      ...(input.confirmKindRecreations
        ? { confirmKindRecreations: input.confirmKindRecreations }
        : {}),
      frontmatter: parseCardFrontmatter(note.markdown),
      plan,
      desiredFieldHashes,
      preparedCardsByBlockId,
    });
    plan = reconciled.plan;
    recoveredMissingCount = reconciled.recoveredMissingCount;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("syncNote failed while checking existing Anki notes", {
      notePath: note.path,
      error: msg,
    });
    return {
      error: msg,
      identityWritesApplied,
      lints,
      notePath: note.path,
      parsedCardCount: cards.length,
      recoveredMissingCount,
      status: "failed",
      writebackEditsApplied: 0,
    };
  }

  // Phase B — diff and sync. `preview.plan` (or the rebind-resolved plan
  // above) was built against the frontmatter read from `note.markdown`
  // (pre-writeback); this is equivalent to reading it from `markdownB`
  // because `writeCardFrontmatter` only ever appends nid-less entries, and
  // `buildSyncPlan` treats "no entry" and "entry without nid" identically
  // (both CREATE).

  // Delete-safety gate (spec §4.5). A sync must never SILENTLY delete an Anki
  // card. Creates and updates always proceed regardless of the decision.
  if (plan.delete.length >= 1) {
    const noteDeck =
      identifiedCards.find((c) => c.deckName !== undefined)?.deckName ??
      settings.defaultDeck;
    const pending: PendingDeletion[] = plan.delete.map((op) => ({
      blockId: op.blockId,
      deckName: noteDeck,
      nid: op.nid,
    }));
    for (const d of pending) {
      logger.info("syncNote pending deletion", {
        notePath: note.path,
        blockId: d.blockId,
        nid: d.nid,
        deckName: d.deckName,
      });
    }

    if (settings.confirmBeforeDelete) {
      const confirmed = input.confirmDeletions
        ? await input.confirmDeletions(pending)
        : false; // safe default: no confirmer wired ⇒ skip deletes.
      if (!confirmed) {
        plan.delete = [];
      }
    }
  }

  // Drop only creates/updates whose own source range contains unresolved
  // media. Deletes remain safe and independent of local media availability.
  if (mediaResolutionErrors.length > 0) {
    const erroredNames = new Set(
      mediaResolutionErrors.map((error) => error.filename),
    );
    const cardHasError = (
      startOffset: number,
      endOffset: number,
    ): Array<{ filename: string; reason: "not-found" | "read-failed" }> => {
      const hits: Array<{
        filename: string;
        reason: "not-found" | "read-failed";
      }> = [];
      for (const ref of allRefs) {
        if (
          ref.start >= startOffset &&
          ref.end <= endOffset &&
          erroredNames.has(ref.filename)
        ) {
          const error = mediaResolutionErrors.find(
            (candidate) => candidate.filename === ref.filename,
          );
          if (error) hits.push(error);
        }
      }
      return hits;
    };

    const keepCardWithResolvedMedia = (op: {
      card: { blockId: string; source: { startOffset: number; endOffset: number } };
    }): boolean => {
      const errors = cardHasError(
        op.card.source.startOffset,
        op.card.source.endOffset,
      );
      if (errors.length === 0) return true;
      mediaErrors.push({ blockId: op.card.blockId, errors });
      logger.warn("card dropped: unresolved media", {
        blockId: op.card.blockId,
        errors,
      });
      return false;
    };

    plan.create = plan.create.filter(keepCardWithResolvedMedia);
    plan.update = plan.update.filter(keepCardWithResolvedMedia);
  }

  // Short-circuit: media phase may have emptied the plan entirely.
  const stillEmpty =
    plan.create.length === 0 &&
    plan.update.length === 0 &&
    plan.delete.length === 0;
  if (stillEmpty) {
    logger.info("syncNote ok (no plan ops after reconciliation)", {
      notePath: note.path,
      identityWritesApplied,
      mediaErrors: mediaErrors.length,
    });
    return {
      identityWritesApplied,
      lints,
      ...(mediaErrors.length > 0 ? { mediaErrors } : {}),
      notePath: note.path,
      parsedCardCount: cards.length,
      recoveredMissingCount,
      status: "ok",
      writebackEditsApplied: 0,
    };
  }

  logger.debug("syncNote sync plan", {
    notePath: note.path,
    creates: plan.create.length,
    updates: plan.update.length,
    deletes: plan.delete.length,
  });

  let results: ExecuteSyncPlanResult;
  try {
    if (
      uploadResolvedMedia !== undefined &&
      (plan.create.length > 0 || plan.update.length > 0)
    ) {
      await trace.span("media.upload", uploadResolvedMedia);
    }
    results = await trace.span("anki.sync", async () =>
      executeSyncPlan({
        client: ankiClient,
        highlightClozeEnabled: settings.highlightCloze.enabled,
        logger,
        notePath: note.path,
        plan,
        ...(resolveLink ? { resolveLink } : {}),
        vaultName,
      }),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("syncNote failed in Phase B", { notePath: note.path, error: msg });
    return {
      error: msg,
      identityWritesApplied,
      lints,
      notePath: note.path,
      parsedCardCount: cards.length,
      recoveredMissingCount,
      status: "failed",
      writebackEditsApplied: 0,
    };
  }

  const writeback = trace.span("writeback", () =>
    writebackSyncResults({ markdown: markdownB, results }),
  );
  const markdownC = applyTextEdits(markdownB, writeback.edits);

  if (markdownC !== markdownB) {
    await repository.saveNote(note, markdownC);
  }

  logger.info("syncNote ok", {
    notePath: note.path,
    okCreates: results.creates.filter((c) => c.status === "ok").length,
    okUpdates: results.updates.filter((u) => u.status === "ok").length,
    okDeletes: results.deletes.filter((d) => d.status === "ok").length,
    failedOps:
      results.creates.filter((c) => c.status === "failed").length +
      results.updates.filter((u) => u.status === "failed").length +
      results.deletes.filter((d) => d.status === "failed").length,
  });

  return {
    ankiResults: results,
    identityWritesApplied,
    lints,
    ...(mediaErrors.length > 0 ? { mediaErrors } : {}),
    notePath: note.path,
    parsedCardCount: cards.length,
    recoveredMissingCount,
    status: "ok",
    writebackEditsApplied: writeback.edits.length,
  };
}
