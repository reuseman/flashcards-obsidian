# V2 automatic fixes

Use these notes with the current plugin build.

## Before testing

1. Reload Obsidian with `Ctrl+R` or `Cmd+R`.
2. Open **Settings → Community plugins → Flashcards**.
3. Check that the settings use normal Obsidian controls.
4. The default values are:
   - Default deck: `Default`
   - Context: `Headings`
   - Context separator: ` > `
   - Confirm before deleting: on
   - Inline cards: on
   - Highlight clozes: on
   - Folder-based decks: on
   - Folder deck prefix: empty
   - Folder tags: off
   - AnkiConnect API key: none
   - Render flashcard syntax: on
   - Cloze rendering: on
   - Sync-anchor rendering: on
   - Inline-separator rendering: off
   - Hashtag rendering: on

Run **Flashcards: Update Anki from current note** on each numbered note. Then inspect its
cards in Anki.

## Notes

- `01-context-headings.md` shows heading context on inline, cloze, fenced, and
  hashtag cards. It also skips a heading level without losing context.
- `02-context-modes.md` shows the same card with each context setting.
- `03-yaml-block-tags.md` shows an Obsidian block-style tag list.
- `04-markdown-preservation.md` shows bold text, emphasis, links, images, and
  inline code. Code containing card-like text must not create extra cards.
- `05-atomic-context.md` shows heading context on an atomic card.
- `06-existing-card-sync.md` is the manual check for card type changes, deck
  moves, stale IDs, tags, and Anki-only field edits.
- `07-strict-grammar.md` shows math-safe cloze parsing, container precedence,
  and Markdown-node boundaries for hashtag answers.
- `08-accepted-features.md` shows a separate heading marker, a card callout,
  an inline list card with children, one cloze note from a list, a fenced cloze
  with Extra text, and a long code line.

Run **Flashcards: Check vault for v2 syntax migration** before syncing an old
vault. The command must not change any file. Each result shows a path and exact
location; **Open** jumps to that source.

## Existing-card sync check

Use `06-existing-card-sync.md` with Anki open:

1. Sync it once. It creates one basic, one reversed, and one cloze note in the
   `Flashcards V2 checks` deck.
2. Change the first card separator from `::` to `:::` and sync again. Its note
   ID stays the same and Anki adds the reverse card.
3. Change that separator back to `::` and sync. The note ID still stays the
   same and the reverse card is removed.
4. Change `cards-deck` to `Flashcards V2 moved` and sync. Every generated card
   moves to that deck.
5. Change the first card into a cloze sentence such as `A ==byte== has eight
   bits.` while keeping its `^q-xxxx` anchor. Sync, read the warning, and
   confirm. The source identity stays the same, but Anki uses a new note ID and
   has no invalid extra card.
6. Delete the second note directly in Anki, then sync again. The plugin creates
   it again, replaces its missing note ID, and reports one recovered card.
7. Add a frontmatter tag and sync. It appears in Anki. Remove it and sync; it
   disappears. Add a `manual-only` tag directly in Anki; sync removes it. The
   Anki review tags `leech` and `marked` are preserved.
8. Edit the first note's Front or Back field directly in Anki. Do not change
   the Obsidian note. Sync again; the field returns to the Obsidian value and
   the note ID and review schedule stay unchanged.

The tag on this note is useful for finding and deleting the disposable cards.

## Strict grammar check

Sync `07-strict-grammar.md`. It creates three notes:

1. One cloze note whose math braces remain literal in Anki.
2. One heading hashtag note. Its `::`, `:::`, and cloze-looking answer text are
   content, not extra cards. The lower heading is part of the answer.
3. One paragraph hashtag note whose answer is exactly the following list.

The plain braces, inline code, math-only markers, and fenced example near the
end of the note must not create cards.

## Accepted-feature check

Sync `08-accepted-features.md`. It creates five Anki notes. Confirm that:

1. The standalone `#card` marker owns the complete heading section.
2. The `[!CARD]` marker is absent in Anki and its long code line wraps.
3. The inline list card includes its child paragraph and nested item.
4. The two-item cloze list is one Anki note.
5. The fenced cloze back appears in Anki's `Extra` field.
6. After showing an answer, **Edit source in Obsidian** and the relative note
   path appear on the back. The link opens the exact source block. The first
   sync may report that it repaired existing Anki templates.

## Context-mode check

Use `02-context-modes.md` for this check:

| Context setting | Expected front |
| --- | --- |
| Headings (default) | `Parent > Child > What context is active?` |
| Note title | `02-context-modes > What context is active?` |
| None | `What context is active?` |

Set **Context separator** to `\n` to put each context part on a new line.

The CI and adapter-test fixes do not have a note example. They are checked by
the automated test suite.
