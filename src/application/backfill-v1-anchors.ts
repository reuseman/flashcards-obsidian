import type { FlashcardsSettings } from "../core/config/settings.js";
import type { Flashcard } from "../core/domain/card.js";
import type { TextEdit } from "../core/edits/apply-text-edits.js";
import { computeCardHash } from "../core/edits/card-hash.js";
import { extractCardsFromMarkdown } from "../core/parse/extract-cards.js";
import { parseCardFrontmatter } from "../core/sync/parse-card-frontmatter.js";
import { parseNoteMetadata } from "../core/parse/note-metadata.js";

export interface BackfillV1AnchorsInput {
  markdown: string;
  notePath: string;
  settings: FlashcardsSettings;
}

export interface BackfillV1AnchorsResult {
  backfilledCount: number;
  edits: TextEdit[];
}

const V1_ANCHOR_RE = /\^(\d{13})\b/g;

/**
 * Migrate v1 13-digit anchors (`^1234567890123`) into the v2 `flashcards:`
 * frontmatter map. Insert-only — never modifies existing entries.
 *
 * Matching rule: an anchor in the body counts when a parsed card's source
 * range contains the anchor's `^` position. Orphan anchors (no matching
 * parsed card, e.g. inside fenced code blocks) are skipped.
 */
export function backfillV1Anchors(
  input: BackfillV1AnchorsInput,
): BackfillV1AnchorsResult {
  const { markdown, notePath, settings } = input;

  const { cards } = extractCardsFromMarkdown(markdown, { notePath, settings });
  const bodyStart = frontmatterEnd(markdown);
  const existing = new Set(
    parseCardFrontmatter(markdown).entries.map((e) => e.blockId),
  );

  // Collect (blockId, card) pairs — unique by blockId, preserving order.
  const matches: { blockId: string; card: Flashcard }[] = [];
  const seen = new Set<string>();

  let m: RegExpExecArray | null;
  V1_ANCHOR_RE.lastIndex = 0;
  while ((m = V1_ANCHOR_RE.exec(markdown)) !== null) {
    const anchorPos = m.index;
    if (anchorPos < bodyStart) continue;
    const blockId = m[1]!;
    if (seen.has(blockId)) continue;
    if (existing.has(blockId)) {
      seen.add(blockId);
      continue;
    }
    const card = cards.find(
      (c) =>
        anchorPos >= c.source.startOffset && anchorPos < c.source.endOffset,
    );
    if (!card) continue; // orphan (e.g., inside fenced code block)
    seen.add(blockId);
    matches.push({ blockId, card });
  }

  if (matches.length === 0) {
    return { backfilledCount: 0, edits: [] };
  }

  const newLines = matches.map(
    ({ blockId, card }) =>
      `  "${blockId}": { hash: ${computeCardHash(card)} }`,
  );

  const edits = buildInsertEdits(markdown, newLines);
  return { backfilledCount: matches.length, edits };
}

function frontmatterEnd(markdown: string): number {
  const meta = parseNoteMetadata(markdown);
  return meta.frontmatter ? meta.frontmatter.end : 0;
}

function buildInsertEdits(markdown: string, newLines: string[]): TextEdit[] {
  const meta = parseNoteMetadata(markdown);
  const fm = meta.frontmatter;

  if (!fm) {
    const separator =
      markdown.length === 0 || markdown.startsWith("\n") ? "" : "\n\n";
    const text = `---\nflashcards:\n${newLines.join("\n")}\n---${separator}`;
    return [{ end: 0, start: 0, text }];
  }

  const block = findFlashcardsBlock(markdown, fm.contentStart, fm.contentEnd);
  if (block) {
    const text = `\n${newLines.join("\n")}`;
    return [{ end: block.entriesEnd, start: block.entriesEnd, text }];
  }

  const insertAt = fm.contentEnd;
  const prefix = fm.raw.length === 0 || fm.raw.endsWith("\n") ? "" : "\n";
  const text = `${prefix}flashcards:\n${newLines.join("\n")}`;
  return [{ end: insertAt, start: insertAt, text }];
}

interface FlashcardsBlock {
  entriesEnd: number;
  entriesStart: number;
}

function findFlashcardsBlock(
  markdown: string,
  contentStart: number,
  contentEnd: number,
): FlashcardsBlock | null {
  const fmText = markdown.slice(contentStart, contentEnd);
  let pos = 0;
  const lines: { text: string; startOffset: number; endOffset: number }[] = [];
  while (pos < fmText.length) {
    const nl = fmText.indexOf("\n", pos);
    if (nl === -1) {
      lines.push({
        endOffset: fmText.length,
        startOffset: pos,
        text: fmText.slice(pos),
      });
      break;
    }
    lines.push({
      endOffset: nl + 1,
      startOffset: pos,
      text: fmText.slice(pos, nl),
    });
    pos = nl + 1;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!/^flashcards:\s*$/.test(line.text)) continue;
    const subBlockStart = contentStart + line.endOffset;
    let entriesEnd = subBlockStart;
    for (let j = i + 1; j < lines.length; j++) {
      const sub = lines[j]!;
      if (sub.text.length === 0 || /^[ \t]/.test(sub.text)) {
        entriesEnd = contentStart + sub.endOffset;
        continue;
      }
      break;
    }
    return { entriesEnd, entriesStart: subBlockStart };
  }
  return null;
}
