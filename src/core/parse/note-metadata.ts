export interface NoteMetadata {
  cardDeck: string | null;
  frontmatter: FrontmatterBlock | null;
  tags: string[];
}

export interface FrontmatterBlock {
  contentEnd: number;
  contentStart: number;
  end: number;
  raw: string;
  start: number;
}

export function parseNoteMetadata(markdown: string): NoteMetadata {
  const frontmatter = parseFrontmatterBlock(markdown);
  if (!frontmatter) {
    return {
      cardDeck: null,
      frontmatter: null,
      tags: [],
    };
  }

  const lines = frontmatter.raw.split(/\r?\n/);
  const tags: string[] = [];
  let cardDeck: string | null = null;

  for (const line of lines) {
    const match = /^\s*([A-Za-z0-9_-]+)\s*:\s*(.+?)\s*$/.exec(line);
    if (!match) {
      continue;
    }

    const key = match[1];
    const rawValue = match[2];
    if (!key || rawValue === undefined) {
      continue;
    }

    const value = stripWrappingQuotes(rawValue.trim());
    if (key === "cards-deck" && value.length > 0) {
      cardDeck = value;
      continue;
    }

    if (key === "tags") {
      tags.push(...parseTagValue(value));
    }
  }

  return {
    cardDeck,
    frontmatter,
    tags,
  };
}

function parseFrontmatterBlock(markdown: string): FrontmatterBlock | null {
  if (!markdown.startsWith("---")) {
    return null;
  }

  const startMatch = /^(---)\r?\n/.exec(markdown);
  if (!startMatch) {
    return null;
  }

  const contentStart = startMatch[0].length;
  const closingMatch = /\r?\n---(?:\r?\n|$)/g;
  closingMatch.lastIndex = contentStart;
  const closing = closingMatch.exec(markdown);

  if (!closing || closing.index < contentStart) {
    return null;
  }

  const contentEnd = closing.index;
  const end = closing.index + closing[0].length;
  return {
    contentEnd,
    contentStart,
    end,
    raw: markdown.slice(contentStart, contentEnd),
    start: 0,
  };
}

function parseTagValue(value: string): string[] {
  const normalized = value.startsWith("[") && value.endsWith("]")
    ? value.slice(1, -1)
    : value;

  return normalized
    .split(",")
    .map((part) => stripWrappingQuotes(part.trim()))
    .filter((part) => part.length > 0);
}

function stripWrappingQuotes(value: string): string {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
