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

  // For fenced cards, look at the line immediately after the closing fence.
  if (card.source.syntax === "fenced") {
    const after = markdown.slice(card.source.endOffset);
    const m = /^\n(\^q-[abcdefghijkmnpqrstuvwxyz23456789]{4}|\^\d{13})\b/.exec(after);
    if (m) return { blockId: m[1]!.slice(1) };
  }

  return null;
}

function buildEdit(markdown: string, card: Flashcard, blockId: string): TextEdit {
  if (card.source.syntax === "fenced") {
    // Insert `\n^q-xxxx` immediately after the closing fence's last char.
    // Works for both `\`\`\`\n...` (becomes `\`\`\`\n^q-xxxx\n...`) and EOF.
    return {
      end: card.source.endOffset,
      start: card.source.endOffset,
      text: `\n^${blockId}`,
    };
  }

  // inline / cloze / legacy-hashtag: append on the last line of the range,
  // right-trimming trailing whitespace and prefixing with a single space.
  const text = markdown.slice(card.source.startOffset, card.source.endOffset);
  const trimmed = text.replace(/\s+$/, "");
  const trimEnd = card.source.startOffset + trimmed.length;
  return {
    end: card.source.endOffset,
    start: trimEnd,
    text: ` ^${blockId}`,
  };
}

export const __INTERNAL = { V1_ANCHOR_RE, V2_ANCHOR_RE };
