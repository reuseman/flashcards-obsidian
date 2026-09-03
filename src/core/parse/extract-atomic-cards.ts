import type { Paragraph, Root } from "mdast";

import type { CardKind, Flashcard } from "../domain/card.js";
import { parseClozeSyntax } from "./cloze-syntax.js";
import { collectProtectedMarkdownSpans } from "./markdown-tree.js";
import type { FrontmatterBlock } from "./note-metadata.js";

export interface AtomicExtractContext {
  notePath: string;
  resolvedDeck: string;
  tags: string[];
}

export interface AtomicExtractResult {
  cards: Flashcard[];
  lints: string[];
}

const RESERVED_TITLE = "title";
const RESERVED_REVERSED = "reversed";
const RESERVED_CLOZE = "cloze";

type InvalidReason = "boolean" | "other";

type TestValue =
  | { kind: "absent" }
  | { kind: "invalid"; reason: InvalidReason }
  | { kind: "items"; items: string[] };

function errorLint(notePath: string, reason: InvalidReason): string {
  const suffix =
    reason === "boolean"
      ? " — boolean value; did you mean `test: title`?"
      : "";
  return `error: invalid \`test:\` value in ${notePath}${suffix}`;
}

function thinCardLint(notePath: string): string {
  return `warn: thin card in ${notePath} — \`test:\` present but no first paragraph`;
}

function clozeSpanLint(notePath: string): string {
  return `warn: cloze item in ${notePath} has no cloze span (\`==x==\`/\`{n:x}\`) in its first paragraph`;
}

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
  highlightClozeEnabled = true,
): AtomicExtractResult {
  if (!atomicEnabled || !frontmatter) return { cards: [], lints: [] };

  const parsed = parseTestValue(frontmatter.raw);
  if (parsed.kind === "absent") return { cards: [], lints: [] };
  if (parsed.kind === "invalid") {
    return { cards: [], lints: [errorLint(context.notePath, parsed.reason)] };
  }
  if (!itemsAreValid(parsed.items)) {
    return { cards: [], lints: [errorLint(context.notePath, "other")] };
  }

  const paragraph = findFirstParagraph(tree);
  if (!paragraph) {
    return { cards: [], lints: [thinCardLint(context.notePath)] };
  }

  const start = paragraph.position?.start.offset ?? 0;
  const end = paragraph.position?.end.offset ?? 0;
  const line = paragraph.position?.start.line ?? 1;
  const firstParagraph = markdown.slice(start, end);
  const protectedSpans = collectProtectedMarkdownSpans(paragraph, start);
  const title = noteTitle(context.notePath);

  const lints: string[] = [];
  const cards: Flashcard[] = [];
  for (const item of parsed.items) {
    if (
      item === RESERVED_CLOZE &&
      parseClozeSyntax(firstParagraph, protectedSpans, {
        auto: highlightClozeEnabled,
      }).spans.length === 0
    ) {
      lints.push(clozeSpanLint(context.notePath));
      continue;
    }
    cards.push(buildCard(item, title, firstParagraph, { start, end, line }, context));
  }

  if (hasDerivedFrontCollision(cards)) {
    return { cards: [], lints: [...lints, errorLint(context.notePath, "other")] };
  }

  return { cards, lints };
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

/**
 * WI-9 fix: the raw-item duplicate check (`itemsAreValid`) only catches
 * literal duplicate list items — it misses an authored cue that happens to
 * derive the SAME (kind, front) pair as another item (e.g. a cue string
 * equal to the note title collides with the reserved `title` item, since
 * both derive kind "basic" / front = title). Any such collision must
 * invalidate the whole key, same as a literal duplicate.
 */
function hasDerivedFrontCollision(cards: Flashcard[]): boolean {
  const seen = new Set<string>();
  for (const card of cards) {
    // Tuple-encoded key: collision-safe for any kind/front values without
    // relying on a separator character being absent from the parts (a
    // previous literal-NUL separator also made git treat this file as binary).
    const key = JSON.stringify([card.kind, card.front]);
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
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

  if (afterColon.startsWith("{")) return { kind: "invalid", reason: "other" };

  if (afterColon.startsWith("[")) {
    return parseFlowList(afterColon.slice(1));
  }

  if (afterColon.length > 0) {
    const scalar = parseScalarToken(afterColon);
    if (!scalar.ok) return { kind: "invalid", reason: scalar.reason };
    return { kind: "items", items: [scalar.value] };
  }

  const items: string[] = [];
  let sawMap = false;

  for (let i = keyIndex + 1; i < lines.length; i++) {
    const raw = lines[i]!;
    if (raw.trim().length === 0) continue;

    const trimmedLine = raw.trim();
    const isListItem = trimmedLine === "-" || trimmedLine.startsWith("- ");
    if (!/^\s/.test(raw) && !isListItem) break;

    if (isListItem) {
      const token = parseScalarToken(
        trimmedLine.startsWith("- ") ? trimmedLine.slice(2) : "",
      );
      if (!token.ok) return { kind: "invalid", reason: token.reason };
      items.push(token.value);
    } else {
      sawMap = true;
    }
  }

  if (sawMap || items.length === 0) return { kind: "invalid", reason: "other" };
  return { kind: "items", items };
}

/**
 * Parses the content after `test: [` up to its matching `]`. Nested flow
 * lists/maps and unterminated sequences are rejected — this grammar only
 * recognizes a single flat flow list of scalars (same idiom as `tags:`).
 */
function parseFlowList(rest: string): TestValue {
  const closeIndex = findFlowListClose(rest);
  if (closeIndex < 0) return { kind: "invalid", reason: "other" };

  const content = rest.slice(0, closeIndex);
  const items: string[] = [];
  for (const itemStr of splitFlowItems(content)) {
    const token = parseScalarToken(itemStr);
    if (!token.ok) return { kind: "invalid", reason: token.reason };
    items.push(token.value);
  }

  if (items.length === 0) return { kind: "invalid", reason: "other" };
  return { kind: "items", items };
}

function findFlowListClose(s: string): number {
  let inQuote: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (inQuote) {
      if (ch === inQuote) inQuote = null;
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === "]") {
      return i;
    } else if (ch === "[" || ch === "{") {
      return -1;
    }
  }
  return -1;
}

function splitFlowItems(content: string): string[] {
  const items: string[] = [];
  let current = "";
  let inQuote: string | null = null;

  for (const ch of content) {
    if (inQuote) {
      current += ch;
      if (ch === inQuote) inQuote = null;
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
      current += ch;
    } else if (ch === ",") {
      items.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  items.push(current);
  return items;
}

function parseScalarToken(
  raw: string,
): { ok: true; value: string } | { ok: false; reason: InvalidReason } {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false, reason: "other" };

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    return { ok: true, value: trimmed.slice(1, -1) };
  }

  // Bare (unquoted) scalars cannot contain " #" in YAML — anything from
  // there on is a comment, not part of the value.
  const commentIndex = trimmed.indexOf(" #");
  const unquoted =
    commentIndex >= 0 ? trimmed.slice(0, commentIndex).trim() : trimmed;
  if (unquoted.length === 0) return { ok: false, reason: "other" };

  // Bare numbers and booleans are invalid `test` items — YAML would type
  // them as number/boolean, never a string.
  if (/^-?\d+(?:\.\d+)?$/.test(unquoted)) return { ok: false, reason: "other" };
  if (/^(?:true|false|True|False|TRUE|FALSE)$/.test(unquoted)) {
    return { ok: false, reason: "boolean" };
  }

  return { ok: true, value: unquoted };
}
