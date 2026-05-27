/**
 * Line-based parser for the `flashcards:` sub-block of a note's frontmatter.
 *
 * Intentionally not a YAML parser. We accept the narrow set of shapes the
 * writer emits, plus v1 numeric keys for migration. See the test file
 * `tests/core/sync/parse-card-frontmatter.test.ts` for the locked contract.
 */

export interface FrontmatterCardEntry {
  blockId: string;
  hash?: string;
  nid?: number;
}

export interface ParsedCardFrontmatter {
  entries: FrontmatterCardEntry[];
  skippedLineCount: number;
}

const V2_KEY_RE = /^q-[abcdefghijkmnpqrstuvwxyz23456789]{4}$/;
const V1_KEY_RE = /^\d{13}$/;

interface LineInfo {
  text: string;
}

export function parseCardFrontmatter(markdown: string): ParsedCardFrontmatter {
  const fm = sliceFrontmatter(markdown);
  if (fm === null) {
    return { entries: [], skippedLineCount: 0 };
  }

  const lines = fm.split(/\r?\n/).map<LineInfo>((text) => ({ text }));

  // Find the `flashcards:` key line (must be exactly that, no inline value).
  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^flashcards:\s*$/.test(lines[i]!.text)) {
      startIdx = i;
      break;
    }
  }
  if (startIdx === -1) {
    return { entries: [], skippedLineCount: 0 };
  }

  // Sub-block runs while subsequent lines are indented (space/tab).
  // Stop on first line at column 0 (sibling) or end of fm.
  // Children must match `<indent>q-xxxx: <value>` or `<indent>"\d+": <value>` or `<indent>\d+: <value>`.
  // Anything else within the indented block is a skipped line.
  const byKey = new Map<string, FrontmatterCardEntry>();
  let skipped = 0;

  for (let j = startIdx + 1; j < lines.length; j++) {
    const text = lines[j]!.text;
    if (text.length === 0) {
      // Blank line: tolerated, neither parsed nor counted as skipped.
      continue;
    }
    if (!/^[ \t]/.test(text)) {
      // Sibling key — end of sub-block.
      break;
    }
    const entry = parseEntryLine(text);
    if (entry === null) {
      skipped++;
      continue;
    }
    if (byKey.has(entry.blockId)) {
      // Duplicate key: previous occurrence becomes "skipped"; last wins.
      skipped++;
    }
    byKey.set(entry.blockId, entry);
  }

  return { entries: Array.from(byKey.values()), skippedLineCount: skipped };
}

/**
 * Slice raw frontmatter content between leading `---` and closing `---`.
 * Returns null when no frontmatter block is present.
 */
function sliceFrontmatter(markdown: string): string | null {
  if (!markdown.startsWith("---")) return null;
  const startMatch = /^(---)\r?\n/.exec(markdown);
  if (!startMatch) return null;
  const contentStart = startMatch[0].length;
  const closingRe = /\r?\n---(?:\r?\n|$)/g;
  closingRe.lastIndex = contentStart;
  const closing = closingRe.exec(markdown);
  if (!closing || closing.index < contentStart) return null;
  return markdown.slice(contentStart, closing.index);
}

/**
 * Parse one indented child line of the `flashcards:` sub-block.
 *
 * Accepted shapes (with exactly one space after each `:`):
 *   <indent>q-xxxx: { hash: H }
 *   <indent>q-xxxx: { nid: N }
 *   <indent>q-xxxx: { nid: N, hash: H }
 *   <indent>q-xxxx: N
 *   <indent>"NNN...": { ... }
 *   <indent>"NNN...": N
 *   <indent>NNN...: { ... }
 *   <indent>NNN...: N
 *
 * Returns null for anything else.
 */
function parseEntryLine(line: string): FrontmatterCardEntry | null {
  // Strict shape: leading indent, key, ": ", value, optional trailing spaces.
  // Note `q-xxxx` allows the v2 character set; v1 is bare digits or quoted digits.
  const m = /^[ \t]+(?:"(\d{13})"|'(\d{13})'|(\d{13})|(q-[a-z0-9]+)): (.+?)\s*$/.exec(line);
  if (!m) return null;
  const blockId = m[1] ?? m[2] ?? m[3] ?? m[4]!;
  const value = m[5]!;

  // v2 key validation (tightened charset).
  if (blockId.startsWith("q-")) {
    if (!V2_KEY_RE.test(blockId)) return null;
  } else {
    if (!V1_KEY_RE.test(blockId)) return null;
  }

  // Object form: `{ ... }`.
  if (value.startsWith("{") && value.endsWith("}")) {
    return parseObjectValue(blockId, value);
  }

  // Scalar form: a 13-digit number (nid).
  if (/^\d{13}$/.test(value)) {
    return { blockId, nid: Number.parseInt(value, 10) };
  }

  return null;
}

/**
 * Parse `{ hash: H }`, `{ nid: N }`, `{ nid: N, hash: H }` (or hash-first).
 * Standard spacing only.
 */
function parseObjectValue(
  blockId: string,
  value: string,
): FrontmatterCardEntry | null {
  // Strip `{ ` and ` }`.
  if (!value.startsWith("{ ") || !value.endsWith(" }")) return null;
  const inner = value.slice(2, -2);
  if (inner.length === 0) return null;

  const parts = inner.split(", ");
  let hash: string | undefined;
  let nid: number | undefined;
  for (const part of parts) {
    const kv = /^(hash|nid): (.+)$/.exec(part);
    if (!kv) return null;
    const k = kv[1]!;
    const v = kv[2]!;
    if (k === "hash") {
      if (!/^[A-Za-z0-9]+$/.test(v)) return null;
      hash = v;
    } else {
      if (!/^\d+$/.test(v)) return null;
      nid = Number.parseInt(v, 10);
    }
  }
  if (hash === undefined && nid === undefined) return null;

  const out: FrontmatterCardEntry = { blockId };
  if (hash !== undefined) out.hash = hash;
  if (nid !== undefined) out.nid = nid;
  return out;
}
