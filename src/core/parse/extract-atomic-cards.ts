import type { Paragraph, Root } from "mdast";

import type { CardKind, Flashcard } from "../domain/card.js";
import type { FrontmatterBlock } from "./note-metadata.js";

export interface AtomicExtractContext {
  notePath: string;
  resolvedDeck: string;
  tags: string[];
}

export interface AtomicExtractResult {
  cards: Flashcard[];
}

const RESERVED_TITLE = "title";
const RESERVED_REVERSED = "reversed";
const RESERVED_CLOZE = "cloze";

type TestValue =
  | { kind: "absent" }
  | { kind: "invalid" }
  | { kind: "items"; items: string[] };

/**
 * Extracts cards from the `test:` frontmatter grammar (design §4.1-§4.3).
 * Restricted to the first mdast paragraph node of the body — everything
 * before it (headings, lists, blockquotes, code fences) is skipped over
 * without being consumed, everything after it is never read.
 */
export function extractAtomicCards(
  frontmatter: FrontmatterBlock | null,
  tree: Root,
  markdown: string,
  atomicEnabled: boolean,
  context: AtomicExtractContext,
): AtomicExtractResult {
  if (!atomicEnabled || !frontmatter) return { cards: [] };

  const parsed = parseTestValue(frontmatter.raw);
  if (parsed.kind !== "items" || !itemsAreValid(parsed.items)) {
    return { cards: [] };
  }

  const paragraph = findFirstParagraph(tree);
  if (!paragraph) return { cards: [] };

  const start = paragraph.position?.start.offset ?? 0;
  const end = paragraph.position?.end.offset ?? 0;
  const line = paragraph.position?.start.line ?? 1;
  const firstParagraph = markdown.slice(start, end);
  const title = noteTitle(context.notePath);

  const cards: Flashcard[] = parsed.items.map((item) =>
    buildCard(item, title, firstParagraph, { start, end, line }, context),
  );

  return { cards };
}

function buildCard(
  item: string,
  title: string,
  firstParagraph: string,
  source: { start: number; end: number; line: number },
  context: AtomicExtractContext,
): Flashcard {
  let front: string;
  let answer: string;
  let kind: CardKind;

  if (item === RESERVED_TITLE) {
    front = title;
    answer = firstParagraph;
    kind = "basic";
  } else if (item === RESERVED_REVERSED) {
    front = title;
    answer = firstParagraph;
    kind = "reversed";
  } else if (item === RESERVED_CLOZE) {
    front = firstParagraph;
    answer = title;
    kind = "cloze";
  } else {
    front = item;
    answer = `${title}\n\n${firstParagraph}`;
    kind = "basic";
  }

  return {
    answer,
    deckName: context.resolvedDeck,
    front,
    kind,
    source: {
      endOffset: source.end,
      line: source.line,
      startOffset: source.start,
      syntax: "atomic",
    },
    tags: context.tags,
  };
}

function itemsAreValid(items: string[]): boolean {
  const seen = new Set<string>();
  let reversedCount = 0;
  let clozeCount = 0;

  for (const item of items) {
    if (seen.has(item)) return false;
    seen.add(item);
    if (item === RESERVED_REVERSED) reversedCount++;
    if (item === RESERVED_CLOZE) clozeCount++;
  }

  return reversedCount <= 1 && clozeCount <= 1;
}

function findFirstParagraph(tree: Root): Paragraph | null {
  for (const child of tree.children) {
    if (child.type === "paragraph") return child;
  }
  return null;
}

function noteTitle(notePath: string): string {
  const base = notePath.split("/").pop() ?? notePath;
  return base.endsWith(".md") ? base.slice(0, -3) : base;
}

/**
 * Parses the `test:` key out of the raw frontmatter block (the text between
 * the `---` delimiters). Hand-rolled rather than a full YAML parser: the
 * grammar only needs a bare scalar or a block list of scalars, and a real
 * YAML dependency would be a heavier addition than this slice needs.
 */
function parseTestValue(rawFrontmatter: string): TestValue {
  const lines = rawFrontmatter.split(/\r?\n/);
  const keyIndex = lines.findIndex((l) => /^test:/.test(l));
  if (keyIndex < 0) return { kind: "absent" };

  const line = lines[keyIndex]!;
  const afterColon = line.slice("test:".length).trim();

  if (afterColon.length > 0) {
    const scalar = parseScalarToken(afterColon);
    if (!scalar.ok) return { kind: "invalid" };
    return { kind: "items", items: [scalar.value] };
  }

  const items: string[] = [];
  let sawMap = false;

  for (let i = keyIndex + 1; i < lines.length; i++) {
    const raw = lines[i]!;
    if (raw.trim().length === 0) continue;
    if (!/^\s/.test(raw)) break;

    const trimmedLine = raw.trim();
    if (trimmedLine.startsWith("- ")) {
      const token = parseScalarToken(trimmedLine.slice(2));
      if (!token.ok) return { kind: "invalid" };
      items.push(token.value);
    } else {
      sawMap = true;
    }
  }

  if (sawMap || items.length === 0) return { kind: "invalid" };
  return { kind: "items", items };
}

function parseScalarToken(raw: string): { ok: true; value: string } | { ok: false } {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false };

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    return { ok: true, value: trimmed.slice(1, -1) };
  }

  // Bare numbers and booleans are invalid `test` items — YAML would type
  // them as number/boolean, never a string.
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return { ok: false };
  if (/^(?:true|false|True|False|TRUE|FALSE)$/.test(trimmed)) return { ok: false };

  return { ok: true, value: trimmed };
}
