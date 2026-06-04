import type { Root } from "mdast";

import type { FlashcardsSettings } from "../config/settings.js";
import type { Flashcard } from "../domain/card.js";

export interface LegacyExtractContext {
  defaultTags: string[];
  metadataTags: string[];
  notePath: string;
  resolvedDeck: string;
}

export interface LegacyExtractResult {
  cards: Flashcard[];
  warnings: string[];
}

interface LineInfo {
  endOffset: number;
  raw: string;
  startOffset: number;
}

type CardKind = "basic" | "reversed";

interface TagSpec {
  kind: CardKind;
  /** The single tag string to match for question detection. */
  tag: string;
}

const TERMINATOR_ANCHOR_RE = /^\^(?:|q-[abcdefghijkmnpqrstuvwxyz23456789]{4}|\d{13})$/;

/**
 * Extracts legacy `#card` style flashcards, both basic and reversed.
 *
 * Reverse forms are `#{hashtagBasic}-reverse` and `#{hashtagBasic}/reverse`.
 *
 * Two shapes are recognised per tag:
 *   1. Separate-line: question line, then the tag alone on the next line.
 *   2. Inline-tag:    question text followed by the tag on the same line.
 *
 * Answer collection follows the §4.3.2 deterministic model: the answer window is
 * bounded by the first excluded range, heading, or card-start; within it, a
 * terminator-anchor line (`^`, `^q-xxxx`, `^<13d>`) switches to multi-paragraph
 * mode, otherwise the answer stops at the first blank line.
 *
 * Excluded contexts (fenced code, HTML comments, blockquotes) are detected via
 * the mdast tree by collecting their source ranges and skipping any line whose
 * start offset falls inside one.
 */
export function extractLegacyHashtagCards(
  markdown: string,
  tree: Root,
  settings: FlashcardsSettings,
  context: LegacyExtractContext,
): LegacyExtractResult {
  if (!settings.legacy.enabled) return { cards: [], warnings: [] };

  const basic = `#${settings.legacy.hashtagBasic}`;
  const reverseDash = `${basic}-reverse`;
  const reverseSlash = `${basic}/reverse`;
  const allTags = [reverseDash, reverseSlash, basic];

  // Order matters: try reverse forms before basic, because the basic tag is a
  // prefix of the reverse forms.
  const specs: TagSpec[] = [
    { kind: "reversed", tag: reverseDash },
    { kind: "reversed", tag: reverseSlash },
    { kind: "basic", tag: basic },
  ];

  const excluded = collectExcludedRanges(tree);
  const lines = splitLines(markdown);
  const cards: Flashcard[] = [];
  const warnings: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (isExcluded(line.startOffset, excluded)) {
      i++;
      continue;
    }

    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line.raw);
    const headingText = headingMatch ? headingMatch[2]! : null;
    const lineForMatch = headingText ?? line.raw;

    let matched: { advanceTo: number } | null = null;

    for (const spec of specs) {
      const tailIdx = indexOfTrailingTag(lineForMatch, spec.tag);

      if (tailIdx >= 0) {
        const front = lineForMatch.slice(0, tailIdx).replace(/\s+$/, "");
        if (front.length > 0) {
          const answer = collectAnswer(lines, i + 1, allTags, excluded, line.startOffset);
          if (answer.empty) {
            warnings.push(emptyWarning(front));
          } else {
            cards.push(makeCard(spec.kind, front, answer.text, line.startOffset, answer.endOffset, context));
          }
          matched = { advanceTo: answer.nextIndex };
          break;
        }
      }

      // Separate-line shape: current line is the question, next non-empty line is the tag alone.
      if (line.raw.trim().length > 0 && i + 1 < lines.length) {
        const next = lines[i + 1]!;
        if (!isExcluded(next.startOffset, excluded) && next.raw.trim() === spec.tag) {
          const front = (headingText ?? line.raw).replace(/\s+$/, "");
          if (front.length > 0) {
            const answer = collectAnswer(lines, i + 2, allTags, excluded, line.startOffset);
            if (answer.empty) {
              warnings.push(emptyWarning(front));
            } else {
              cards.push(makeCard(spec.kind, front, answer.text, line.startOffset, answer.endOffset, context));
            }
            matched = { advanceTo: answer.nextIndex };
            break;
          }
        }
      }
    }

    if (matched) {
      i = matched.advanceTo;
      continue;
    }

    i++;
  }

  return { cards, warnings };
}

function emptyWarning(front: string): string {
  return `Skipped #card "${front}": empty answer (nothing between the tag and the next blank line, terminator, or boundary).`;
}

const TRAILING_ANCHOR_RE = /\s*\^(?:q-[abcdefghijkmnpqrstuvwxyz23456789]{4}|\d{13})\s*$/;

function makeCard(
  kind: CardKind,
  front: string,
  answer: string,
  startOffset: number,
  endOffset: number,
  context: LegacyExtractContext,
): Flashcard {
  return {
    answer: answer.replace(TRAILING_ANCHOR_RE, ""),
    deckName: context.resolvedDeck,
    front: front.replace(TRAILING_ANCHOR_RE, ""),
    kind,
    source: {
      endOffset,
      line: 1,
      startOffset,
      syntax: "legacy-hashtag",
    },
    tags: [...new Set([...context.defaultTags, ...context.metadataTags])],
  };
}

interface CollectedAnswer {
  empty: boolean;
  endOffset: number;
  nextIndex: number;
  text: string;
}

/**
 * §4.3.2 answer-collection algorithm. `allTags` is the full `#card`-family tag
 * set used for card-start detection (window bounding), independent of the kind
 * of the card currently being collected.
 */
function collectAnswer(
  lines: LineInfo[],
  startIndex: number,
  allTags: string[],
  excluded: Range[],
  fallbackEndOffset: number,
): CollectedAnswer {
  // Step 1: window upper bound (exclusive).
  let windowEnd = startIndex;
  while (windowEnd < lines.length) {
    const line = lines[windowEnd]!;
    if (isExcluded(line.startOffset, excluded)) break;
    if (/^#{1,6}\s+/.test(line.raw)) break;
    if (isCardStart(line.raw, allTags)) break;
    windowEnd++;
  }

  // Step 2: search for a terminator-anchor line within the window.
  let terminatorIdx = -1;
  for (let j = startIndex; j < windowEnd; j++) {
    if (TERMINATOR_ANCHOR_RE.test(lines[j]!.raw.trim())) {
      terminatorIdx = j;
      break;
    }
  }

  if (terminatorIdx >= 0) {
    const body = lines.slice(startIndex, terminatorIdx).map((l) => l.raw).join("\n");
    const text = body.trim().replace(TRAILING_ANCHOR_RE, "");
    // Extend the source range to include the terminator line so WI-1 can read
    // an existing anchor there or replace a bare `^`.
    const endOffset = lines[terminatorIdx]!.endOffset;
    return {
      empty: text.length === 0,
      endOffset,
      nextIndex: terminatorIdx + 1,
      text,
    };
  }

  // Single-block mode: stop at the first blank line (or window end).
  const collected: string[] = [];
  let endOffset = startIndex > 0 ? lines[startIndex - 1]!.endOffset : fallbackEndOffset;
  let i = startIndex;
  while (i < windowEnd) {
    const line = lines[i]!;
    if (line.raw.trim().length === 0) break;
    collected.push(line.raw);
    endOffset = line.endOffset;
    i++;
  }
  const text = collected.join("\n").trim().replace(TRAILING_ANCHOR_RE, "");
  return {
    empty: text.length === 0,
    endOffset,
    nextIndex: i,
    text,
  };
}

/**
 * Card-start (§4.3.1): a line whose only non-whitespace token is a `#card`-family
 * tag, or a line ending with a `#card`-family tag as its last non-whitespace
 * token with non-empty text before it. A tag with trailing text is prose (R5).
 */
function isCardStart(raw: string, tags: string[]): boolean {
  const heading = /^(#{1,6})\s+(.*)$/.exec(raw);
  const lineForMatch = heading ? heading[2]! : raw;
  return tags.some((t) => indexOfTrailingTag(lineForMatch, t) >= 0);
}

/**
 * Index of `tag` if it is the last non-whitespace token on the line (standalone
 * or trailing), else -1. A tag with further non-whitespace text after it is not
 * matched (R5: it is body content).
 */
function indexOfTrailingTag(line: string, tag: string): number {
  let from = 0;
  while (from <= line.length) {
    const idx = line.indexOf(tag, from);
    if (idx < 0) return -1;
    const before = idx === 0 ? "" : line[idx - 1]!;
    const afterPos = idx + tag.length;
    const after = line.slice(afterPos);
    const beforeOk = before === "" || /\s/.test(before);
    const afterOk = after.trim().length === 0;
    if (beforeOk && afterOk) return idx;
    from = idx + 1;
  }
  return -1;
}

interface Range {
  end: number;
  start: number;
}

function collectExcludedRanges(tree: Root): Range[] {
  const ranges: Range[] = [];
  for (const node of tree.children) {
    if (
      node.type === "code" ||
      node.type === "html" ||
      node.type === "blockquote"
    ) {
      const start = node.position?.start.offset ?? 0;
      const end = node.position?.end.offset ?? start;
      ranges.push({ end, start });
    }
  }
  return ranges;
}

function isExcluded(offset: number, ranges: Range[]): boolean {
  for (const range of ranges) {
    if (offset >= range.start && offset < range.end) return true;
  }
  return false;
}

function splitLines(markdown: string): LineInfo[] {
  const lines: LineInfo[] = [];
  let offset = 0;
  let cursor = 0;
  while (cursor <= markdown.length) {
    const nl = markdown.indexOf("\n", cursor);
    if (nl < 0) {
      const raw = markdown.slice(cursor);
      lines.push({ endOffset: markdown.length, raw, startOffset: offset });
      break;
    }
    const raw = markdown.slice(cursor, nl);
    lines.push({ endOffset: nl, raw, startOffset: offset });
    offset = nl + 1;
    cursor = nl + 1;
  }
  return lines;
}
