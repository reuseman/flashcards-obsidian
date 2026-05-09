import type { Root } from "mdast";

import type { FlashcardsSettings } from "../config/settings.js";
import type { Flashcard } from "../domain/card.js";

export interface LegacyExtractContext {
  defaultTags: string[];
  metadataTags: string[];
  notePath: string;
  resolvedDeck: string;
}

interface LineInfo {
  endOffset: number;
  raw: string;
  startOffset: number;
}

type CardKind = "basic" | "reversed";

interface TagSpec {
  /** Tags whose presence on a line terminates this kind's answer. */
  answerTerminators: string[];
  kind: CardKind;
  /** The single tag string to match for question detection. */
  tag: string;
}

/**
 * Extracts legacy `#card` style flashcards, both basic and reversed.
 *
 * Reverse forms are `#{hashtagBasic}-reverse` and `#{hashtagBasic}/reverse`.
 *
 * Two shapes are recognised per tag:
 *   1. Separate-line: question line, then the tag alone on the next line.
 *   2. Inline-tag:    question text followed by the tag on the same line.
 *
 * The answer continues until: blank line, next heading, next same-kind tag, or
 * EOF. Termination is per-kind — a basic answer is not terminated by a reverse
 * tag and vice versa.
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

  const basic = `#${settings.legacy.hashtagBasic}`;
  const reverseDash = `${basic}-reverse`;
  const reverseSlash = `${basic}/reverse`;
  const reverseTags = [reverseDash, reverseSlash];

  // Order matters: try reverse forms before basic, because `indexOfStandaloneTag`
  // for `#card` would not match `#card-reverse` (suffix is non-whitespace), but
  // we still want to keep the kinds independent and ensure each line is at most
  // one card.
  const specs: TagSpec[] = [
    { answerTerminators: reverseTags, kind: "reversed", tag: reverseDash },
    { answerTerminators: reverseTags, kind: "reversed", tag: reverseSlash },
    { answerTerminators: [basic], kind: "basic", tag: basic },
  ];

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

    let matched: { advanceTo: number } | null = null;

    for (const spec of specs) {
      const inlineIdx = indexOfStandaloneTag(lineForMatch, spec.tag);

      if (inlineIdx >= 0) {
        const front = lineForMatch.slice(0, inlineIdx).replace(/\s+$/, "");
        if (front.length > 0) {
          const answer = collectAnswer(lines, i + 1, spec.answerTerminators, excluded);
          cards.push(makeCard(spec.kind, front, answer.text, line.startOffset, answer.endOffset, context));
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
            const answer = collectAnswer(lines, i + 2, spec.answerTerminators, excluded);
            cards.push(makeCard(spec.kind, front, answer.text, line.startOffset, answer.endOffset, context));
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

  return cards;
}

function makeCard(
  kind: CardKind,
  front: string,
  answer: string,
  startOffset: number,
  endOffset: number,
  context: LegacyExtractContext,
): Flashcard {
  return {
    answer,
    deckName: context.resolvedDeck,
    front,
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
  endOffset: number;
  nextIndex: number;
  text: string;
}

function collectAnswer(
  lines: LineInfo[],
  startIndex: number,
  terminators: string[],
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
    if (terminators.some((t) => indexOfStandaloneTag(line.raw, t) >= 0)) break;

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
