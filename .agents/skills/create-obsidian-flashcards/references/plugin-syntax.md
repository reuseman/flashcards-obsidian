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
| One claim worth asking several ways | Atomic note, several `test:` items |

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
The answer is always the first paragraph of the body. Everything after the
first paragraph is never read.

Write `test:` as a list of strings. A bare scalar is accepted and normalised
to a one-item list, but the list form is the convention — it keeps the
Obsidian Properties panel consistent across notes.

```markdown
---
test:
  - Define recursion
---

A function that calls itself and has a base case.
```

Each item produces one card. An item is either a reserved keyword or a
question you write:

| Item | Question | Result |
| --- | --- | --- |
| `title` | the filename | basic |
| `reversed` | filename and first paragraph, both directions | one note, two cards |
| `cloze` | first paragraph with its `==spans==` hidden | cloze |
| any other string | that string | basic |

Several items ask the same claim from different angles and share one answer:

```markdown
---
test:
  - title
  - "Re-reading feels productive. What does it fail at?"
---
```

That note produces two cards with the same answer. Use multiple items only
when the cues probe the *same* claim. Cues that need different answers mean
the note is not atomic — split it instead.

Rules that silently produce zero cards if broken. Check them before writing:

- Items must be unique. A repeated item invalidates the whole `test:` key.
- A question you write must not equal the filename, and must not duplicate
  what another item derives. Both collide with the card `title` produces.
- `reversed` and `cloze` may each appear at most once.
- Nested maps or non-string items are an error, never guessed at.

Two further conditions are reported as warnings and leave the note alone: a
`test:` key with no first paragraph, and a `cloze` item whose first paragraph
contains no `==span==`.

A note without a `test:` key is not a card. That is the correct default for
bridge notes, structure notes, and anything whose value is its links.

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
