/**
 * Narrow reader for the plugin-owned `flashcards:` frontmatter map.
 *
 * The plugin writes compact flow mappings, while Obsidian may rewrite the
 * same property as a block mapping. Both representations are part of the
 * managed format. This deliberately remains smaller than a general YAML
 * parser so unrelated user frontmatter is never interpreted as card state.
 */

export interface FrontmatterCardEntry {
  blockId: string;
  cue?: string;
  hash?: string;
  nid?: number;
  sync?: string;
}

export interface ParsedCardFrontmatter {
  entries: FrontmatterCardEntry[];
  skippedLineCount: number;
}

export interface FlashcardsBlockRange {
  entriesEnd: number;
  entriesStart: number;
}

/** Entry details used by the writeback layer for precise text edits. */
export interface ScannedFrontmatterCardEntry extends FrontmatterCardEntry {
  indent: string;
  keyText: string;
  lineEnd: number;
  lineEnding: string;
  lineStart: number;
}

export interface ScannedCardFrontmatter extends ParsedCardFrontmatter {
  block: FlashcardsBlockRange | null;
  entries: ScannedFrontmatterCardEntry[];
}

const V2_KEY_RE = /^q-[abcdefghijkmnpqrstuvwxyz23456789]{4}$/;
const V1_KEY_RE = /^\d{13}$/;

interface LineInfo {
  endOffset: number;
  lineEnding: string;
  startOffset: number;
  text: string;
}

export function parseCardFrontmatter(markdown: string): ParsedCardFrontmatter {
  const { entries, skippedLineCount } = scanCardFrontmatter(markdown);
  const validEntries = entries.filter((entry) => isValidBlockId(entry.blockId));
  return {
    entries: validEntries.map(({ blockId, cue, hash, nid, sync }) => ({
      blockId,
      ...(cue !== undefined ? { cue } : {}),
      ...(hash !== undefined ? { hash } : {}),
      ...(nid !== undefined ? { nid } : {}),
      ...(sync !== undefined ? { sync } : {}),
    })),
    skippedLineCount: skippedLineCount + entries.length - validEntries.length,
  };
}

/**
 * Parse entries and retain their byte ranges. The range for a block-style
 * entry owns its header and all nested field lines, so update/delete cannot
 * leave orphaned YAML behind.
 */
export function scanCardFrontmatter(markdown: string): ScannedCardFrontmatter {
  const fm = locateFrontmatter(markdown);
  if (!fm) return { block: null, entries: [], skippedLineCount: 0 };

  const fmText = markdown.slice(fm.contentStart, fm.contentEnd);
  const lines = splitLinesWithOffsets(fmText);
  const keyIndex = lines.findIndex((line) => /^flashcards:\s*$/.test(line.text));
  if (keyIndex === -1) {
    return { block: null, entries: [], skippedLineCount: 0 };
  }

  const entriesStart = fm.contentStart + lines[keyIndex]!.endOffset;
  let endIndex = keyIndex + 1;
  while (endIndex < lines.length) {
    const line = lines[endIndex]!;
    if (line.text.length > 0 && !/^[ \t]/.test(line.text)) break;
    endIndex++;
  }
  const entriesEnd =
    endIndex === keyIndex + 1
      ? entriesStart
      : fm.contentStart + lines[endIndex - 1]!.endOffset;
  const block = { entriesEnd, entriesStart };

  const byKey = new Map<string, ScannedFrontmatterCardEntry>();
  let skipped = 0;

  for (let i = keyIndex + 1; i < endIndex; i++) {
    const line = lines[i]!;
    if (line.text.length === 0) continue;

    const header = parseEntryHeader(line.text);
    if (!header) {
      skipped++;
      continue;
    }

    let parsed: FrontmatterCardEntry | null;
    let ownedEnd = i;
    if (header.value !== undefined) {
      parsed = parseInlineValue(header.blockId, header.value);
    } else {
      const fields: Partial<Omit<FrontmatterCardEntry, "blockId">> = {};
      let validFieldCount = 0;
      let j = i + 1;
      for (; j < endIndex; j++) {
        const child = lines[j]!;
        if (child.text.length === 0) {
          ownedEnd = j;
          continue;
        }
        const childIndent = /^[ \t]*/.exec(child.text)![0].length;
        if (childIndent <= header.indent.length) break;
        ownedEnd = j;
        const field = parseBlockField(child.text, header.indent.length);
        if (!field || !setField(fields, field.name, field.value)) {
          skipped++;
          continue;
        }
        validFieldCount++;
      }
      i = j - 1;
      parsed =
        validFieldCount > 0
          ? ({ blockId: header.blockId, ...fields } as FrontmatterCardEntry)
          : null;
    }

    if (!parsed) {
      skipped++;
      continue;
    }
    if (byKey.has(parsed.blockId)) skipped++;

    const lastLine = lines[ownedEnd]!;
    byKey.set(parsed.blockId, {
      ...parsed,
      indent: header.indent,
      keyText: header.keyText,
      lineEnd: fm.contentStart + lastLine.endOffset,
      lineEnding: lastLine.lineEnding,
      lineStart: fm.contentStart + line.startOffset,
    });
  }

  return {
    block,
    entries: Array.from(byKey.values()),
    skippedLineCount: skipped,
  };
}

interface EntryHeader {
  blockId: string;
  indent: string;
  keyText: string;
  value?: string;
}

function parseEntryHeader(line: string): EntryHeader | null {
  const match = /^([ \t]+)(?:"(\d{13})"|'(\d{13})'|(\d{13})|(q-[a-z0-9]+)):(?: (.+?))?[ \t]*$/.exec(
    line,
  );
  if (!match) return null;
  const blockId = match[2] ?? match[3] ?? match[4] ?? match[5]!;
  const indent = match[1]!;
  const colon = line.indexOf(":", indent.length);
  return {
    blockId,
    indent,
    keyText: line.slice(indent.length, colon),
    ...(match[6] !== undefined ? { value: match[6] } : {}),
  };
}

function isValidBlockId(blockId: string): boolean {
  return blockId.startsWith("q-")
    ? V2_KEY_RE.test(blockId)
    : V1_KEY_RE.test(blockId);
}

function parseInlineValue(
  blockId: string,
  value: string,
): FrontmatterCardEntry | null {
  if (/^\d{13}$/.test(value)) {
    return { blockId, nid: Number.parseInt(value, 10) };
  }
  if (!value.startsWith("{ ") || !value.endsWith(" }")) return null;

  const fields: Partial<Omit<FrontmatterCardEntry, "blockId">> = {};
  const parts = value.slice(2, -2).split(", ");
  if (parts.length === 0) return null;
  for (const part of parts) {
    const field = /^(cue|hash|nid|sync): (.+)$/.exec(part);
    if (!field || !setField(fields, field[1]!, field[2]!)) return null;
  }
  return Object.keys(fields).length > 0
    ? ({ blockId, ...fields } as FrontmatterCardEntry)
    : null;
}

function parseBlockField(
  line: string,
  parentIndentLength: number,
): { name: string; value: string } | null {
  const match = /^([ \t]+)(cue|hash|nid|sync): (.+?)[ \t]*$/.exec(line);
  if (!match || match[1]!.length <= parentIndentLength) return null;
  return { name: match[2]!, value: match[3]! };
}

function setField(
  fields: Partial<Omit<FrontmatterCardEntry, "blockId">>,
  name: string,
  value: string,
): boolean {
  if (name === "nid") {
    if (!/^\d+$/.test(value)) return false;
    fields.nid = Number.parseInt(value, 10);
    return true;
  }
  if (!/^[A-Za-z0-9]+$/.test(value)) return false;
  if (name === "cue") fields.cue = value;
  else if (name === "hash") fields.hash = value;
  else if (name === "sync") fields.sync = value;
  else return false;
  return true;
}

function locateFrontmatter(
  markdown: string,
): { contentEnd: number; contentStart: number } | null {
  const opening = /^---\r?\n/.exec(markdown);
  if (!opening) return null;
  const contentStart = opening[0].length;
  const closing = /\r?\n---(?:\r?\n|$)/g;
  closing.lastIndex = contentStart;
  const match = closing.exec(markdown);
  if (!match) return null;
  return { contentEnd: match.index, contentStart };
}

function splitLinesWithOffsets(text: string): LineInfo[] {
  const out: LineInfo[] = [];
  let start = 0;
  while (start < text.length) {
    const newline = text.indexOf("\n", start);
    if (newline === -1) {
      out.push({
        endOffset: text.length,
        lineEnding: "",
        startOffset: start,
        text: text.slice(start),
      });
      break;
    }
    const hasCr = newline > start && text[newline - 1] === "\r";
    out.push({
      endOffset: newline + 1,
      lineEnding: hasCr ? "\r\n" : "\n",
      startOffset: start,
      text: text.slice(start, hasCr ? newline - 1 : newline),
    });
    start = newline + 1;
  }
  return out;
}
