---
cards-deck: Flashcards V2 issue 231
tags:
  - flashcards-v2-issue-231
---

# Cloze highlight contrast (issue #231, item 4)

No sync needed — this is a pure rendering check inside Obsidian.

`styles.css` used to hardcode `background: #fff3a8` for `.ff-cloze` and `mark`
in both Reading mode and Live Preview, with no `color`. Text inherited
`--text-normal`, which is light in dark themes: light grey on pale yellow.

It now uses `var(--text-highlight-bg)` with an explicit
`color: var(--text-normal)`, so the theme owns both sides of the contrast and a
CSS snippet can still override it.

## What to look at

Chlorophyll absorbs {{c1::light energy}} in the thylakoid membrane.

Numbered shorthand: the {2:lungs} exchange gases.

==Contrast sample== inside a sentence.

A longer paragraph so the highlight is judged against normal body text rather
than in isolation: the {{c1::hippocampus}} consolidates declarative memory,
while the {{c2::amygdala}} tags it with emotional salience.

## How to check

1. Toggle Settings → Appearance → Base colour theme between Light and Dark, in
   both Live Preview and Reading mode.
2. Repeat with a community theme that overrides text colours (the reporter used
   "Things").
3. The highlighted text must stay readable in every combination. Run
   `npm run build` first — `styles.css` is copied into the vault by the
   postbuild hook, and Obsidian needs a reload (Ctrl+R) to pick it up.
