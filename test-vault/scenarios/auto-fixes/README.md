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
