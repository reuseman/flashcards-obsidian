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
import { computeCardHash, computeCueHash } from "../core/edits/card-hash.js";
import { insertCardAnchors } from "../core/edits/insert-card-anchors.js";
import { writeCardFrontmatter } from "../core/edits/write-card-frontmatter.js";
import { writebackSyncResults } from "../core/edits/writeback-sync-results.js";
import { extractCardsFromMarkdown } from "../core/parse/extract-cards.js";
import { extractMedia, type MediaRef } from "../core/render/extract-media.js";
import {
  rewriteMedia,
  type MediaRewriteMap,
} from "../core/render/rewrite-media.js";
import { buildSyncPlan } from "../core/sync/build-sync-plan.js";
import { parseCardFrontmatter } from "../core/sync/parse-card-frontmatter.js";
import type { PendingDeletion } from "../core/sync/sync-plan.js";

/**
 * Outcome of the per-note media phase. `resolved` maps original short
 * filenames to their content-hashed final name + kind (image|audio); cards
 * whose refs touch an entry in `errors` are dropped from this run.
 *
 * The pipeline is responsible for uploading bytes to Anki — `syncNote` only
 * cares about the resolution outcome and the resulting rewrite map.
 */
export interface MediaPipelineResult {
  rewriteMap: MediaRewriteMap;
  errors: Array<{ filename: string; reason: "not-found" | "read-failed" }>;
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
  mediaErrors?: CardMediaError[];
  notePath: string;
  parsedCardCount: number;
  status: SyncNoteStatus;
  writebackEditsApplied: number;
}

const BLOCK_ID_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

/**
 * Default v2 blockId generator: 4 chars from the Crockford-style alphabet
 * (omits `l, o, 0, 1`). Uses Math.random — sufficient for collision
 * resistance within a single note, and avoids `crypto.getRandomValues`
 * test-environment fragility.
 */
function defaultGenerateBlockId(): string {
  let out = "q-";
  for (let i = 0; i < 4; i++) {
    const idx = Math.floor(Math.random() * BLOCK_ID_ALPHABET.length);
    out += BLOCK_ID_ALPHABET[idx];
  }
  return out;
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
  const { cards } = trace.span("extract", () =>
    extractCardsFromMarkdown(note.markdown, {
      notePath: note.path,
      settings,
    }),
  );

  if (cards.length === 0) {
    logger.debug("syncNote skipped (no flashcards parsed)", { notePath: note.path });
    return {
      identityWritesApplied: 0,
      notePath: note.path,
      parsedCardCount: 0,
      status: "skipped",
      writebackEditsApplied: 0,
    };
  }

  logger.debug("syncNote parsed cards", {
    notePath: note.path,
    parsedCardCount: cards.length,
  });

  const insert = insertCardAnchors({
    cards,
    generateBlockId,
    markdown: note.markdown,
  });
  const markdownA = applyTextEdits(note.markdown, insert.edits);

  // WI-9 (I3/I4): atomic cards carry no body anchor, so their identity is
  // resolved by cue match against the note's existing `flashcards:` map —
  // before plan building, so a matched card inherits the entry's blockId
  // (and therefore its `nid`, preserving scheduling).
  const existingCueEntries = new Map(
    parseCardFrontmatter(note.markdown)
      .entries.filter((e) => e.cue !== undefined)
      .map((e) => [e.cue!, e]),
  );
  const identifiedCards = insert.cards.map((card) => {
    if (card.source.syntax !== "atomic") return card;
    const cue = computeCueHash(card.kind, card.front);
    const match = existingCueEntries.get(cue);
    return match ? { ...card, blockId: match.blockId } : card;
  });

  const writeFm = writeCardFrontmatter({
    cards: identifiedCards,
    markdown: markdownA,
  });
  const markdownB = applyTextEdits(markdownA, writeFm.edits);

  const identityWritesApplied = insert.edits.length + writeFm.edits.length;

  if (markdownB !== note.markdown) {
    await repository.saveNote(note, markdownB);
  }

  // Phase B — diff and sync.
  const frontmatter = parseCardFrontmatter(markdownB);
  const plan = buildSyncPlan({
    cards: identifiedCards,
    computeHash: computeCardHash,
    frontmatter,
  });

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

  const empty =
    plan.create.length === 0 &&
    plan.update.length === 0 &&
    plan.delete.length === 0;

  if (empty) {
    logger.info("syncNote ok (no plan ops)", {
      notePath: note.path,
      identityWritesApplied,
    });
    return {
      identityWritesApplied,
      notePath: note.path,
      parsedCardCount: cards.length,
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

  // --- Media phase --------------------------------------------------------
  // Runs only when a `mediaPipeline` is wired in. Pure cores extract refs
  // from the *original* markdown (card source offsets reference that), the
  // pipeline resolves+uploads, and we apply `rewriteMedia` to each surviving
  // card's source text before it enters the renderer. Cards whose refs
  // collide with `errors` are dropped from create/update; deletes are
  // unaffected.
  const mediaErrors: CardMediaError[] = [];
  let mediaMap: MediaRewriteMap = {};
  if (input.mediaPipeline) {
    const allRefs = trace.span("media.resolve", () => extractMedia(note.markdown));
    if (allRefs.length > 0) {
      const outcome = await trace.span("media.upload", async () =>
        input.mediaPipeline!(allRefs, note.path),
      );
      mediaMap = outcome.rewriteMap;
      const erroredNames = new Set(outcome.errors.map((e) => e.filename));

      const cardHasError = (
        startOffset: number,
        endOffset: number,
      ): Array<{ filename: string; reason: "not-found" | "read-failed" }> => {
        const hits: Array<{
          filename: string;
          reason: "not-found" | "read-failed";
        }> = [];
        for (const ref of allRefs) {
          if (ref.start >= startOffset && ref.end <= endOffset) {
            if (erroredNames.has(ref.filename)) {
              const errEntry = outcome.errors.find(
                (e) => e.filename === ref.filename,
              );
              if (errEntry) hits.push(errEntry);
            }
          }
        }
        return hits;
      };

      plan.create = plan.create.filter((op) => {
        const errs = cardHasError(
          op.card.source.startOffset,
          op.card.source.endOffset,
        );
        if (errs.length > 0) {
          mediaErrors.push({ blockId: op.card.blockId, errors: errs });
          logger.warn("card dropped: unresolved media", {
            blockId: op.card.blockId,
            errors: errs,
          });
          return false;
        }
        return true;
      });
      plan.update = plan.update.filter((op) => {
        const errs = cardHasError(
          op.card.source.startOffset,
          op.card.source.endOffset,
        );
        if (errs.length > 0) {
          mediaErrors.push({ blockId: op.card.blockId, errors: errs });
          logger.warn("card dropped: unresolved media", {
            blockId: op.card.blockId,
            errors: errs,
          });
          return false;
        }
        return true;
      });

      // Apply rewrite to surviving cards. Card.front/answer are extracted
      // strings that already contain `![[file]]` substrings (for wikilink
      // images surviving mdast); markdown-image syntax `![](file)` is
      // already stripped at parse time, so rewriting is a no-op there.
      const applyRewrite = (s: string): string => rewriteMedia(s, mediaMap);
      for (const op of plan.create) {
        op.card = {
          ...op.card,
          front: applyRewrite(op.card.front),
          answer: applyRewrite(op.card.answer),
        };
      }
      for (const op of plan.update) {
        op.card = {
          ...op.card,
          front: applyRewrite(op.card.front),
          answer: applyRewrite(op.card.answer),
        };
      }
    }
  }

  // Short-circuit: media phase may have emptied the plan entirely.
  const stillEmpty =
    plan.create.length === 0 &&
    plan.update.length === 0 &&
    plan.delete.length === 0;
  if (stillEmpty) {
    logger.info("syncNote ok (no plan ops after media phase)", {
      notePath: note.path,
      identityWritesApplied,
      mediaErrors: mediaErrors.length,
    });
    return {
      identityWritesApplied,
      ...(mediaErrors.length > 0 ? { mediaErrors } : {}),
      notePath: note.path,
      parsedCardCount: cards.length,
      status: "ok",
      writebackEditsApplied: 0,
    };
  }

  let results: ExecuteSyncPlanResult;
  try {
    results = await trace.span("anki.sync", async () =>
      executeSyncPlan({
        client: ankiClient,
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
      notePath: note.path,
      parsedCardCount: cards.length,
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
    ...(mediaErrors.length > 0 ? { mediaErrors } : {}),
    notePath: note.path,
    parsedCardCount: cards.length,
    status: "ok",
    writebackEditsApplied: writeback.edits.length,
  };
}
