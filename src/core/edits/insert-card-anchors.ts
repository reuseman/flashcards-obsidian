import type { Flashcard, IdentifiedFlashcard } from "../domain/card.js";
import { parseMarkdownTree } from "../parse/markdown-tree.js";
import type { TextEdit } from "./apply-text-edits.js";

const BLOCK_ID_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
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

    const existing = findExistingAnchor(markdown, card, cards);
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
  cards: Flashcard[],
): ExistingAnchor | null {
  const text = markdown.slice(card.source.startOffset, card.source.endOffset);
  const trimmed = text.replace(/\s+$/, "");

  const v2 = trimmed.match(V2_ANCHOR_AT_END_RE);
  if (v2) return { blockId: v2[0].slice(1) };

  const v1 = trimmed.match(V1_ANCHOR_AT_END_RE);
  if (v1) return { blockId: v1[0].slice(1) };

  // Formatters separate table block IDs with a blank line. Only accept a
  // whole anchor line, without crossing content belonging to another card.
  const after = markdown.slice(card.source.endOffset);
  const m = /^\r?\n(?:[ \t]*\r?\n)?(\^q-[abcdefghijkmnpqrstuvwxyz23456789]{4}|\^\d{13})[ \t]*(?=\r?\n|$)/.exec(after);
  if (m) {
    if (/^\r?\n[ \t]*\r?\n/.test(after)) {
      // A separated ID must be its own block, not the first line of some
      // following prose. Parse just its next line to retain Markdown block
      // boundaries (e.g. a heading can follow without another blank line).
      const followingLine = after.slice(m[0].length).split(/\r?\n/, 2)[1] ?? "";
      const block = parseMarkdownTree(`${m[1]}\n${followingLine}`).children[0];
      if (block?.type !== "paragraph" || block.position?.end.offset !== m[1]!.length) {
        return null;
      }
    }
    const anchorStart = card.source.endOffset + m[0].indexOf("^");
    const belongsToAnotherCard = cards.some((other) =>
      other !== card &&
      other.source.startOffset <= anchorStart &&
      anchorStart < other.source.endOffset,
    );
    if (!belongsToAnotherCard) return { blockId: m[1]!.slice(1) };
  }

  return null;
}

function endsWithTable(text: string): boolean {
  const lines = text.trimEnd().split(/\r?\n/);
  for (let i = lines.length - 1; i > 0; i--) {
    const line = lines[i]!;
    if (line.trim() === "") break;
    if (
      line.includes("|") &&
      /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/.test(line) &&
      lines[i - 1]!.includes("|") &&
      lines.slice(i + 1).every((row) => row.includes("|"))
    ) {
      return true;
    }
  }
  return false;
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

  // A blank line keeps a table's block ID out of its final row. Other card
  // forms retain their existing immediate own-line placement.
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  return {
    end: card.source.endOffset,
    start: card.source.endOffset,
    text: `${newline.repeat(endsWithTable(text) ? 2 : 1)}^${blockId}`,
  };
}
