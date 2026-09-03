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

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    const match = /^(\s*)([A-Za-z0-9_-]+)\s*:\s*(.*?)\s*$/.exec(line);
    if (!match) {
      continue;
    }

    const indentation = match[1]?.length ?? 0;
    const key = match[2];
    const rawValue = match[3];
    if (!key || rawValue === undefined) {
      continue;
    }

    const value = stripWrappingQuotes(rawValue.trim());
    if (key === "cards-deck" && value.length > 0) {
      cardDeck = value;
      continue;
    }

    if (key === "tags") {
      if (value.length > 0) {
        tags.push(...parseTagValue(value));
      } else {
        tags.push(...parseBlockTagValues(lines, index + 1, indentation));
      }
    }
  }

  return {
    cardDeck,
    frontmatter,
    tags,
  };
}

function parseBlockTagValues(
  lines: string[],
  startIndex: number,
  parentIndentation: number,
): string[] {
  const tags: string[] = [];

  for (let index = startIndex; index < lines.length; index++) {
    const line = lines[index]!;
    if (line.trim().length === 0) {
      continue;
    }

    const indentation = /^\s*/.exec(line)?.[0].length ?? 0;
    if (indentation <= parentIndentation) {
      break;
    }

    const item = /^\s*-\s*(.*?)\s*$/.exec(line)?.[1];
    if (item === undefined) {
      break;
    }

    const value = stripWrappingQuotes(item.trim());
    if (value.length > 0) {
      tags.push(value);
    }
  }

  return tags;
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
