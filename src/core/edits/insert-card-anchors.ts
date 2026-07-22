import type { Flashcard, IdentifiedFlashcard } from "../domain/card.js";
import type { TextEdit } from "./apply-text-edits.js";

const BLOCK_ID_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
const V2_ANCHOR_RE = /\^q-[abcdefghijkmnpqrstuvwxyz23456789]{4}\b/;
const V1_ANCHOR_RE = /\^\d{13}\b/;
const V2_ANCHOR_AT_END_RE = /\^q-[abcdefghijkmnpqrstuvwxyz23456789]{4}$/;
const V1_ANCHOR_AT_END_RE = /\^\d{13}$/;
const V2_ANCHOR_GLOBAL_RE = /\^q-[abcdefghijkmnpqrstuvwxyz23456789]{4}\b/g;

export interface InsertCardAnchorsOptions {
  cards: Flashcard[];
  generateBlockId?: () => string;
  markdown: string;
}

export interface InsertCardAnchorsResult {
  cards: IdentifiedFlashcard[];
  edits: TextEdit[];
}

export function insertCardAnchors(
  options: InsertCardAnchorsOptions,
): InsertCardAnchorsResult {
  const { cards, markdown } = options;
  const generate = options.generateBlockId ?? defaultGenerator;

  const usedIds = collectExistingIds(markdown);
  const edits: TextEdit[] = [];
  const outCards: IdentifiedFlashcard[] = [];

  for (const card of cards) {
    // I3 (WI-9): atomic cards never touch the note body — identity lives
    // only in the `flashcards:` map, matched by cue in the application layer.
    if (card.source.syntax === "atomic") {
      let candidate = generate();
      while (usedIds.has(candidate)) {
        candidate = generate();
      }
      usedIds.add(candidate);
      outCards.push({ ...card, blockId: candidate });
      continue;
    }

    const existing = findExistingAnchor(markdown, card);
    if (existing) {
      usedIds.add(existing.blockId);
      outCards.push({ ...card, blockId: existing.blockId });
      continue;
    }

    let candidate = generate();
    while (usedIds.has(candidate)) {
      candidate = generate();
    }
    usedIds.add(candidate);

    edits.push(buildEdit(markdown, card, candidate));
    outCards.push({ ...card, blockId: candidate });
  }

  return { cards: outCards, edits };
}

function defaultGenerator(): string {
  let out = "q-";
  for (let i = 0; i < 4; i++) {
    const idx = Math.floor(Math.random() * BLOCK_ID_ALPHABET.length);
    out += BLOCK_ID_ALPHABET[idx];
  }
  return out;
}

function collectExistingIds(markdown: string): Set<string> {
  const ids = new Set<string>();
  const matches = markdown.match(V2_ANCHOR_GLOBAL_RE);
  if (matches) {
    for (const m of matches) ids.add(m.slice(1)); // strip leading `^`
  }
  return ids;
}

interface ExistingAnchor {
  blockId: string;
}

function findExistingAnchor(
  markdown: string,
  card: Flashcard,
): ExistingAnchor | null {
  const text = markdown.slice(card.source.startOffset, card.source.endOffset);
  const trimmed = text.replace(/\s+$/, "");

  const v2 = trimmed.match(V2_ANCHOR_AT_END_RE);
  if (v2) return { blockId: v2[0].slice(1) };

  const v1 = trimmed.match(V1_ANCHOR_AT_END_RE);
  if (v1) return { blockId: v1[0].slice(1) };

  // Own-line anchor on the line immediately after the content block.
  const after = markdown.slice(card.source.endOffset);
  const m = /^\n(\^q-[abcdefghijkmnpqrstuvwxyz23456789]{4}|\^\d{13})\b/.exec(after);
  if (m) return { blockId: m[1]!.slice(1) };

  return null;
}

function buildEdit(markdown: string, card: Flashcard, blockId: string): TextEdit {
  // §4.3.3: a `#card` multi-paragraph answer ends its source range on a bare
  // `^` terminator line — replace that `^` with `^<id>` so identity lives on
  // the terminator line, not a duplicated anchor below it.
  const text = markdown.slice(card.source.startOffset, card.source.endOffset);
  const bareCaret = /(^|\n)\^[ \t]*$/.exec(text);
  if (bareCaret) {
    const caretStart = card.source.startOffset + bareCaret.index + bareCaret[1]!.length;
    return {
      end: card.source.endOffset,
      start: caretStart,
      text: `^${blockId}`,
    };
  }

  // WI-1: every card's identity anchor lives on its own line, immediately
  // after the content block, for all other cases.
  return {
    end: card.source.endOffset,
    start: card.source.endOffset,
    text: `\n^${blockId}`,
  };
}

export const __INTERNAL = { V1_ANCHOR_RE, V2_ANCHOR_RE };
