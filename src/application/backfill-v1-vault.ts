import type { MarkdownRepository } from "./ports.js";
import type { FlashcardsSettings } from "../core/config/settings.js";
import { applyTextEdits } from "../core/edits/apply-text-edits.js";
import { backfillV1Anchors } from "./backfill-v1-anchors.js";

export interface BackfillV1VaultInput {
  repository: MarkdownRepository;
  settings: FlashcardsSettings;
}

export interface BackfillV1VaultResult {
  notesUpdated: number;
  totalBackfilledCount: number;
}

/**
 * Vault-wide v1 anchor backfill. Iterates every markdown note, computes the
 * v1 → v2 frontmatter migration edits, and writes them back. Notes with no
 * unmigrated v1 anchors are skipped.
 */
export async function backfillV1Vault(
  input: BackfillV1VaultInput,
): Promise<BackfillV1VaultResult> {
  const { repository, settings } = input;
  const notes = await repository.getAllMarkdownNotes();

  let notesUpdated = 0;
  let totalBackfilledCount = 0;

  for (const note of notes) {
    const result = backfillV1Anchors({
      markdown: note.markdown,
      notePath: note.path,
      settings,
    });
    if (result.edits.length === 0) continue;
    const next = applyTextEdits(note.markdown, result.edits);
    if (next === note.markdown) continue;
    await repository.saveNote(note, next);
    notesUpdated += 1;
    totalBackfilledCount += result.backfilledCount;
  }

  return { notesUpdated, totalBackfilledCount };
}
