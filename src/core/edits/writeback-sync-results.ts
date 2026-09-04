import type {
  CreateOpResult,
  ExecuteSyncPlanResult,
} from "../sync/sync-execution.js";
import { parseNoteMetadata } from "../parse/note-metadata.js";
import type { TextEdit } from "./apply-text-edits.js";
import { computeCueHash } from "./card-hash.js";
import { scanCardFrontmatter } from "../sync/parse-card-frontmatter.js";

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
  cue?: string;
  hash?: string;
  // Byte range of the entry's full line, including trailing newline if present.
  lineEnd: number;
  lineEnding: string;
  lineStart: number;
  nid?: number;
  sync?: string;
  indent: string;
  keyText: string;
}

interface DesiredEntry {
  cue?: string;
  hash: string;
  nid: number;
  sync?: string;
}

export function writebackSyncResults(
  options: WritebackSyncResultsOptions,
): WritebackSyncResultsOutput {
  const { markdown, results } = options;

  // 1. Parse current frontmatter state.
  const metadata = parseNoteMetadata(markdown);
  const fm = metadata.frontmatter;
  const scanned = scanCardFrontmatter(markdown);
  const block = scanned.block;

  const existing = new Map<string, ExistingEntry>();
  if (block) {
    for (const entry of scanned.entries) {
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
      entry: {
        ...(cue !== undefined ? { cue } : {}),
        hash: r.op.hash,
        nid: r.nid!,
        ...(r.syncHash !== undefined ? { sync: r.syncHash } : {}),
      },
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
        entry: {
          ...(prior.entry.cue !== undefined ? { cue: prior.entry.cue } : {}),
          hash: r.op.newHash,
          nid: prior.entry.nid,
          ...(r.syncHash !== undefined
            ? { sync: r.syncHash }
            : prior.entry.sync !== undefined
              ? { sync: prior.entry.sync }
              : {}),
        },
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
      entry: {
        ...(cue !== undefined ? { cue } : {}),
        hash: r.op.newHash,
        nid,
        ...(r.syncHash !== undefined
          ? { sync: r.syncHash }
          : ex.sync !== undefined
            ? { sync: ex.sync }
            : {}),
      },
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
      if (entriesEqual(ex, action.entry)) continue; // semantic idempotence
      edits.push({
        start: ex.lineStart,
        end: ex.lineEnd,
        text: `${ex.indent}${ex.keyText}: ${desiredText}${ex.lineEnding}`,
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
  const sync = entry.sync !== undefined ? `, sync: ${entry.sync}` : "";
  if (entry.cue !== undefined) {
    return `{ cue: ${entry.cue}, nid: ${entry.nid}, hash: ${entry.hash}${sync} }`;
  }
  return `{ nid: ${entry.nid}, hash: ${entry.hash}${sync} }`;
}

function formatKey(blockId: string): string {
  if (V1_BLOCK_ID_RE.test(blockId)) return `"${blockId}"`;
  return blockId;
}

function entriesEqual(existing: ExistingEntry, desired: DesiredEntry): boolean {
  return (
    existing.cue === desired.cue &&
    existing.hash === desired.hash &&
    existing.nid === desired.nid &&
    existing.sync === desired.sync
  );
}
