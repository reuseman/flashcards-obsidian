import type { ObsidianMarkdownRepository } from "../adapters/obsidian/obsidian-markdown-repository.js";
import type { FlashcardsSettings } from "../core/config/settings.js";
import { ensureNoteFrontmatter } from "../core/edits/ensure-note-frontmatter.js";
import { extractCardsFromMarkdown } from "../core/parse/extract-cards.js";

export interface SyncCurrentNoteResult {
  cardCount: number;
  editCount: number;
  notePath: string;
}

export async function syncCurrentNote(
  repository: ObsidianMarkdownRepository,
  settings: FlashcardsSettings,
): Promise<SyncCurrentNoteResult | null> {
  const note = await repository.getActiveNote();
  if (!note) {
    return null;
  }

  const result = extractCardsFromMarkdown(note.markdown, {
    notePath: note.path,
    settings,
  });
  const frontmatterResult = ensureNoteFrontmatter(note.markdown, {
    hasCards: result.cards.length > 0,
    settings,
  });

  if (frontmatterResult.changed) {
    await repository.saveNote(note, frontmatterResult.markdown);
  }

  return {
    cardCount: result.cards.length,
    editCount: frontmatterResult.edits.length,
    notePath: note.path,
  };
}
