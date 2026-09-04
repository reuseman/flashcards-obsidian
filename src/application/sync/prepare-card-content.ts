import type { FlashcardsSettings } from "../../core/config/settings.js";
import type { IdentifiedFlashcard } from "../../core/domain/card.js";
import { computeRenderedFieldsHash } from "../../core/edits/card-hash.js";
import type { Logger } from "../../core/logging/logger.js";
import type { PerfTrace } from "../../core/logging/perf-trace.js";
import {
  extractMedia,
  type MediaRef,
} from "../../core/render/extract-media.js";
import {
  renderCardForAnki,
  type RenderedCard,
} from "../../core/render/render-card.js";
import {
  rewriteMedia,
  type MediaRewriteMap,
} from "../../core/render/rewrite-media.js";
import type { SyncPlan } from "../../core/sync/sync-plan.js";

const HAS_WIKILINK_RE = /!?\[\[[^\]\r\n]+\]\]/;

export interface MediaResolutionError {
  filename: string;
  reason: "not-found" | "read-failed";
}

export interface MediaPipelineResult {
  rewriteMap: MediaRewriteMap;
  errors: MediaResolutionError[];
  /** Upload resolved bytes only when at least one Anki field needs them. */
  upload?: () => Promise<void>;
}

export type MediaPipeline = (
  refs: MediaRef[],
  sourcePath: string,
) => Promise<MediaPipelineResult>;

export interface CardMediaError {
  blockId: string;
  errors: MediaResolutionError[];
}

export interface PreparedCardContent {
  desiredFieldHashes: ReadonlyMap<string, string>;
  hasDynamicDependencies: boolean;
  preparedCardsByBlockId: ReadonlyMap<string, IdentifiedFlashcard>;
  refs: MediaRef[];
  renderedCardsByBlockId: ReadonlyMap<string, RenderedCard>;
  resolutionErrors: MediaResolutionError[];
  upload?: () => Promise<void>;
}

interface PrepareCardContentInput {
  cards: IdentifiedFlashcard[];
  markdown: string;
  mediaPipeline?: MediaPipeline;
  notePath: string;
  resolveLink?: (target: string, sourcePath: string) => string | null;
  settings: FlashcardsSettings;
  trace: PerfTrace;
  vaultName: string;
}

/** Resolve dynamic content and render every desired Anki field once. */
export async function prepareCardContent(
  input: PrepareCardContentInput,
): Promise<PreparedCardContent> {
  const refs = input.trace.span("media.resolve", () =>
    extractMedia(input.markdown),
  );
  const media =
    input.mediaPipeline && refs.length > 0
      ? await input.trace.span("media.prepare", () =>
          input.mediaPipeline!(refs, input.notePath),
        )
      : { errors: [], rewriteMap: {} };

  const preparedCardsByBlockId = new Map(
    input.cards.map((card) => [
      card.blockId,
      {
        ...card,
        answer: rewriteMedia(card.answer, media.rewriteMap),
        ...(card.context !== undefined
          ? { context: rewriteMedia(card.context, media.rewriteMap) }
          : {}),
        front: rewriteMedia(card.front, media.rewriteMap),
      },
    ]),
  );
  const renderedCardsByBlockId = new Map(
    [...preparedCardsByBlockId].map(([blockId, card]) => [
      blockId,
      renderCardForAnki(card, {
        deckName: card.deckName ?? "",
        highlightClozeEnabled: input.settings.highlightCloze.enabled,
        notePath: input.notePath,
        tags: card.tags,
        vaultName: input.vaultName,
        ...(input.resolveLink ? { resolveLink: input.resolveLink } : {}),
      }),
    ]),
  );
  const desiredFieldHashes = new Map(
    [...renderedCardsByBlockId].map(([blockId, rendered]) => [
      blockId,
      computeRenderedFieldsHash(rendered.fields),
    ]),
  );

  return {
    desiredFieldHashes,
    hasDynamicDependencies:
      refs.length > 0 || HAS_WIKILINK_RE.test(input.markdown),
    preparedCardsByBlockId,
    refs,
    renderedCardsByBlockId,
    resolutionErrors: media.errors,
    ...(media.upload ? { upload: media.upload } : {}),
  };
}

/** Remove only operations whose source range contains unresolved media. */
export function dropCardsWithUnresolvedMedia(
  plan: SyncPlan,
  content: PreparedCardContent,
  logger: Logger,
): CardMediaError[] {
  if (content.resolutionErrors.length === 0) return [];

  const errorsByFilename = new Map(
    content.resolutionErrors.map((error) => [error.filename, error]),
  );
  const mediaErrors: CardMediaError[] = [];
  const keepResolvedCard = (operation: {
    card: IdentifiedFlashcard;
  }): boolean => {
    const errors = content.refs.flatMap((ref) => {
      if (
        ref.start < operation.card.source.startOffset ||
        ref.end > operation.card.source.endOffset
      ) {
        return [];
      }
      const error = errorsByFilename.get(ref.filename);
      return error ? [error] : [];
    });
    if (errors.length === 0) return true;

    mediaErrors.push({ blockId: operation.card.blockId, errors });
    logger.warn("card dropped: unresolved media", {
      blockId: operation.card.blockId,
      errors,
    });
    return false;
  };

  plan.create = plan.create.filter(keepResolvedCard);
  plan.update = plan.update.filter(keepResolvedCard);
  return mediaErrors;
}
