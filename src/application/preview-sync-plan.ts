import type { Flashcard, IdentifiedFlashcard } from "../core/domain/card.js";
import { computeCardHash, computeCueHash } from "../core/edits/card-hash.js";
import type { TextEdit } from "../core/edits/apply-text-edits.js";
import { insertCardAnchors } from "../core/edits/insert-card-anchors.js";
import { extractCardsFromMarkdown } from "../core/parse/extract-cards.js";
import { buildSyncPlan } from "../core/sync/build-sync-plan.js";
import { parseCardFrontmatter } from "../core/sync/parse-card-frontmatter.js";
import type { ParsedCardFrontmatter } from "../core/sync/parse-card-frontmatter.js";
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
  frontmatter: ParsedCardFrontmatter;
  identifiedCards: IdentifiedFlashcard[];
  insertEdits: TextEdit[];
  lints: string[];
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

  const extracted = extractCardsFromMarkdown(markdown, {
    notePath,
    settings,
  });
  const { cards } = extracted;
  const lints = [...extracted.lints, ...extracted.warnings];
  const frontmatter = parseCardFrontmatter(markdown);

  if (cards.length === 0) {
    // Final-review fix #2 (spec §4.2): a note that previously synced an
    // atomic card can be edited down to zero extracted cards (thin note, or
    // the `test:` key removed) while its frontmatter still carries a
    // cue-bearing entry with a live `nid`. That orphan must still reach
    // delete-safety, so we fall through to plan-building (with an empty
    // card set) instead of short-circuiting. Legacy zero-card notes that
    // never had a cue entry keep the unconditional skip.
    const hasCueOrphan = frontmatter.entries.some(
      (e) => e.cue !== undefined && e.nid !== undefined,
    );
    if (!hasCueOrphan) {
      return {
        cards: [],
        create: 0,
        delete: 0,
        frontmatter,
        identifiedCards: [],
        insertEdits: [],
        lints,
        plan: { create: [], delete: [], update: [] },
        update: 0,
      };
    }
    const plan = buildSyncPlan({
      cards: [],
      computeHash: computeCardHash,
      frontmatter,
    });
    return {
      cards: [],
      create: plan.create.length,
      delete: plan.delete.length,
      frontmatter,
      identifiedCards: [],
      insertEdits: [],
      lints,
      plan,
      update: plan.update.length,
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
    frontmatter.entries
      .filter((e) => e.cue !== undefined)
      .map((e) => [e.cue!, e]),
  );
  const identifiedCards = insert.cards.map((card) => {
    if (card.source.syntax !== "atomic") return card;
    // Computed ONCE here, from the raw extracted front — carried on the card
    // for every downstream stage (frontmatter writers, media rewrite) so it's
    // never recomputed from a front the media pipeline may have rewritten.
    const cue = computeCueHash(card.kind, card.front);
    const match = existingCueEntries.get(cue);
    return match
      ? { ...card, blockId: match.blockId, cue }
      : { ...card, cue };
  });

  const plan = buildSyncPlan({
    cards: identifiedCards,
    computeHash: computeCardHash,
    frontmatter,
  });

  return {
    cards,
    create: plan.create.length,
    delete: plan.delete.length,
    frontmatter,
    identifiedCards,
    insertEdits: insert.edits,
    lints,
    plan,
    update: plan.update.length,
  };
}
