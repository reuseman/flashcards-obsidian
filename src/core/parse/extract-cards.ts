import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { frontmatter } from "micromark-extension-frontmatter";
import type { Nodes, Parent, PhrasingContent, RootContent } from "mdast";
import { visit } from "unist-util-visit";

import type { FlashcardsSettings } from "../config/settings.js";
import type { Flashcard } from "../domain/card.js";
import { extractLegacyHashtagCards } from "./extract-legacy-cards.js";
import { parseNoteMetadata } from "./note-metadata.js";

export interface ExtractCardsOptions {
  notePath: string;
  settings: FlashcardsSettings;
}

export interface ExtractCardsResult {
  cards: Flashcard[];
}

export function extractCardsFromMarkdown(
  markdown: string,
  options: ExtractCardsOptions,
): ExtractCardsResult {
  const cards: Flashcard[] = [];
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
    if (node.type === "code" && node.lang === "flashcard") {
      const value = node.value ?? "";
      const front = findField(value, "front");
      const back = findField(value, "back");
      const type = findField(value, "type");

      if (front && back) {
        cards.push({
          answer: back,
          deckName: resolvedDeck,
          front,
          kind: type === "reversed" ? "reversed" : "basic",
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

      const value = phrasingToVisibleText(node.children).trim();
      const inline = parseInlineCard(value, options.settings);
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

      const cloze = parseClozeCard(value);
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

  const legacyCards = extractLegacyHashtagCards(markdown, tree, options.settings, {
    defaultTags: options.settings.defaultTags,
    metadataTags: metadata.tags,
    notePath: options.notePath,
    resolvedDeck,
  });
  cards.push(...legacyCards);

  return { cards };
}

function mergeTags(defaultTags: string[], metadataTags: string[]): string[] {
  return [...new Set([...defaultTags, ...metadataTags])];
}

function findField(block: string, name: string): string | null {
  const match = block.match(new RegExp(`^${name}:\\s*(.+)$`, "m"));
  return match?.[1]?.trim() ?? null;
}

function parseInlineCard(
  line: string,
  settings: FlashcardsSettings,
): { answer: string; front: string; kind: "basic" | "reversed"; syntax: "inline" } | null {
  const reverseIndex = line.indexOf(settings.inlineReverseSeparator);
  if (reverseIndex >= 0) {
    return {
      answer: line.slice(reverseIndex + settings.inlineReverseSeparator.length).trim(),
      front: line.slice(0, reverseIndex).trim(),
      kind: "reversed",
      syntax: "inline",
    };
  }

  const basicIndex = line.indexOf(settings.inlineSeparator);
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

function parseClozeCard(line: string): string | null {
  if (line.includes("==") && /==.+?==/.test(line)) {
    return line.replace(/==(.+?)==/g, "{{c1::$1}}");
  }

  if (/\{(?:\d+:)?[^}]+\}/.test(line)) {
    return line.replace(/\{(?:(\d+):)?([^}]+)\}/g, (_match, group, value) => {
      const index = group ?? "1";
      return `{{c${index}::${value}}}`;
    });
  }

  return null;
}

function phrasingToVisibleText(children: PhrasingContent[]): string {
  let output = "";

  for (const child of children) {
    output += visibleTextForNode(child);
  }

  return output;
}

function visibleTextForNode(node: PhrasingContent | RootContent | Nodes): string {
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
      return childText(node);
    case "footnoteReference":
    case "html":
    case "image":
    case "imageReference":
    case "inlineCode":
      return "";
    default:
      return hasChildren(node) ? childText(node) : "";
  }
}

function childText(node: Parent): string {
  let output = "";
  for (const child of node.children as Array<PhrasingContent | RootContent | Nodes>) {
    output += visibleTextForNode(child);
  }
  return output;
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
