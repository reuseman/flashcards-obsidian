import type { MarkdownNote } from "../adapters/obsidian/obsidian-markdown-repository.js";
import { detectV1Migration } from "./detect-v1-migration.js";

export interface MigrationCheckInput {
  decisionMade: boolean;
  notes: MarkdownNote[];
}

export type MigrationCheckResult =
  | { decision: "skip" }
  | {
      affectedNoteCount: number;
      decision: "ask";
      unmigratedCount: number;
    };

/**
 * Pure decision for whether to prompt the user about migrating v1 anchors.
 *
 * - If the user has already made a decision, always skip.
 * - Otherwise, scan all notes; if any have unmigrated v1 anchors, return
 *   `ask` with aggregate totals. Else skip.
 */
export function migrationCheck(
  input: MigrationCheckInput,
): MigrationCheckResult {
  const { decisionMade, notes } = input;

  if (decisionMade) return { decision: "skip" };

  let unmigratedCount = 0;
  let affectedNoteCount = 0;
  for (const note of notes) {
    const { unmigrated } = detectV1Migration({ markdown: note.markdown });
    if (unmigrated > 0) {
      unmigratedCount += unmigrated;
      affectedNoteCount += 1;
    }
  }

  if (unmigratedCount === 0) return { decision: "skip" };

  return {
    affectedNoteCount,
    decision: "ask",
    unmigratedCount,
  };
}
