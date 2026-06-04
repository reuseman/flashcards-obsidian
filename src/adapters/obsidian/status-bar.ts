import { setIcon } from "obsidian";

import { detectV1Migration } from "../../application/detect-v1-migration.js";
import type { FlashcardsSettings } from "../../core/config/settings.js";
import { computeCardHash } from "../../core/edits/card-hash.js";
import { insertCardAnchors } from "../../core/edits/insert-card-anchors.js";
import { extractCardsFromMarkdown } from "../../core/parse/extract-cards.js";
import { buildSyncPlan } from "../../core/sync/build-sync-plan.js";
import { parseCardFrontmatter } from "../../core/sync/parse-card-frontmatter.js";
import type { MarkdownRepository } from "../../application/ports.js";

const NO_CARDS = "Note: no cards";
const IN_SYNC = "Note: in sync";

/**
 * Aggregate status for the active note. Runs the same Phase A + Phase B
 * planning the sync command would run, but in-memory (no edits, no Anki).
 *
 * Returns one of:
 *   - "Flashcards: no cards" — 0 cards parsed
 *   - "Flashcards: in sync" — cards exist, no pending ops, no v1 pending
 *   - "Flashcards: 2 new, 1 modified, 3 pending migration" — any combination
 *     of: NEW (no anchor yet), MODIFIED (v2 anchor + stale hash), and
 *     PENDING MIGRATION (v1 anchors with no frontmatter entry — invisible
 *     to the sync diff until the user opts in to migration).
 */
export function computeActiveNoteStatus(
  markdown: string,
  notePath: string,
  settings: FlashcardsSettings,
): string {
  const { cards } = extractCardsFromMarkdown(markdown, { notePath, settings });
  if (cards.length === 0) return NO_CARDS;

  let counter = 0;
  const insert = insertCardAnchors({
    cards,
    generateBlockId: () => `q-tmp${counter++}`,
    markdown,
  });
  const frontmatter = parseCardFrontmatter(markdown);
  const plan = buildSyncPlan({
    cards: insert.cards,
    computeHash: computeCardHash,
    frontmatter,
  });

  const newCount = plan.create.length;
  const modCount = plan.update.length;
  const legacyCount = detectV1Migration({ markdown }).unmigrated;

  if (newCount === 0 && modCount === 0 && legacyCount === 0) return IN_SYNC;

  const parts: string[] = [];
  if (newCount > 0) parts.push(`${newCount} new`);
  if (modCount > 0) parts.push(`${modCount} modified`);
  if (legacyCount > 0)
    parts.push(`${legacyCount} pending migration`);
  return `Note: ${parts.join(", ")}`;
}

/**
 * Sums unmigrated v1 anchors across every markdown note in the vault.
 * Cheap enough for non-debounced calls on small vaults; debounce upstream
 * for vault-modify events on large ones.
 */
export async function computePendingV1Count(
  repository: MarkdownRepository,
): Promise<number> {
  const notes = await repository.getAllMarkdownNotes();
  let total = 0;
  for (const n of notes) {
    total += detectV1Migration({ markdown: n.markdown }).unmigrated;
  }
  return total;
}

/** Toggles visibility via inline style — avoids needing a stylesheet entry. */
function setVisible(el: HTMLElement, visible: boolean): void {
  el.style.display = visible ? "" : "none";
}

export function renderActiveNoteStatus(
  el: HTMLElement,
  text: string | null,
): void {
  if (text === null) {
    setVisible(el, false);
    el.setText("");
    return;
  }
  setVisible(el, true);
  el.setText(text);
}

export function renderPendingV1(el: HTMLElement, count: number): void {
  if (count <= 0) {
    setVisible(el, false);
    el.empty();
    return;
  }
  setVisible(el, true);
  el.empty();
  el.style.color = "var(--text-warning)";
  el.style.display = "inline-flex";
  el.style.alignItems = "center";
  el.style.gap = "4px";
  const iconSpan = el.createSpan();
  setIcon(iconSpan, "alert-triangle");
  el.createSpan({ text: `Vault: ${count} pending migration` });
  el.setAttribute(
    "aria-label",
    `${count} flashcards across the vault are from an older version of the plugin and are awaiting migration. Run "Flashcards: Sync vault" to be offered the migration.`,
  );
}
