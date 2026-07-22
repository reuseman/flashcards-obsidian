import type { IdentifiedFlashcard } from "../domain/card.js";
import { parseNoteMetadata } from "../parse/note-metadata.js";
import type { TextEdit } from "./apply-text-edits.js";
import { computeCardHash, computeCueHash } from "./card-hash.js";

const V1_BLOCK_ID_RE = /^\d{13}$/;

export interface WriteCardFrontmatterOptions {
  cards: IdentifiedFlashcard[];
  markdown: string;
}

export interface WriteCardFrontmatterResult {
  edits: TextEdit[];
}

/**
 * Insert-only writer for the `flashcards:` frontmatter map.
 *
 * - v1 anchors (13 digits) are skipped.
 * - Existing entries are never overwritten (sync paths own that).
 * - If `flashcards:` doesn't exist yet, it is appended at the end of the
 *   existing frontmatter (preserving user-authored key order).
 * - If frontmatter is absent, a new block is prepended at the very top.
 *
 * Detection is line-based, not full YAML — see helper comments for limits.
 */
export function writeCardFrontmatter(
  options: WriteCardFrontmatterOptions,
): WriteCardFrontmatterResult {
  const { cards, markdown } = options;

  // Filter to v2 cards we'd consider writing.
  const candidates = cards.filter((c) => !V1_BLOCK_ID_RE.test(c.blockId));
  if (candidates.length === 0) return { edits: [] };

  const metadata = parseNoteMetadata(markdown);
  const fm = metadata.frontmatter;

  // Locate the `flashcards:` block (start line offset + end-of-sub-block offset).
  const flashcardsBlock = fm ? findFlashcardsBlock(markdown, fm.contentStart, fm.contentEnd) : null;

  // Existing entry keys under `flashcards:`.
  const existingKeys = flashcardsBlock
    ? collectEntryKeys(markdown.slice(flashcardsBlock.entriesStart, flashcardsBlock.entriesEnd))
    : new Set<string>();

  // Build new entries (dedup against existing).
  const newLines: string[] = [];
  for (const card of candidates) {
    if (existingKeys.has(card.blockId)) continue;
    const hash = computeCardHash(card);
    if (card.source.syntax === "atomic") {
      const cue = computeCueHash(card.kind, card.front);
      newLines.push(`  ${card.blockId}: { cue: ${cue}, hash: ${hash} }`);
    } else {
      newLines.push(`  ${card.blockId}: { hash: ${hash} }`);
    }
    existingKeys.add(card.blockId);
  }
  if (newLines.length === 0) return { edits: [] };

  // Case A: no frontmatter at all → prepend a fresh block.
  if (!fm) {
    const separator = markdown.length === 0 || markdown.startsWith("\n") ? "" : "\n\n";
    const text = `---\nflashcards:\n${newLines.join("\n")}\n---${separator}`;
    return { edits: [{ end: 0, start: 0, text }] };
  }

  // Case B: frontmatter exists with `flashcards:` key → insert at end of its sub-block.
  if (flashcardsBlock) {
    const insertAt = flashcardsBlock.entriesEnd;
    // entriesEnd is positioned at the newline that starts the next sibling
    // line (or at contentEnd). Insert `\n  q-xxxx: { hash: ... }` lines.
    const text = `\n${newLines.join("\n")}`;
    return { edits: [{ end: insertAt, start: insertAt, text }] };
  }

  // Case C: frontmatter exists but no `flashcards:` → append key at end.
  const insertAt = fm.contentEnd;
  const prefix = fm.raw.length === 0 || fm.raw.endsWith("\n") ? "" : "\n";
  const text = `${prefix}flashcards:\n${newLines.join("\n")}`;
  return { edits: [{ end: insertAt, start: insertAt, text }] };
}

interface FlashcardsBlock {
  // Offset right after the `flashcards:` line's trailing newline (start of first sub-entry).
  // If there are zero existing entries, entriesStart === entriesEnd.
  entriesEnd: number;
  entriesStart: number;
}

/**
 * Find the `flashcards:` key line in the frontmatter and the byte range of
 * its indented sub-block.
 *
 * Heuristic (intentional — not a full YAML parser):
 *  - The key line must match /^flashcards:\s*$/ at the start of a frontmatter line.
 *  - Sub-block continues while subsequent lines are indented (start with space/tab)
 *    or are empty. Stops at the first line at column 0 (a sibling key) or at
 *    the end of the frontmatter content.
 *
 * Limit: a `flashcards:` key whose value is on the same line (e.g.
 * `flashcards: {q-x: ...}`) is not handled — we treat it as "no block found"
 * and would append a new one, producing a duplicate key. No test exercises
 * this shape and the writer always emits the multi-line form.
 */
function findFlashcardsBlock(
  markdown: string,
  contentStart: number,
  contentEnd: number,
): FlashcardsBlock | null {
  const fmText = markdown.slice(contentStart, contentEnd);
  const lines = splitLinesWithOffsets(fmText);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!/^flashcards:\s*$/.test(line.text)) continue;

    // Sub-block starts at the line after the key line.
    const subBlockStart = contentStart + line.endOffset; // points just past `\n` (or to contentEnd)
    let entriesEnd = subBlockStart;
    for (let j = i + 1; j < lines.length; j++) {
      const sub = lines[j]!;
      // Indented line (space/tab) or blank → part of the block.
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

interface LineInfo {
  endOffset: number; // offset within the slice, just past the trailing `\n` (or === text length at EOF)
  startOffset: number;
  text: string;
}

function splitLinesWithOffsets(text: string): LineInfo[] {
  const out: LineInfo[] = [];
  let i = 0;
  while (i < text.length) {
    const nl = text.indexOf("\n", i);
    if (nl === -1) {
      out.push({ endOffset: text.length, startOffset: i, text: text.slice(i) });
      break;
    }
    out.push({ endOffset: nl + 1, startOffset: i, text: text.slice(i, nl) });
    i = nl + 1;
  }
  return out;
}

/**
 * Extract entry keys (the `q-xxxx` part of `  q-xxxx: ...`) from the indented
 * sub-block under `flashcards:`. Intentionally permissive — only the key part
 * matters for dedup; the value (object form, scalar shorthand) is ignored.
 */
function collectEntryKeys(subBlock: string): Set<string> {
  const keys = new Set<string>();
  for (const raw of subBlock.split("\n")) {
    const m = /^\s+([A-Za-z0-9_-]+)\s*:/.exec(raw);
    if (m && m[1]) keys.add(m[1]);
  }
  return keys;
}
