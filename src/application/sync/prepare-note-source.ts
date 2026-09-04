import type { FlashcardsSettings } from "../../core/config/settings.js";
import type { IdentifiedFlashcard } from "../../core/domain/card.js";
import { applyTextEdits } from "../../core/edits/apply-text-edits.js";
import { computeCardHash } from "../../core/edits/card-hash.js";
import { writeCardFrontmatter } from "../../core/edits/write-card-frontmatter.js";
import type { Logger } from "../../core/logging/logger.js";
import type { PerfTrace } from "../../core/logging/perf-trace.js";
import { buildSyncPlan } from "../../core/sync/build-sync-plan.js";
import type { ParsedCardFrontmatter } from "../../core/sync/parse-card-frontmatter.js";
import type { PendingRebind, SyncPlan } from "../../core/sync/sync-plan.js";
import {
  defaultGenerateBlockId,
  previewSyncPlan,
} from "../preview-sync-plan.js";
import type { MarkdownNote, MarkdownRepository } from "../ports.js";

export interface PreparedNoteSource {
  atomicCues: string[];
  frontmatter: ParsedCardFrontmatter;
  identifiedCards: IdentifiedFlashcard[];
  identityWritesApplied: number;
  lints: string[];
  markdown: string;
  parsedCardCount: number;
  plan: SyncPlan;
  skip: boolean;
}

export interface PrepareNoteSourceInput {
  confirmRebinds?: (pending: PendingRebind[]) => Promise<boolean>;
  generateBlockId?: () => string;
  logger: Logger;
  note: MarkdownNote;
  repository: MarkdownRepository;
  settings: FlashcardsSettings;
  trace: PerfTrace;
}

/** Parse a note, resolve source identity, and persist new identity metadata. */
export async function prepareNoteSource(
  input: PrepareNoteSourceInput,
): Promise<PreparedNoteSource> {
  const preview = input.trace.span("extract", () =>
    previewSyncPlan({
      generateBlockId: input.generateBlockId ?? defaultGenerateBlockId,
      markdown: input.note.markdown,
      notePath: input.note.path,
      settings: input.settings,
    }),
  );
  const { cards, frontmatter, identifiedCards, insertEdits, lints } = preview;
  const atomicCues = identifiedCards.flatMap((card) =>
    card.source.syntax === "atomic" && card.kind !== "cloze"
      ? [card.front.trim().toLowerCase().replace(/\s+/g, " ")]
      : [],
  );

  if (cards.length === 0 && preview.plan.delete.length === 0) {
    return {
      atomicCues,
      frontmatter,
      identifiedCards,
      identityWritesApplied: 0,
      lints,
      markdown: input.note.markdown,
      parsedCardCount: 0,
      plan: preview.plan,
      skip: true,
    };
  }

  const plan = await resolveConfirmedRebind({
    ...input,
    frontmatter,
    identifiedCards,
    plan: preview.plan,
  });
  const markdownWithAnchors = applyTextEdits(input.note.markdown, insertEdits);
  const frontmatterWrite = writeCardFrontmatter({
    cards: identifiedCards,
    markdown: markdownWithAnchors,
  });
  const markdown = applyTextEdits(markdownWithAnchors, frontmatterWrite.edits);

  if (markdown !== input.note.markdown) {
    await input.repository.saveNote(input.note, markdown);
  }

  return {
    atomicCues,
    frontmatter,
    identifiedCards,
    identityWritesApplied: insertEdits.length + frontmatterWrite.edits.length,
    lints,
    markdown,
    parsedCardCount: cards.length,
    plan,
    skip: false,
  };
}

interface ResolveRebindInput extends PrepareNoteSourceInput {
  frontmatter: ParsedCardFrontmatter;
  identifiedCards: IdentifiedFlashcard[];
  plan: SyncPlan;
}

async function resolveConfirmedRebind(
  input: ResolveRebindInput,
): Promise<SyncPlan> {
  const candidates = input.plan.rebinds ?? [];
  if (candidates.length !== 1) return input.plan;

  const confirmed = input.confirmRebinds
    ? await input.confirmRebinds(candidates)
    : false;
  if (!confirmed) return input.plan;

  const rebind = candidates[0]!;
  const createOp = input.plan.create.find(
    (operation) => operation.card.source.syntax === "atomic",
  )!;
  const cardIndex = input.identifiedCards.indexOf(createOp.card);
  if (cardIndex < 0) {
    input.logger.error(
      "syncNote rebind: createOp.card not found in identifiedCards",
      { notePath: input.note.path, blockId: rebind.blockId },
    );
    return input.plan;
  }

  input.identifiedCards[cardIndex] = {
    ...createOp.card,
    blockId: rebind.blockId,
  };
  return buildSyncPlan({
    cards: input.identifiedCards,
    computeHash: computeCardHash,
    frontmatter: input.frontmatter,
  });
}
