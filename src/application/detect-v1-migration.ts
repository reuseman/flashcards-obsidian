import { parseCardFrontmatter } from "../core/sync/parse-card-frontmatter.js";

export interface DetectV1MigrationInput {
  markdown: string;
}

export interface DetectV1MigrationResult {
  unmigrated: number;
}

/**
 * Cheap, body-only scan for v1 anchors (`^<13-digit>`) whose key is not
 * already present in the `flashcards:` frontmatter map.
 *
 * Counts UNIQUE 13-digit values. Code-block / HTML-comment exclusion is
 * intentionally omitted — caller treats the result as a hint, not exact.
 */
export function detectV1Migration(
  input: DetectV1MigrationInput,
): DetectV1MigrationResult {
  const { markdown } = input;

  const body = stripFrontmatter(markdown);
  const found = new Set<string>();
  const re = /\^(\d{13})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    found.add(m[1]!);
  }
  if (found.size === 0) return { unmigrated: 0 };

  const existing = new Set(
    parseCardFrontmatter(markdown).entries.map((e) => e.blockId),
  );
  let unmigrated = 0;
  for (const id of found) {
    if (!existing.has(id)) unmigrated++;
  }
  return { unmigrated };
}

function stripFrontmatter(markdown: string): string {
  if (!markdown.startsWith("---")) return markdown;
  const startMatch = /^(---)\r?\n/.exec(markdown);
  if (!startMatch) return markdown;
  const contentStart = startMatch[0].length;
  const closingRe = /\r?\n---(?:\r?\n|$)/g;
  closingRe.lastIndex = contentStart;
  const closing = closingRe.exec(markdown);
  if (!closing) return markdown;
  return markdown.slice(closing.index + closing[0].length);
}
