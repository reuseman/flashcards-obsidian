import type {
  CreateOpResult,
  ExecuteSyncPlanResult,
} from "../sync/sync-execution.js";
import { parseNoteMetadata } from "../parse/note-metadata.js";
import type { TextEdit } from "./apply-text-edits.js";
import { computeCueHash } from "./card-hash.js";

/**
 * Phase 6 slice 6d — write sync execution results back into the `flashcards:`
 * frontmatter map.
 *
 * Semantics (locked in tasks.md / writeback-sync-results.test.ts):
 *  - CREATE ok + nid: ensure entry `{nid, hash}` exists. Insert / overwrite.
 *  - UPDATE ok: replace hash in place, preserve nid. Absent entry → silent skip.
 *  - DELETE ok: remove the entry line (including trailing newline). Absent → silent skip.
 *  - Failed ops: no edits.
 *  - Order within a single pass: CREATE → UPDATE → DELETE (last write wins on
 *    same blockId).
 *  - Empty `flashcards:` key after deletes: left in place.
 *  - v1 numeric blockIds (13 digits): key written quoted.
 *  - Idempotent: a second run on already-consistent state produces zero edits.
 *
 * Implementation strategy: compute the desired final per-blockId state in
 * memory (combining all results), diff against the parsed frontmatter, then
 * emit at most one TextEdit per blockId. This sidesteps offset-collision
 * problems when the same blockId is targeted by multiple ops in one pass.
 */

export interface WritebackSyncResultsOptions {
  markdown: string;
  results: ExecuteSyncPlanResult;
}

export interface WritebackSyncResultsOutput {
  edits: TextEdit[];
}

const V1_BLOCK_ID_RE = /^\d{13}$/;

interface ExistingEntry {
  blockId: string;
  cue: string | undefined;
  hash: string | undefined;
  // Byte range of the entry's full line, including trailing newline if present.
  lineEnd: number;
  lineStart: number;
  nid: number | undefined;
  // Byte range of the value portion (after `key: `, before trailing newline).
  valueEnd: number;
  valueStart: number;
}

interface FlashcardsBlock {
  // Offset just past the `flashcards:` line's trailing newline.
  entriesEnd: number;
  entriesStart: number;
}

interface DesiredEntry {
  cue?: string;
  hash: string;
  nid: number;
}

export function writebackSyncResults(
  options: WritebackSyncResultsOptions,
): WritebackSyncResultsOutput {
  const { markdown, results } = options;

  // 1. Parse current frontmatter state.
  const metadata = parseNoteMetadata(markdown);
  const fm = metadata.frontmatter;
  const block = fm
    ? findFlashcardsBlock(markdown, fm.contentStart, fm.contentEnd)
    : null;

  const existing = new Map<string, ExistingEntry>();
  if (block) {
    for (const entry of collectExistingEntries(markdown, block)) {
      existing.set(entry.blockId, entry);
    }
  }

  // 2. Compute desired final state per blockId.
  //    "set" = ensure this entry exists with these values.
  //    "delete" = ensure this entry does not exist.
  //    Anything not in the map = leave untouched.
  type Action =
    | { kind: "set"; entry: DesiredEntry }
    | { kind: "delete" };
  const desired = new Map<string, Action>();

  // CREATE first.
  for (const r of results.creates) {
    if (!isCreateOk(r)) continue;
    const blockId = r.op.card.blockId;
    const cue =
      r.op.card.source.syntax === "atomic"
        ? (r.op.card.cue ?? computeCueHash(r.op.card.kind, r.op.card.front))
        : undefined;
    desired.set(blockId, {
      kind: "set",
      entry: { ...(cue !== undefined ? { cue } : {}), hash: r.op.hash, nid: r.nid! },
    });
  }

  // UPDATE next.
  for (const r of results.updates) {
    if (r.status !== "ok") continue;
    const blockId = r.op.card.blockId;
    const prior = desired.get(blockId);
    if (prior && prior.kind === "set") {
      // CREATE then UPDATE in one pass: refresh hash, keep CREATE's nid/cue.
      desired.set(blockId, {
        kind: "set",
        entry: { ...(prior.entry.cue !== undefined ? { cue: prior.entry.cue } : {}), hash: r.op.newHash, nid: prior.entry.nid },
      });
      continue;
    }
    // No prior action — must target an existing entry.
    const ex = existing.get(blockId);
    if (!ex) continue; // silent skip
    // A cloze-boundary change recreates the Anki note. The executor returns
    // its replacement nid on the otherwise ordinary UPDATE result so this
    // existing source identity can point at the new note.
    const nid = r.nid ?? ex.nid ?? r.op.nid;
    // Atomic cards use the cue carried on the card (computed once at
    // identity-resolution time in previewSyncPlan) rather than the entry's
    // prior cue: for an ordinary answer-only edit the carried cue matches the
    // stale one so this is a no-op, but a confirmed cue-rephrase rebind
    // (WI-11) reassigns this card onto an orphan's blockId with a genuinely
    // different front, and the frontmatter must reflect the new cue.
    const cue =
      r.op.card.source.syntax === "atomic"
        ? (r.op.card.cue ?? computeCueHash(r.op.card.kind, r.op.card.front))
        : ex.cue;
    desired.set(blockId, {
      kind: "set",
      entry: { ...(cue !== undefined ? { cue } : {}), hash: r.op.newHash, nid },
    });
  }

  // DELETE last.
  for (const r of results.deletes) {
    if (r.status !== "ok") continue;
    const blockId = r.op.blockId;
    const prior = desired.get(blockId);
    if (prior) {
      // CREATE/UPDATE then DELETE on same blockId in one pass.
      desired.set(blockId, { kind: "delete" });
      continue;
    }
    if (!existing.has(blockId)) continue; // silent skip
    desired.set(blockId, { kind: "delete" });
  }

  if (desired.size === 0) return { edits: [] };

  // 3. Emit edits.
  const edits: TextEdit[] = [];
  const insertions: { blockId: string; entry: DesiredEntry }[] = [];

  for (const [blockId, action] of desired) {
    const ex = existing.get(blockId);
    if (action.kind === "delete") {
      if (!ex) continue;
      edits.push({ start: ex.lineStart, end: ex.lineEnd, text: "" });
      continue;
    }
    // action.kind === "set"
    const desiredText = renderValue(action.entry);
    if (ex) {
      const currentValue = markdown.slice(ex.valueStart, ex.valueEnd);
      if (currentValue === desiredText) continue; // idempotent
      edits.push({
        start: ex.valueStart,
        end: ex.valueEnd,
        text: desiredText,
      });
    } else {
      insertions.push({ blockId, entry: action.entry });
    }
  }

  if (insertions.length === 0) {
    return { edits };
  }

  // 4. Insert new entries. They may need a fresh frontmatter or a fresh
  //    `flashcards:` key, mirroring slice 2's logic.
  const insertLines = insertions.map(
    ({ blockId, entry }) =>
      `  ${formatKey(blockId)}: ${renderValue(entry)}`,
  );

  if (!fm) {
    // No frontmatter at all → prepend a fresh block.
    const separator =
      markdown.length === 0 || markdown.startsWith("\n") ? "" : "\n\n";
    const text = `---\nflashcards:\n${insertLines.join("\n")}\n---${separator}`;
    edits.push({ start: 0, end: 0, text });
    return { edits };
  }

  if (block) {
    // `flashcards:` exists → append inside its sub-block.
    const insertAt = block.entriesEnd;
    const text = `\n${insertLines.join("\n")}`;
    edits.push({ start: insertAt, end: insertAt, text });
    return { edits };
  }

  // Frontmatter exists but no `flashcards:` → append key + entries.
  const insertAt = fm.contentEnd;
  const prefix = fm.raw.length === 0 || fm.raw.endsWith("\n") ? "" : "\n";
  const text = `${prefix}flashcards:\n${insertLines.join("\n")}`;
  edits.push({ start: insertAt, end: insertAt, text });
  return { edits };
}

function isCreateOk(
  r: CreateOpResult,
): r is CreateOpResult & { nid: number; status: "ok" } {
  return r.status === "ok" && typeof r.nid === "number";
}

function renderValue(entry: DesiredEntry): string {
  if (entry.cue !== undefined) {
    return `{ cue: ${entry.cue}, nid: ${entry.nid}, hash: ${entry.hash} }`;
  }
  return `{ nid: ${entry.nid}, hash: ${entry.hash} }`;
}

function formatKey(blockId: string): string {
  if (V1_BLOCK_ID_RE.test(blockId)) return `"${blockId}"`;
  return blockId;
}

/**
 * Locate the `flashcards:` key line and the byte range of its indented
 * sub-block. Mirrors the heuristic in `write-card-frontmatter.ts`.
 */
function findFlashcardsBlock(
  markdown: string,
  contentStart: number,
  contentEnd: number,
): FlashcardsBlock | null {
  const fmText = markdown.slice(contentStart, contentEnd);
  const lines = splitLinesWithOffsets(fmText);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!/^flashcards:\s*$/.test(line.text)) continue;
    const subBlockStart = contentStart + line.endOffset;
    let entriesEnd = subBlockStart;
    for (let j = i + 1; j < lines.length; j++) {
      const sub = lines[j]!;
      if (sub.text.length === 0 || /^[ \t]/.test(sub.text)) {
        entriesEnd = contentStart + sub.endOffset;
        continue;
      }
      break;
    }
    return { entriesEnd, entriesStart: subBlockStart };
  }
  return null;
}

interface LineInfo {
  endOffset: number;
  startOffset: number;
  text: string;
}

function splitLinesWithOffsets(text: string): LineInfo[] {
  const out: LineInfo[] = [];
  let i = 0;
  while (i < text.length) {
    const nl = text.indexOf("\n", i);
    if (nl === -1) {
      out.push({
        endOffset: text.length,
        startOffset: i,
        text: text.slice(i),
      });
      break;
    }
    out.push({
      endOffset: nl + 1,
      startOffset: i,
      text: text.slice(i, nl),
    });
    i = nl + 1;
  }
  return out;
}

/**
 * Walk the indented sub-block under `flashcards:` and collect existing
 * entries with full byte ranges (line + value).
 */
function collectExistingEntries(
  markdown: string,
  block: FlashcardsBlock,
): ExistingEntry[] {
  const subText = markdown.slice(block.entriesStart, block.entriesEnd);
  const lines = splitLinesWithOffsets(subText);
  const out: ExistingEntry[] = [];

  for (const line of lines) {
    if (line.text.length === 0) continue;
    if (!/^[ \t]/.test(line.text)) continue;

    // Match `<indent><key>: <value><trailing whitespace>`.
    // Key: quoted-digits, bare-digits, or `q-xxxx`.
    const m = /^([ \t]+)(?:"(\d{13})"|(\d{13})|(q-[a-z0-9]+)): (.+?)\s*$/.exec(
      line.text,
    );
    if (!m) continue;
    const indent = m[1]!;
    const blockId = (m[2] ?? m[3] ?? m[4])!;
    const value = m[5]!;

    // Find absolute offsets.
    const lineStart = block.entriesStart + line.startOffset;
    const lineEnd = block.entriesStart + line.endOffset;
    // Value starts after `<indent><key>: `. Key length depends on quoting.
    const keyText = m[2] !== undefined ? `"${m[2]}"` : (m[3] ?? m[4])!;
    const valueStart = lineStart + indent.length + keyText.length + 2; // ": "
    const valueEnd = valueStart + value.length;

    const { nid, hash, cue } = parseValue(value);

    out.push({
      blockId,
      cue,
      hash,
      lineEnd,
      lineStart,
      nid,
      valueEnd,
      valueStart,
    });
  }
  return out;
}

function parseValue(value: string): { cue?: string; hash?: string; nid?: number } {
  // Object form: `{ ... }`.
  if (value.startsWith("{ ") && value.endsWith(" }")) {
    const inner = value.slice(2, -2);
    if (inner.length === 0) return {};
    let cue: string | undefined;
    let hash: string | undefined;
    let nid: number | undefined;
    for (const part of inner.split(", ")) {
      const kv = /^(cue|hash|nid): (.+)$/.exec(part);
      if (!kv) return {};
      const k = kv[1]!;
      const v = kv[2]!;
      if (k === "cue") {
        if (!/^[A-Za-z0-9]+$/.test(v)) return {};
        cue = v;
      } else if (k === "hash") {
        if (!/^[A-Za-z0-9]+$/.test(v)) return {};
        hash = v;
      } else {
        if (!/^\d+$/.test(v)) return {};
        nid = Number.parseInt(v, 10);
      }
    }
    const out: { cue?: string; hash?: string; nid?: number } = {};
    if (cue !== undefined) out.cue = cue;
    if (hash !== undefined) out.hash = hash;
    if (nid !== undefined) out.nid = nid;
    return out;
  }
  // Scalar shorthand: nid only.
  if (/^\d{13}$/.test(value)) {
    return { nid: Number.parseInt(value, 10) };
  }
  return {};
}
