import type { FlashcardsSettings } from "../config/settings.js";
import { applyTextEdits, type TextEdit } from "./apply-text-edits.js";
import { parseNoteMetadata } from "../parse/note-metadata.js";

export interface EnsureNoteFrontmatterOptions {
  hasCards: boolean;
  settings: FlashcardsSettings;
}

export interface EnsureNoteFrontmatterResult {
  changed: boolean;
  edits: TextEdit[];
  markdown: string;
}

export function ensureNoteFrontmatter(
  markdown: string,
  options: EnsureNoteFrontmatterOptions,
): EnsureNoteFrontmatterResult {
  if (!options.hasCards) {
    return {
      changed: false,
      edits: [],
      markdown,
    };
  }

  const metadata = parseNoteMetadata(markdown);
  const edits = createDeckEdits(markdown, metadata.cardDeck, metadata.frontmatter, options.settings);
  if (edits.length === 0) {
    return {
      changed: false,
      edits,
      markdown,
    };
  }

  return {
    changed: true,
    edits,
    markdown: applyTextEdits(markdown, edits),
  };
}

function createDeckEdits(
  markdown: string,
  cardDeck: string | null,
  frontmatter: ReturnType<typeof parseNoteMetadata>["frontmatter"],
  settings: FlashcardsSettings,
): TextEdit[] {
  if (cardDeck && cardDeck.trim().length > 0) {
    return [];
  }

  const deckLine = `cards-deck: ${settings.defaultDeck}`;
  if (!frontmatter) {
    const separator = markdown.startsWith("\n") || markdown.length === 0 ? "" : "\n\n";
    return [
      {
        end: 0,
        start: 0,
        text: `---\n${deckLine}\n---${separator}`,
      },
    ];
  }

  const insertionPoint = frontmatter.contentEnd;
  const prefix = frontmatter.raw.length === 0 || frontmatter.raw.endsWith("\n") ? "" : "\n";
  return [
    {
      end: insertionPoint,
      start: insertionPoint,
      text: `${prefix}${deckLine}`,
    },
  ];
}
