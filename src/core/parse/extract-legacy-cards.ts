import type { Root } from "mdast";

import type { FlashcardsSettings } from "../config/settings.js";
import type { Flashcard } from "../domain/card.js";

export interface LegacyExtractContext {
  defaultDeck: string;
  defaultTags: string[];
  metadataDeck?: string | null;
  metadataTags: string[];
  notePath: string;
}

interface LineInfo {
  endOffset: number;
  raw: string;
  startOffset: number;
}

/**
 * Extracts legacy `#card` style basic flashcards.
 *
 * Two shapes are recognised:
 *   1. Separate-line: question line, then `#card` alone on the next line.
 *   2. Inline-tag:    question text followed by `#card` on the same line.
 *
 * The answer continues until: blank line, next heading, next `#card`, or EOF.
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
): Flashcard[] {
  if (!settings.legacy.enabled) return [];

  const tag = `#${settings.legacy.hashtagBasic}`;
  const excluded = collectExcludedRanges(tree);
  const lines = splitLines(markdown);
  const cards: Flashcard[] = [];

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

    const inlineIdx = indexOfStandaloneTag(lineForMatch, tag);

    if (inlineIdx >= 0) {
      // Inline-tag shape on this line.
      const front = lineForMatch.slice(0, inlineIdx).replace(/\s+$/, "");
      if (front.length > 0) {
        const answer = collectAnswer(lines, i + 1, tag, excluded);
        cards.push(makeCard(front, answer.text, line.startOffset, answer.endOffset, context, settings));
        i = answer.nextIndex;
        continue;
      }
    }

    // Separate-line shape: current line is the question, next non-empty line is `#card` alone.
    if (line.raw.trim().length > 0 && i + 1 < lines.length) {
      const next = lines[i + 1]!;
      if (!isExcluded(next.startOffset, excluded) && next.raw.trim() === tag) {
        const front = (headingText ?? line.raw).replace(/\s+$/, "");
        if (front.length > 0) {
          const answer = collectAnswer(lines, i + 2, tag, excluded);
          cards.push(makeCard(front, answer.text, line.startOffset, answer.endOffset, context, settings));
          i = answer.nextIndex;
          continue;
        }
      }
    }

    i++;
  }

  return cards;
}

function makeCard(
  front: string,
  answer: string,
  startOffset: number,
  endOffset: number,
  context: LegacyExtractContext,
  _settings: FlashcardsSettings,
): Flashcard {
  return {
    answer,
    deckName: context.metadataDeck ?? context.defaultDeck,
    front,
    kind: "basic",
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
  endOffset: number;
  nextIndex: number;
  text: string;
}

function collectAnswer(
  lines: LineInfo[],
  startIndex: number,
  tag: string,
  excluded: Range[],
): CollectedAnswer {
  const collected: string[] = [];
  let endOffset = startIndex > 0 ? lines[startIndex - 1]!.endOffset : 0;
  let i = startIndex;
  while (i < lines.length) {
    const line = lines[i]!;
    if (isExcluded(line.startOffset, excluded)) break;
    const trimmed = line.raw.trim();
    if (trimmed.length === 0) break;
    if (/^#{1,6}\s+/.test(line.raw)) break;
    if (indexOfStandaloneTag(line.raw, tag) >= 0) break;

    collected.push(line.raw);
    endOffset = line.endOffset;
    i++;
  }
  return {
    endOffset,
    nextIndex: i,
    text: collected.join("\n").trim(),
  };
}

/** Returns the index of `#tag` as a standalone token, or -1. */
function indexOfStandaloneTag(line: string, tag: string): number {
  let from = 0;
  while (from <= line.length) {
    const idx = line.indexOf(tag, from);
    if (idx < 0) return -1;
    const before = idx === 0 ? "" : line[idx - 1]!;
    const afterPos = idx + tag.length;
    const after = afterPos >= line.length ? "" : line[afterPos]!;
    const beforeOk = before === "" || /\s/.test(before);
    const afterOk = after === "" || /\s/.test(after);
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
