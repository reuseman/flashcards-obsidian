import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { frontmatter } from "micromark-extension-frontmatter";
import type { Nodes, Parent, PhrasingContent, RootContent } from "mdast";
import { visit } from "unist-util-visit";

import type { FlashcardsSettings } from "../config/settings.js";
import type { Flashcard } from "../domain/card.js";
import { collectClozeSpans, intersectsSpan, type Span } from "./cloze-spans.js";
import { extractHashtagCards } from "./extract-hashtag-cards.js";
import { parseNoteMetadata } from "./note-metadata.js";

export interface ExtractCardsOptions {
  notePath: string;
  settings: FlashcardsSettings;
}

export interface ExtractCardsResult {
  cards: Flashcard[];
  warnings: string[];
}

export function extractCardsFromMarkdown(
  markdown: string,
  options: ExtractCardsOptions,
): ExtractCardsResult {
  const cards: Flashcard[] = [];
  const warnings: string[] = [];
  const metadata = parseNoteMetadata(markdown);
  const resolvedDeck = resolveDeckName(
    options.notePath,
    options.settings,
    metadata.cardDeck,
  );
  const tree = fromMarkdown(markdown, {
    extensions: [frontmatter(["yaml"])],
    mdastExtensions: [gfmFromMarkdown()],
  });

  visit(tree, (node, _index, parent) => {
    if (node.type === "code" && node.lang === "flashcard" && options.settings.fenced.enabled) {
      const fields = parseFencedFields(node.value ?? "");
      const front = fields.front ?? "";
      const back = fields.back ?? "";

      if (!front) {
        warnings.push(
          "Fenced flashcard block missing required `front:` field; skipped.",
        );
      } else if (!back) {
        warnings.push(
          "Fenced flashcard block missing required `back:` field; skipped.",
        );
      } else {
        cards.push({
          answer: back,
          deckName: resolvedDeck,
          front,
          kind: fields.type === "reversed" ? "reversed" : "basic",
          source: {
            endOffset: node.position?.end.offset ?? 0,
            line: node.position?.start.line ?? 1,
            startOffset: node.position?.start.offset ?? 0,
            syntax: "fenced",
          },
          tags: mergeTags(options.settings.defaultTags, metadata.tags),
        });
      }
    }

    if (node.type === "paragraph") {
      if (parent?.type === "blockquote") {
        return;
      }

      const value = stripTrailingAnchor(
        phrasingToVisibleText(node.children, markdown).trim(),
      );
      const inline = options.settings.inline.enabled
        ? parseInlineCard(value, options.settings)
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
          tags: mergeTags(options.settings.defaultTags, metadata.tags),
        });
      }

      const cloze = options.settings.cloze.enabled ? parseClozeCard(value) : null;
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
          tags: mergeTags(options.settings.defaultTags, metadata.tags),
        });
      }
    }
  });

  const hashtag = extractHashtagCards(markdown, tree, options.settings, {
    defaultTags: options.settings.defaultTags,
    metadataTags: metadata.tags,
    notePath: options.notePath,
    resolvedDeck,
  });
  cards.push(...hashtag.cards);
  warnings.push(...hashtag.warnings);

  return { cards, warnings };
}

function mergeTags(defaultTags: string[], metadataTags: string[]): string[] {
  return [...new Set([...defaultTags, ...metadataTags])];
}

interface FencedFields {
  back?: string;
  front?: string;
  type?: string;
}

const FENCED_KEY_RE = /^(front|back|type):(.*)$/;

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
): { answer: string; front: string; kind: "basic" | "reversed"; syntax: "inline" } | null {
  const clozeSpans = collectClozeSpans(line);

  const reverseIndex = findSeparator(line, settings.inlineReverseSeparator, clozeSpans);
  if (reverseIndex >= 0) {
    return {
      answer: line.slice(reverseIndex + settings.inlineReverseSeparator.length).trim(),
      front: line.slice(0, reverseIndex).trim(),
      kind: "reversed",
      syntax: "inline",
    };
  }

  const basicIndex = findSeparator(line, settings.inlineSeparator, clozeSpans);
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

function parseClozeCard(line: string): string | null {
  if (/==.+?==/.test(line) || /\{(?:\d+:)?[^}]+\}/.test(line)) {
    return line;
  }

  return null;
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
    const folderDeck = folderDeckFromPath(notePath);
    if (folderDeck !== null) return folderDeck;
  }

  return settings.defaultDeck;
}

function folderDeckFromPath(notePath: string): string | null {
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
