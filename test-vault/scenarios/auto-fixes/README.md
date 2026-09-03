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
   - Render flashcard syntax: on
   - Cloze rendering: on
   - Sync-anchor rendering: on
   - Inline-separator rendering: off
   - Hashtag rendering: on

Run **Flashcards: Sync current note** on each numbered note. Then inspect its
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
  moves, and recovery after deleting a card in Anki.

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

The tag on this note is useful for finding and deleting the disposable cards.
Tag updates on existing notes are not part of this check because tag ownership
is still undecided.

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
