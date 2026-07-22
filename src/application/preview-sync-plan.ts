import type { Flashcard, IdentifiedFlashcard } from "../core/domain/card.js";
import { computeCardHash, computeCueHash } from "../core/edits/card-hash.js";
import type { TextEdit } from "../core/edits/apply-text-edits.js";
import { insertCardAnchors } from "../core/edits/insert-card-anchors.js";
import { extractCardsFromMarkdown } from "../core/parse/extract-cards.js";
import { buildSyncPlan } from "../core/sync/build-sync-plan.js";
import { parseCardFrontmatter } from "../core/sync/parse-card-frontmatter.js";
import type { SyncPlan } from "../core/sync/sync-plan.js";
import type { FlashcardsSettings } from "../core/config/settings.js";

const BLOCK_ID_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

/**
 * Default v2 blockId generator: 4 chars from the Crockford-style alphabet
 * (omits `l, o, 0, 1`). Uses Math.random — sufficient for collision
 * resistance within a single note, and avoids `crypto.getRandomValues`
 * test-environment fragility.
 */
export function defaultGenerateBlockId(): string {
  let out = "q-";
  for (let i = 0; i < 4; i++) {
    const idx = Math.floor(Math.random() * BLOCK_ID_ALPHABET.length);
    out += BLOCK_ID_ALPHABET[idx];
  }
  return out;
}

export interface PreviewSyncPlanInput {
  generateBlockId?: () => string;
  markdown: string;
  notePath: string;
  settings: FlashcardsSettings;
}

export interface PreviewSyncPlanResult {
  cards: Flashcard[];
  create: number;
  delete: number;
  identifiedCards: IdentifiedFlashcard[];
  insertEdits: TextEdit[];
  plan: SyncPlan;
  update: number;
}

/**
 * Shared Phase A/B planning pipeline: extract → assign anchors → resolve
 * atomic-card identity by cue match → diff against frontmatter. Both
 * `syncNote` (which applies the resulting edits) and the status-bar preview
 * (in-memory only) MUST go through this single function so cue-matching
 * semantics can never diverge between the two call sites again (WI-9).
 */
export function previewSyncPlan(
  input: PreviewSyncPlanInput,
): PreviewSyncPlanResult {
  const {
    generateBlockId = defaultGenerateBlockId,
    markdown,
    notePath,
    settings,
  } = input;

  const { cards } = extractCardsFromMarkdown(markdown, { notePath, settings });

  if (cards.length === 0) {
    return {
      cards: [],
      create: 0,
      delete: 0,
      identifiedCards: [],
      insertEdits: [],
      plan: { create: [], delete: [], update: [] },
      update: 0,
    };
  }

  const insert = insertCardAnchors({ cards, generateBlockId, markdown });

  // WI-9 (I3/I4): atomic cards carry no body anchor, so their identity is
  // resolved by cue match against the note's existing `flashcards:` map —
  // before plan building, so a matched card inherits the entry's blockId
  // (and therefore its `nid`, preserving scheduling). Map construction over
  // an array iterates in file order, so a duplicate cue's LAST occurrence in
  // the frontmatter wins the tie-break (matches sync-note's own history).
  const existingCueEntries = new Map(
    parseCardFrontmatter(markdown)
      .entries.filter((e) => e.cue !== undefined)
      .map((e) => [e.cue!, e]),
  );
  const identifiedCards = insert.cards.map((card) => {
    if (card.source.syntax !== "atomic") return card;
    const cue = computeCueHash(card.kind, card.front);
    const match = existingCueEntries.get(cue);
    return match ? { ...card, blockId: match.blockId } : card;
  });

  const frontmatter = parseCardFrontmatter(markdown);
  const plan = buildSyncPlan({
    cards: identifiedCards,
    computeHash: computeCardHash,
    frontmatter,
  });

  return {
    cards,
    create: plan.create.length,
    delete: plan.delete.length,
    identifiedCards,
    insertEdits: insert.edits,
    plan,
    update: plan.update.length,
  };
}
