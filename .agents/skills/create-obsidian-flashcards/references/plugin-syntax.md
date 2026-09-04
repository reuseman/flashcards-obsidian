# Flashcards plugin v2 syntax

Use this reference before writing cards into a note. These are authoring forms;
the plugin adds identity metadata during update.

## Select a card type

| Need | Preferred form |
| --- | --- |
| Short question and answer | Inline basic |
| Both directions are useful | Inline or fenced reversed |
| Recall missing content in context | Cloze |
| Multi-block answer under a topic | Hashtag heading |
| Exact explicit boundaries | Fenced card or card callout |
| One principle should return periodically | Reminder |
| The whole note is intentionally one concept | Atomic note |

## Inline cards

Basic:

```markdown
What is the capital of France?::Paris
```

Reversed:

```markdown
TCP:::Transmission Control Protocol
```

An inline card inside a list item owns the item and its indented child blocks.
A sibling item at the same indentation starts a separate card.

## Cloze cards

```markdown
The mitochondria is the ==powerhouse== of the cell.
The {1:heart} pumps blood through the {1:circulatory system}.
```

`==text==` uses automatic numbers. `{N:text}` uses an explicit number. Reuse
`N` when several spans should be hidden together. Native `{{cN::text}}` is also
supported.

Keep the cloze in a sentence or other context that identifies the intended
answer. Do not use a cloze only to remove an arbitrary word from copied prose.

## Fenced cards

Basic or reversed:

````markdown
```flashcard
front: What does CSS stand for?
back: Cascading Style Sheets
type: reversed
```
````

`type` is optional and defaults to `basic`. Supported values are `basic`,
`reversed`, `cloze`, and `reminder`.

A cloze fence uses `front` as Anki's Text field. Its optional `back` becomes
Extra. A reminder fence uses one `content` field:

````markdown
```flashcard
type: reminder
content: Prefer reversible decisions when uncertainty is high.
```
````

## Hashtag cards

```markdown
## What is recursion? #card

A function that calls itself and has a base case.
```

Use `#card-reverse` or `#card/reverse` for a reversed card. The marker may be
on its own line immediately after the heading.

A heading card owns its full section. Lower headings stay in its answer. A
heading at the same or a higher level ends the answer.

A paragraph with `#card` uses text in the same paragraph after the marker. If
there is none, it uses the next top-level Markdown block. Use a heading or an
explicit container for longer answers.

## Reminder cards

```markdown
Keep the feedback loop short. #card-reminder
```

A reminder has content but no answer. A reminder paragraph owns only that
paragraph. V1 `#card-spaced` syntax is not supported.

## Card callouts

```markdown
> [!CARD] : What is recursion?
> A function that calls itself.
>
> It needs a base case.
```

The callout is an explicit container. Its title is the question and its body is
the answer.

## Atomic note cards

Use atomic syntax only when the note is intentionally authored as one card.
The first paragraph is its content.

```markdown
---
test: Define recursion
---

A function that calls itself and has a base case.
```

`test: title` uses the filename as the question. `test: reversed` makes the
filename and first paragraph reversible. `test: cloze` creates a cloze from
the first paragraph.

## Boundaries and precedence

An explicit card container owns its source range. Card-like text inside that
range is content, not another card.

The precedence is:

1. Atomic note, fenced card, and card callout.
2. Hashtag card.
3. Inline list card and its child blocks.
4. Inline reversed card.
5. Inline basic card.
6. Cloze card.

Do not place a second card inside a container. End the first container, then
start the next card.

## Decks, tags, and context

An explicit note deck uses:

```yaml
---
cards-deck: Knowledge::Biology
tags:
  - biology
  - exam
---
```

Without `cards-deck`, folder-based decks are on by default. The final fallback
deck is `Default`. The default tag is `obsidian`. Parent headings are the
default context shown above the review question.

## Managed metadata

Do not write or edit these values:

- the `flashcards` frontmatter property;
- `^q-xxxx` anchors;
- legacy numeric anchors;
- Anki note IDs, source hashes, or sync hashes.

The plugin creates and maintains them. Preserve existing values when editing a
note.

For complete edge cases, read `docs/wiki.md` in the repository.
