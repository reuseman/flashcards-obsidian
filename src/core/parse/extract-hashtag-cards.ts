import type { Heading, Paragraph, Root, RootContent } from "mdast";

import type { FlashcardsSettings } from "../config/settings.js";
import type { Flashcard } from "../domain/card.js";

export interface HashtagExtractContext {
  defaultTags: string[];
  metadataTags: string[];
  notePath: string;
  resolvedDeck: string;
}

export interface HashtagExtractResult {
  cards: Flashcard[];
  warnings: string[];
}

type CardKind = "basic" | "reversed";

interface TagSpec {
  kind: CardKind;
  tag: string;
}

interface Marker {
  before: string;
  kind: CardKind;
}

interface ParagraphMarker {
  answerStart: number;
  front: string;
  kind: CardKind;
  questionStart: number;
  standalone: boolean;
}

const TRAILING_ANCHOR_RE = /\s*\^(?:q-[abcdefghijkmnpqrstuvwxyz23456789]{4}|\d{13})\s*$/;

/**
 * Extract hashtag cards from top-level Markdown nodes.
 *
 * - A tagged heading owns its section through the next same/higher heading or
 *   explicit card.
 * - A tagged paragraph uses the text after its marker in that node, or exactly
 *   the next top-level node.
 * - Code, quotes, and comments are content because they are never inspected
 *   for control markers.
 */
export function extractHashtagCards(
  markdown: string,
  tree: Root,
  settings: FlashcardsSettings,
  context: HashtagExtractContext,
): HashtagExtractResult {
  if (!settings.hashtag.enabled) return { cards: [], warnings: [] };

  const basic = `#${settings.hashtag.basicTag}`;
  const specs: TagSpec[] = [
    { kind: "reversed", tag: `${basic}-reverse` },
    { kind: "reversed", tag: `${basic}/reverse` },
    { kind: "basic", tag: basic },
  ];
  const cards: Flashcard[] = [];
  const warnings: string[] = [];
  const children = tree.children;

  for (let index = 0; index < children.length; index++) {
    const node = children[index]!;
    if (node.type !== "heading" && node.type !== "paragraph") continue;

    if (node.type === "paragraph") {
      const raw = sliceNode(markdown, node);
      const markers = findParagraphMarkers(raw, specs);
      for (let markerIndex = 0; markerIndex < markers.length; markerIndex++) {
        const marker = markers[markerIndex]!;
        const nextMarker = markers[markerIndex + 1];
        let front = clean(marker.front);
        let sourceStart = offsetStart(node) + marker.questionStart;

        const previous = children[index - 1];
        if (
          marker.standalone &&
          front.length === 0 &&
          previous?.type === "heading"
        ) {
          const section = collectStandaloneHeadingSection(
            markdown,
            children,
            index,
            node,
            marker,
            previous,
            specs,
          );
          addCardOrWarning(
            cards,
            warnings,
            context,
            previous,
            marker.kind,
            cleanQuestionNode(markdown, previous),
            section.text,
            offsetStart(previous),
            section.endOffset,
          );
          continue;
        }

        let answer = clean(
          raw.slice(marker.answerStart, nextMarker?.questionStart ?? raw.length),
        );
        let sourceEnd = nextMarker
          ? offsetStart(node) + nextMarker.questionStart
          : offsetEnd(node);

        if (front.length === 0) {
          if (
            previous &&
            (previous.type === "paragraph" || previous.type === "heading")
          ) {
            front = cleanQuestionNode(markdown, previous);
            sourceStart = offsetStart(previous);
          }
        }

        if (answer.length === 0 && nextMarker === undefined) {
          const next = children[index + 1];
          if (next && !isExplicitCardStart(markdown, next, specs)) {
            answer = clean(sliceNode(markdown, next));
            sourceEnd = offsetEnd(next);
          }
        }

        addCardOrWarning(
          cards,
          warnings,
          context,
          node,
          marker.kind,
          front,
          answer,
          sourceStart,
          sourceEnd,
        );
      }
      continue;
    }

    const marker = findMarker(
      sliceNode(markdown, node),
      specs,
      true,
    );
    if (!marker) continue;

    const section = collectHeadingSection(
      markdown,
      children,
      index,
      node,
      specs,
    );
    addCardOrWarning(
      cards,
      warnings,
      context,
      node,
      marker.kind,
      clean(marker.before),
      section.text,
      offsetStart(node),
      section.endOffset,
    );
  }

  return { cards, warnings };
}

function addCardOrWarning(
  cards: Flashcard[],
  warnings: string[],
  context: HashtagExtractContext,
  node: Heading | Paragraph,
  kind: CardKind,
  front: string,
  answer: string,
  sourceStart: number,
  sourceEnd: number,
): void {
  if (front.length === 0 || answer.length === 0) {
    warnings.push(
      `Skipped #card in ${context.notePath}:${node.position?.start.line ?? 1}: empty ${
        front.length === 0 ? "question" : "answer"
      }.`,
    );
    return;
  }

  cards.push({
    answer,
    deckName: context.resolvedDeck,
    front,
    kind,
    source: {
      endOffset: sourceEnd,
      line: node.position?.start.line ?? 1,
      startOffset: sourceStart,
      syntax: "hashtag",
    },
    tags: [...new Set([...context.defaultTags, ...context.metadataTags])],
  });
}

function findParagraphMarkers(raw: string, specs: TagSpec[]): ParagraphMarker[] {
  const lines = splitLines(raw);
  const markers: ParagraphMarker[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]!;
    for (const spec of specs) {
      const tagIndex = trailingTagIndex(line.text, spec.tag);
      if (tagIndex < 0) continue;
      const inlineFront = line.text.slice(0, tagIndex).trimEnd();
      const previous = lines[lineIndex - 1];
      markers.push({
        answerStart: line.end,
        front: inlineFront.length > 0 ? inlineFront : (previous?.text ?? ""),
        kind: spec.kind,
        questionStart:
          inlineFront.length > 0 ? line.start : (previous?.start ?? line.start),
        standalone: inlineFront.length === 0,
      });
      break;
    }
  }

  return markers;
}

function collectStandaloneHeadingSection(
  markdown: string,
  children: RootContent[],
  markerIndex: number,
  markerNode: Paragraph,
  marker: ParagraphMarker,
  heading: Heading,
  specs: TagSpec[],
): { endOffset: number; text: string } {
  const answerStart = offsetStart(markerNode) + marker.answerStart;
  let endOffset = offsetEnd(markerNode);

  for (let index = markerIndex + 1; index < children.length; index++) {
    const candidate = children[index]!;
    if (candidate.type === "heading" && candidate.depth <= heading.depth) break;
    if (isExplicitCardStart(markdown, candidate, specs)) break;
    endOffset = offsetEnd(candidate);
  }

  return {
    endOffset,
    text: clean(markdown.slice(answerStart, endOffset)),
  };
}

function splitLines(raw: string): Array<{ end: number; start: number; text: string }> {
  const lines: Array<{ end: number; start: number; text: string }> = [];
  let start = 0;
  while (start <= raw.length) {
    const newline = raw.indexOf("\n", start);
    if (newline < 0) {
      lines.push({ end: raw.length, start, text: raw.slice(start) });
      break;
    }
    lines.push({ end: newline + 1, start, text: raw.slice(start, newline) });
    start = newline + 1;
  }
  return lines;
}

function collectHeadingSection(
  markdown: string,
  children: RootContent[],
  headingIndex: number,
  heading: Heading,
  specs: TagSpec[],
): { endOffset: number; text: string } {
  let first: RootContent | undefined;
  let last: RootContent | undefined;

  for (let index = headingIndex + 1; index < children.length; index++) {
    const candidate = children[index]!;
    if (candidate.type === "heading" && candidate.depth <= heading.depth) break;
    if (isExplicitCardStart(markdown, candidate, specs)) break;
    first ??= candidate;
    last = candidate;
  }

  if (!first || !last) {
    return { endOffset: offsetEnd(heading), text: "" };
  }

  return {
    endOffset: offsetEnd(last),
    text: clean(markdown.slice(offsetStart(first), offsetEnd(last))),
  };
}

function isExplicitCardStart(
  markdown: string,
  node: RootContent,
  specs: TagSpec[],
): boolean {
  if (node.type === "code" && node.lang === "flashcard") return true;
  if (node.type !== "heading" && node.type !== "paragraph") return false;
  return findMarker(
    sliceNode(markdown, node),
    specs,
    node.type === "heading",
  ) !== null;
}

function findMarker(
  rawNode: string,
  specs: TagSpec[],
  heading: boolean,
): Marker | null {
  const raw = heading ? rawNode.replace(/^#{1,6}[ \t]+/, "") : rawNode;
  const lines = raw.split("\n");
  let beforeLength = 0;

  for (const line of lines) {
    for (const spec of specs) {
      const index = trailingTagIndex(line, spec.tag);
      if (index < 0) continue;
      return {
        before: `${raw.slice(0, beforeLength)}${line.slice(0, index)}`,
        kind: spec.kind,
      };
    }
    beforeLength += line.length + 1;
  }

  return null;
}

function trailingTagIndex(line: string, tag: string): number {
  let from = 0;
  while (from <= line.length) {
    const index = line.indexOf(tag, from);
    if (index < 0) return -1;
    const before = index === 0 ? "" : line[index - 1]!;
    const after = line.slice(index + tag.length);
    if ((before === "" || /\s/.test(before)) && after.trim().length === 0) {
      return index;
    }
    from = index + 1;
  }
  return -1;
}

function cleanQuestionNode(markdown: string, node: Heading | Paragraph): string {
  const raw = sliceNode(markdown, node);
  return clean(
    node.type === "heading" ? raw.replace(/^#{1,6}[ \t]+/, "") : raw,
  );
}

function clean(value: string): string {
  return value.trim().replace(TRAILING_ANCHOR_RE, "");
}

function sliceNode(markdown: string, node: RootContent): string {
  return markdown.slice(offsetStart(node), offsetEnd(node));
}

function offsetStart(node: RootContent): number {
  return node.position?.start.offset ?? 0;
}

function offsetEnd(node: RootContent): number {
  return node.position?.end.offset ?? 0;
}
