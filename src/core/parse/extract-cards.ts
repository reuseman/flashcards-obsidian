import type {
  Heading,
  List,
  ListItem,
  Nodes,
  Paragraph,
  Parent,
  PhrasingContent,
  Root,
  RootContent,
} from "mdast";
import { visit } from "unist-util-visit";

import type { FlashcardsSettings } from "../config/settings.js";
import type { Flashcard } from "../domain/card.js";
import { intersectsSpan, type Span } from "./cloze-spans.js";
import { parseClozeSyntax } from "./cloze-syntax.js";
import { extractAtomicCards } from "./extract-atomic-cards.js";
import { extractHashtagCards } from "./extract-hashtag-cards.js";
import {
  collectProtectedMarkdownSpans,
  parseMarkdownTree,
} from "./markdown-tree.js";
import { parseNoteMetadata } from "./note-metadata.js";

export interface ExtractCardsOptions {
  notePath: string;
  settings: FlashcardsSettings;
}

export interface ExtractCardsResult {
  cards: Flashcard[];
  lints: string[];
  warnings: string[];
}

export function extractCardsFromMarkdown(
  markdown: string,
  options: ExtractCardsOptions,
): ExtractCardsResult {
  const cards: Flashcard[] = [];
  const warnings: string[] = [];
  const metadata = parseNoteMetadata(markdown);
  const suppressBodyScans =
    options.settings.atomic.enabled && hasTestKey(metadata.frontmatter?.raw);
  const resolvedDeck = resolveDeckName(
    options.notePath,
    options.settings,
    metadata.cardDeck,
  );
  const folderTag = options.settings.folderBasedTags
    ? folderHierarchyFromPath(options.notePath)
    : null;
  const resolvedTags = mergeTags(
    options.settings.defaultTags,
    metadata.tags,
    folderTag === null ? [] : [folderTag],
  );
  const tree = parseMarkdownTree(markdown);

  // Explicit containers are extracted first so their source ranges can block
  // lower-precedence syntaxes inside their content. Atomic owns its first
  // paragraph before hashtag gets a chance to claim the same text.
  const atomic = extractAtomicCards(
    metadata.frontmatter,
    tree,
    markdown,
    options.settings.atomic.enabled,
    {
      notePath: options.notePath,
      resolvedDeck,
      tags: resolvedTags,
    },
    options.settings.highlightCloze.enabled,
  );
  cards.push(...atomic.cards);

  const callout = extractCalloutCards(
    markdown,
    tree,
    options.notePath,
    resolvedDeck,
    resolvedTags,
  );
  const atomicRanges = atomic.cards.map((card) => ({
    end: card.source.endOffset,
    start: card.source.startOffset,
  }));
  const acceptedCalloutCards = callout.cards.filter(
    (card) =>
      !intersectsSpan(
        card.source.startOffset,
        card.source.endOffset,
        atomicRanges,
      ),
  );
  cards.push(...acceptedCalloutCards);
  warnings.push(...callout.warnings);

  const hashtag = extractHashtagCards(markdown, tree, options.settings, {
    defaultTags: resolvedTags,
    metadataTags: [],
    notePath: options.notePath,
    resolvedDeck,
  });
  const higherPrecedenceRanges = [...atomic.cards, ...acceptedCalloutCards].map((card) => ({
    end: card.source.endOffset,
    start: card.source.startOffset,
  }));
  const acceptedHashtagCards = hashtag.cards.filter(
    (card) =>
      !intersectsSpan(
        card.source.startOffset,
        card.source.endOffset,
        higherPrecedenceRanges,
      ),
  );
  cards.push(...acceptedHashtagCards);
  warnings.push(...hashtag.warnings);

  const explicitRanges = [
    ...acceptedHashtagCards,
    ...acceptedCalloutCards,
    ...atomic.cards,
  ].map((card) => ({
    end: card.source.endOffset,
    start: card.source.startOffset,
  }));
  const listCards = suppressBodyScans
    ? []
    : extractListCards(
        markdown,
        tree,
        options.settings,
        resolvedDeck,
        resolvedTags,
        explicitRanges,
      );
  cards.push(...listCards);
  const claimedRanges = [...explicitRanges, ...listCards.map((card) => ({
    end: card.source.endOffset,
    start: card.source.startOffset,
  }))];
  const blockquoteRanges = collectNodeRanges(tree, "blockquote");

  visit(tree, (node, _index, parent) => {
    if (node.type === "code" && node.lang === "flashcard" && options.settings.fenced.enabled) {
      const nodeStart = node.position?.start.offset ?? 0;
      const nodeEnd = node.position?.end.offset ?? 0;
      if (
        intersectsSpan(nodeStart, nodeEnd, explicitRanges) ||
        intersectsSpan(nodeStart, nodeEnd, blockquoteRanges)
      ) {
        return;
      }
      const fields = parseFencedFields(node.value ?? "");
      const front = fields.type === "reminder"
        ? fields.content ?? ""
        : fields.front ?? "";
      const back = fields.back ?? "";
      const type = fields.type || "basic";

      if (
        type !== "basic" &&
        type !== "reversed" &&
        type !== "cloze" &&
        type !== "reminder"
      ) {
        warnings.push(
          `Fenced flashcard block has unsupported \`type: ${type}\`; skipped.`,
        );
      } else if (!front) {
        warnings.push(
          type === "reminder"
            ? "Fenced reminder block missing required `content:` field; skipped."
            : "Fenced flashcard block missing required `front:` field; skipped.",
        );
      } else if (!back && type !== "cloze" && type !== "reminder") {
        warnings.push(
          "Fenced flashcard block missing required `back:` field; skipped.",
        );
      } else {
        cards.push({
          answer: back,
          deckName: resolvedDeck,
          front,
          kind: type === "cloze"
            ? "cloze"
            : type === "reversed"
              ? "reversed"
              : type === "reminder"
                ? "reminder"
                : "basic",
          source: {
            endOffset: node.position?.end.offset ?? 0,
            line: node.position?.start.line ?? 1,
            startOffset: node.position?.start.offset ?? 0,
            syntax: "fenced",
          },
          tags: resolvedTags,
        });
      }
    }

    if (node.type === "paragraph") {
      if (parent?.type === "blockquote") {
        return;
      }
      const nodeStart = node.position?.start.offset ?? 0;
      const nodeEnd = node.position?.end.offset ?? 0;
      if (
        intersectsSpan(nodeStart, nodeEnd, claimedRanges) ||
        intersectsSpan(nodeStart, nodeEnd, blockquoteRanges)
      ) {
        return;
      }

      const paragraph = paragraphMarkdown(node, markdown);
      const value = stripTrailingAnchor(paragraph.value);
      const clozeSyntax = parseClozeSyntax(value, paragraph.protectedSpans, {
        auto: options.settings.highlightCloze.enabled,
      });
      if (options.settings.cloze.enabled && !suppressBodyScans) {
        for (const error of clozeSyntax.errors) {
          const relativeLine = value.slice(0, error.start).split("\n").length - 1;
          const line = (node.position?.start.line ?? 1) + relativeLine;
          warnings.push(
            `Malformed cloze in ${options.notePath}:${line}: ${error.message}.`,
          );
        }
      }
      const inline = options.settings.inline.enabled && !suppressBodyScans
        ? parseInlineCard(value, options.settings, paragraph.protectedSpans)
        : null;
      if (inline) {
        cards.push({
          answer: inline.answer,
          deckName: resolvedDeck,
          front: inline.front,
          kind: inline.kind,
          source: {
            endOffset: node.position?.end.offset ?? 0,
            line: node.position?.start.line ?? 1,
            startOffset: node.position?.start.offset ?? 0,
            syntax: inline.syntax,
          },
          tags: resolvedTags,
        });
      }

      const cloze = options.settings.cloze.enabled && !suppressBodyScans
        ? parseClozeCard(
            value,
            paragraph.protectedSpans,
            options.settings.highlightCloze.enabled,
          )
        : null;
      if (cloze) {
        cards.push({
          answer: "",
          deckName: resolvedDeck,
          front: cloze,
          kind: "cloze",
          source: {
            endOffset: node.position?.end.offset ?? 0,
            line: node.position?.start.line ?? 1,
            startOffset: node.position?.start.offset ?? 0,
            syntax: "cloze",
          },
          tags: resolvedTags,
        });
      }
    }
  });

  return {
    cards: applyContext(
      cards.sort((left, right) => left.source.startOffset - right.source.startOffset),
      tree,
      markdown,
      options,
    ),
    lints: atomic.lints,
    warnings,
  };
}

interface HeadingContext {
  offset: number;
  path: string[];
}

function applyContext(
  cards: Flashcard[],
  tree: Root,
  markdown: string,
  options: ExtractCardsOptions,
): Flashcard[] {
  if (options.settings.contextStrategy === "none") {
    return cards;
  }

  const separator = options.settings.contextSeparator.replaceAll("\\n", "\n");
  const headings = options.settings.contextStrategy === "headings"
    ? collectHeadingContexts(tree, markdown, options.settings)
    : [];
  const title = noteTitle(options.notePath);

  return cards.map((card) => {
    const context = options.settings.contextStrategy === "note-title"
      ? title
      : headingContextAt(headings, card.source.startOffset)?.join(separator) ?? "";

    if (!context || card.front === context) {
      return card;
    }

    return { ...card, context };
  });
}

function collectHeadingContexts(
  tree: Root,
  markdown: string,
  settings: FlashcardsSettings,
): HeadingContext[] {
  const result: HeadingContext[] = [];
  const stack: Array<{ depth: number; text: string }> = [];

  for (const node of tree.children) {
    if (node.type !== "heading") {
      continue;
    }

    while (stack.length > 0 && stack[stack.length - 1]!.depth >= node.depth) {
      stack.pop();
    }

    const text = cleanHeadingText(node, markdown, settings);
    if (text.length === 0) {
      continue;
    }

    stack.push({ depth: node.depth, text });
    result.push({
      offset: node.position?.start.offset ?? 0,
      path: stack.map((part) => part.text),
    });
  }

  return result;
}

function cleanHeadingText(
  heading: Heading,
  markdown: string,
  settings: FlashcardsSettings,
): string {
  let text = stripTrailingAnchor(
    phrasingToVisibleText(heading.children, markdown).trim(),
  );
  const basicTag = `#${settings.hashtag.basicTag}`;
  for (const tag of [
    `${basicTag}-reminder`,
    `${basicTag}-reverse`,
    `${basicTag}/reverse`,
    basicTag,
  ]) {
    if (text.endsWith(tag)) {
      const before = text.slice(0, -tag.length);
      if (before.length === 0 || /\s$/.test(before)) {
        text = before.trimEnd();
        break;
      }
    }
  }
  return text;
}

function headingContextAt(
  headings: HeadingContext[],
  cardOffset: number,
): string[] | undefined {
  let active: string[] | undefined;
  for (const heading of headings) {
    // A hashtag card can use its own heading as its front. Context must only
    // contain headings that begin before that card, or the front is repeated.
    if (heading.offset >= cardOffset) {
      break;
    }
    active = heading.path;
  }
  return active;
}

function noteTitle(notePath: string): string {
  const base = notePath.split("/").pop() ?? notePath;
  return base.endsWith(".md") ? base.slice(0, -3) : base;
}

/**
 * A `test:` key selects atomic authoring for implicit body syntax. Presence,
 * not validity, is deliberate: a typo must not create accidental cards from
 * prose that happens to contain `::` or cloze-like text.
 */
function hasTestKey(rawFrontmatter: string | undefined): boolean {
  if (!rawFrontmatter) return false;
  return /^test:/m.test(rawFrontmatter);
}

function mergeTags(...groups: string[][]): string[] {
  return [...new Set(groups.flat())];
}

interface CalloutExtractResult {
  cards: Flashcard[];
  warnings: string[];
}

function extractCalloutCards(
  markdown: string,
  tree: Root,
  notePath: string,
  resolvedDeck: string,
  tags: string[],
): CalloutExtractResult {
  const cards: Flashcard[] = [];
  const warnings: string[] = [];

  visit(tree, "blockquote", (node, _index, parent) => {
    if (parent?.type === "blockquote") return;
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (typeof start !== "number" || typeof end !== "number") return;

    const lines = markdown
      .slice(start, end)
      .split("\n")
      .map((line) => line.replace(/^[ \t]*>[ \t]?/, ""));
    const marker = /^\[!CARD\][+-]?[ \t]*(?::[ \t]*)?(.*)$/i.exec(
      lines[0] ?? "",
    );
    if (!marker) return;

    const front = (marker[1] ?? "").trim();
    if (!front) {
      warnings.push(
        `Card callout in ${notePath}:${node.position?.start.line ?? 1} has no question; skipped.`,
      );
      return;
    }

    cards.push({
      answer: lines.slice(1).join("\n").trim(),
      deckName: resolvedDeck,
      front,
      kind: "basic",
      source: {
        endOffset: end,
        line: node.position?.start.line ?? 1,
        startOffset: start,
        syntax: "callout",
      },
      tags,
    });
  });

  return { cards, warnings };
}

interface CollectedList {
  node: List;
  parent: Parent | null;
}

function extractListCards(
  markdown: string,
  tree: Root,
  settings: FlashcardsSettings,
  resolvedDeck: string,
  tags: string[],
  excludedRanges: Span[],
): Flashcard[] {
  const lists = collectUnquotedLists(tree);
  const cards: Flashcard[] = [];
  const inlineItemRanges: Span[] = [];

  if (settings.inline.enabled) {
    for (const { node: list } of lists) {
      for (const item of list.children) {
        const start = item.position?.start.offset;
        const end = item.position?.end.offset;
        if (
          typeof start !== "number" ||
          typeof end !== "number" ||
          intersectsSpan(start, end, excludedRanges) ||
          intersectsSpan(start, end, inlineItemRanges)
        ) {
          continue;
        }
        const paragraph = firstListItemParagraph(item);
        if (!paragraph) continue;
        const parsed = paragraphMarkdown(paragraph, markdown);
        const inline = parseInlineCard(
          stripTrailingAnchor(parsed.value),
          settings,
          parsed.protectedSpans,
        );
        if (!inline) continue;

        const paragraphEnd = paragraph.position?.end.offset ?? end;
        const childMarkdown = stripTrailingAnchor(
          markdown.slice(paragraphEnd, end).trim(),
        );
        cards.push({
          answer: [inline.answer, childMarkdown].filter(Boolean).join("\n\n"),
          deckName: resolvedDeck,
          front: inline.front,
          kind: inline.kind,
          source: {
            endOffset: end,
            line: item.position?.start.line ?? 1,
            startOffset: start,
            syntax: "inline",
          },
          tags,
        });
        inlineItemRanges.push({ start, end });
      }
    }
  }

  if (settings.cloze.enabled) {
    for (const { node: list, parent } of lists) {
      if (parent?.type === "listItem") continue;
      const start = list.position?.start.offset;
      const end = list.position?.end.offset;
      if (
        typeof start !== "number" ||
        typeof end !== "number" ||
        intersectsSpan(start, end, excludedRanges) ||
        intersectsSpan(start, end, inlineItemRanges)
      ) {
        continue;
      }
      const source = stripTrailingAnchor(markdown.slice(start, end));
      const syntax = parseClozeSyntax(
        source,
        collectProtectedMarkdownSpans(list, start),
        { auto: settings.highlightCloze.enabled },
      );
      if (syntax.spans.length === 0) continue;
      cards.push({
        answer: "",
        deckName: resolvedDeck,
        front: source,
        kind: "cloze",
        source: {
          endOffset: end,
          line: list.position?.start.line ?? 1,
          startOffset: start,
          syntax: "cloze",
        },
        tags,
      });
    }
  }

  return cards;
}

function firstListItemParagraph(item: ListItem): Paragraph | undefined {
  const first = item.children[0];
  return first?.type === "paragraph" ? first : undefined;
}

function collectUnquotedLists(tree: Root): CollectedList[] {
  const lists: CollectedList[] = [];
  const walk = (node: Nodes, parent: Parent | null): void => {
    if (node.type === "blockquote") return;
    if (node.type === "list") lists.push({ node, parent });
    if (hasChildren(node)) {
      for (const child of node.children as Nodes[]) walk(child, node);
    }
  };
  walk(tree, null);
  return lists;
}

function collectNodeRanges(tree: Root, type: Nodes["type"]): Span[] {
  const ranges: Span[] = [];
  visit(tree, type, (node) => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (typeof start === "number" && typeof end === "number") {
      ranges.push({ start, end });
    }
  });
  return ranges;
}

interface FencedFields {
  back?: string;
  content?: string;
  front?: string;
  type?: string;
}

const FENCED_KEY_RE = /^(front|back|content|type):(.*)$/;

/**
 * A field value spans the text after `key:` plus every following line until the
 * next key line or the end of the block, joined with `\n` and trimmed as a
 * whole. A continuation line that itself starts with a reserved key opens that
 * key instead of being treated as content (documented limitation, spec §4.4).
 */
function parseFencedFields(block: string): FencedFields {
  const fields: FencedFields = {};
  const lines = block.split("\n");

  let currentKey: keyof FencedFields | null = null;
  let buffer: string[] = [];

  const flush = (): void => {
    if (currentKey !== null) {
      fields[currentKey] = buffer.join("\n").trim();
    }
  };

  for (const line of lines) {
    const match = FENCED_KEY_RE.exec(line);
    if (match) {
      flush();
      currentKey = match[1] as keyof FencedFields;
      buffer = [match[2] ?? ""];
    } else if (currentKey !== null) {
      buffer.push(line);
    }
  }
  flush();

  return fields;
}

function parseInlineCard(
  line: string,
  settings: FlashcardsSettings,
  protectedSpans: Span[],
): { answer: string; front: string; kind: "basic" | "reversed"; syntax: "inline" } | null {
  const excludedSpans = [
    ...parseClozeSyntax(line, protectedSpans, {
      auto: settings.highlightCloze.enabled,
    }).spans,
    ...protectedSpans,
  ];

  const reverseIndex = findSeparator(line, settings.inlineReverseSeparator, excludedSpans);
  if (reverseIndex >= 0) {
    return {
      answer: line.slice(reverseIndex + settings.inlineReverseSeparator.length).trim(),
      front: line.slice(0, reverseIndex).trim(),
      kind: "reversed",
      syntax: "inline",
    };
  }

  const basicIndex = findSeparator(line, settings.inlineSeparator, excludedSpans);
  if (basicIndex >= 0) {
    return {
      answer: line.slice(basicIndex + settings.inlineSeparator.length).trim(),
      front: line.slice(0, basicIndex).trim(),
      kind: "basic",
      syntax: "inline",
    };
  }

  return null;
}

/**
 * Locates the first occurrence of `separator` in `line` whose match range does
 * not intersect any cloze span. Without this guard, a `::` inside an Anki
 * `{{cN::answer}}` cloze would be misread as an inline-card separator,
 * producing a spurious basic card alongside the (correct) cloze card. (B1)
 */
function findSeparator(line: string, separator: string, clozeSpans: Span[]): number {
  let from = 0;
  while (from <= line.length) {
    const idx = line.indexOf(separator, from);
    if (idx < 0) return -1;
    if (!intersectsSpan(idx, idx + separator.length, clozeSpans)) return idx;
    from = idx + 1;
  }
  return -1;
}

function parseClozeCard(
  line: string,
  protectedSpans: Span[],
  highlightClozeEnabled: boolean,
): string | null {
  const hasUnprotectedCloze =
    parseClozeSyntax(line, protectedSpans, {
      auto: highlightClozeEnabled,
    }).spans.length > 0;
  if (hasUnprotectedCloze) {
    return line;
  }

  return null;
}

interface ParagraphMarkdown {
  protectedSpans: Span[];
  value: string;
}

function paragraphMarkdown(node: Paragraph, source: string): ParagraphMarkdown {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (typeof start !== "number" || typeof end !== "number") {
    return {
      protectedSpans: [],
      value: phrasingToVisibleText(node.children, source).trim(),
    };
  }

  const raw = source.slice(start, end);
  const leadingWhitespace = raw.length - raw.trimStart().length;
  const value = raw.trim();
  const protectedSpans = collectProtectedMarkdownSpans(
    node,
    start + leadingWhitespace,
  );

  return { protectedSpans, value };
}

/**
 * Removes a trailing identity anchor (`^q-xxxx` v2 or `^<13-digit>` v1) from the
 * end of a card's visible text. Identity anchors are metadata, not card content;
 * leaving them in `front`/`answer` would (a) leak into Anki rendering and
 * (b) destabilise content hashing across pre/post anchor-insertion parses.
 */
const TRAILING_ANCHOR_RE = /\s*\^(?:q-[abcdefghijkmnpqrstuvwxyz23456789]{4}|\d{13})\s*$/;
function stripTrailingAnchor(text: string): string {
  return text.replace(TRAILING_ANCHOR_RE, "");
}

function phrasingToVisibleText(children: PhrasingContent[], source: string): string {
  let output = "";

  for (const child of children) {
    output += visibleTextForNode(child, source);
  }

  return output;
}

function visibleTextForNode(
  node: PhrasingContent | RootContent | Nodes,
  source: string,
): string {
  switch (node.type) {
    case "text":
      return node.value;
    case "break":
      return " ";
    case "delete":
    case "emphasis":
    case "strong":
    case "paragraph":
    case "heading":
    case "link":
    case "linkReference":
      return childText(node, source);
    // B5: `image` / `imageReference` previously returned "", which dropped
    // markdown-form images (`![alt](file)`) from the visible text before the
    // media rewriter could see them. Slice the original source to preserve
    // the exact syntax — the wikilink form survives via mdast's plain-text
    // fallback, but the standard form is a real node here.
    case "image":
    case "imageReference":
      return sliceFromSource(node, source);
    case "footnoteReference":
    case "html":
    case "inlineCode":
      return "";
    default:
      return hasChildren(node) ? childText(node, source) : "";
  }
}

function childText(node: Parent, source: string): string {
  let output = "";
  for (const child of node.children as Array<PhrasingContent | RootContent | Nodes>) {
    output += visibleTextForNode(child, source);
  }
  return output;
}

function sliceFromSource(
  node: PhrasingContent | RootContent | Nodes,
  source: string,
): string {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (typeof start === "number" && typeof end === "number") {
    return source.slice(start, end);
  }
  return "";
}

function hasChildren(node: object): node is Parent {
  return "children" in node;
}

function resolveDeckName(
  notePath: string,
  settings: FlashcardsSettings,
  metadataCardDeck: string | null | undefined,
): string {
  if (metadataCardDeck && metadataCardDeck.trim().length > 0) {
    return metadataCardDeck;
  }

  if (settings.folderBasedDecks) {
    const folderDeck = folderHierarchyFromPath(notePath);
    if (folderDeck !== null) {
      const prefix = normalizeHierarchy(settings.folderDeckPrefix);
      return prefix === null ? folderDeck : `${prefix}::${folderDeck}`;
    }
  }

  return settings.defaultDeck;
}

function folderHierarchyFromPath(notePath: string): string | null {
  let p = notePath;
  if (p.startsWith("./")) p = p.slice(2);
  if (p.startsWith("/")) p = p.slice(1);

  const parts = p.split("/");
  // Drop final segment (filename).
  parts.pop();

  const segments = parts
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (segments.length === 0) return null;
  return segments.join("::");
}

function normalizeHierarchy(value: string): string | null {
  const segments = value
    .split("::")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  return segments.length === 0 ? null : segments.join("::");
}
