# Flashcards v2 wiki

> Draft for the unpublished v2 release. Future behavior is explicitly marked
> as planned.

This page explains how to write cards, what the plugin owns, and how unusual
cases are handled. It uses simple technical English. See
[`USAGE.md`](USAGE.md) for the current implementation and
[`v2-readiness.md`](v2-readiness.md) for release work.

## Product rule

**Obsidian is the source of truth for cards created from Obsidian. Anki is the
place where you review those cards.**

Write and organize a card in Obsidian. The next sync makes Anki match the
Obsidian source. Do not use Anki to edit card text, card type, deck, or tags.
Those edits may be replaced by the next sync.

You can still create independent cards directly in Anki. The plugin does not
know about them and does not change them. These rules apply only to Anki notes
linked to an Obsidian card.

Anki still owns review data. The plugin must not replace review data during a
normal content update.

| Data | Owner | Sync rule |
| --- | --- | --- |
| Card exists or does not exist | Obsidian | Create or remove the Anki note. Removal asks first by default. |
| Front, back, extra text, and source link | Obsidian | Make Anki match Obsidian. |
| Card type | Obsidian | Change the Anki note type when possible. |
| Deck | Obsidian | Move every Anki card from the note to the resolved deck. |
| Authored tags | Obsidian | Replace authored Anki tags with the tags resolved from Obsidian. |
| Operational tags, such as `leech` and `marked` | Anki | Preserve this small documented set as review data. |
| Review history and schedule | Anki | Preserve them when Anki supports an in-place update. |
| Suspended, buried, and flagged state | Anki | Do not use these values as Obsidian card content. |
| Note-type styling | User choice | Normal sync preserves existing CSS. An explicit command can back it up and install the v2 design. |
| Obsidian anchor and Anki note ID | Shared link | Store the link in Obsidian frontmatter. |

This is not two-way sync. There is no “last edit wins” rule. A two-way rule
would need timestamps, field ownership, conflict handling, and more persistent
state. It would also make results harder to predict.

Every linked Anki note has a `Source` field. On the answer side, it shows
**Edit source in Obsidian** and the relative note path without `.md`. The link
opens the source note at the card's block anchor. When a card needs editing
during a review, follow this link and edit it in Obsidian. This reduces the need
for two-way editing without making the review flow difficult.

## State and caches

The card anchor and Anki note ID are correctness data. They keep the same Anki
note connected to the same Obsidian card. This preserves review history across
restarts and content edits.

Other local state must follow this rule:

> Deleting a cache may make the next sync slower, but it must not change the
> result or create duplicate cards.

Do not add a database for tag ownership or conflict merging. Add a derived
cache only after measurement shows a real performance problem. The cache must
be rebuildable from Obsidian and Anki.

The optional `sync` value in a `flashcards` entry is such a cache. It is a
short fingerprint of the rendered fields last written to Anki. If it is
missing, the next sync checks and rebuilds it. The Anki note ID still prevents
a duplicate card.

Vault sync also keeps `vault-scan-index.json` in the plugin directory. The
first run classifies every Markdown note. Later runs can skip reading and
parsing an unchanged note only when the previous run proved that it contained
no cards. Notes with cards are still checked against live Anki data.

Changing a note, changing plugin settings, or installing another plugin
version invalidates the relevant cached result. If the index is deleted or
corrupt, the next vault sync performs the safe full classification again. The
index is never used as card identity.

## Requirements

- Obsidian 1.13.0 or newer.
- Anki running with the AnkiConnect add-on.
- Community plugins enabled in the Obsidian vault.

The default AnkiConnect endpoint is `http://127.0.0.1:8765`.

If AnkiConnect requires an API key, open the Flashcards settings and select an
Obsidian secret under **AnkiConnect API key**. The plugin stores only the
secret name in its data. Obsidian stores the key in `SecretStorage`. The
default is no API key.

## Card syntax

All examples below show Obsidian source.

### Inline basic card

```markdown
Capital of France?::Paris
```

This creates one basic card. The left side is the question. The right side is
the answer.

### Inline reversed card

```markdown
TCP:::Transmission Control Protocol
```

This creates a note that Anki can ask in both directions.

### Cloze card

```markdown
The mitochondria is the ==powerhouse== of the cell.
The {1:powerhouse} of the cell is the {1:mitochondria}.
```

`==text==` gives each marked span its own number. `{N:text}` uses the written
number. Reuse the number to hide several spans on the same card.

Plain `{text}` is normal text, not a cloze. The plugin supports `==text==`,
`{N:text}`, and native Anki
`{{cN::text}}`. Malformed syntax stays visible and produces a warning.

**Highlight clozes** is on by default. Turn it off to use `==text==` only as
Markdown highlighting. `{N:text}` and `{{cN::text}}` still create clozes.

There is no permanent legacy parser. Run **Flashcards: Check vault for v2
syntax migration**. The read-only report shows the file, line, column, reason,
and supported replacement. Use **Open** to jump to the source. Edit the note,
then run the check or sync again.

### Fenced card

````markdown
```flashcard
front: What does CSS stand for?
back: Cascading Style Sheets
type: reversed
```
````

`front` and `back` are required for basic and reversed cards. `type` is
optional and defaults to `basic`. Use `type: reversed` for a reversed note.

For an explicit cloze card, use `type: cloze`. `front` becomes Anki's `Text`
field. `back` is optional and becomes Anki's `Extra` field.

### Hashtag card

```markdown
# What is recursion? #card

A function that calls itself, with a base case.
```

`#card` creates a basic card. `#card-reverse` and `#card/reverse` create a
reversed card.

The marker may also be a separate paragraph immediately after a heading:

```markdown
## What is recursion?

#card

A function that calls itself.
```

This has the same section boundary as putting `#card` in the heading.

### Reminder card

```markdown
Keep the feedback loop short. #card-reminder
```

A reminder has one piece of content and no answer. It is useful for a quote,
principle, behavior, or practice that should return occasionally. After you
reveal it, Anki asks **How soon should this come back?** Anki's standard Again,
Hard, Good, and Easy buttons control when it returns. They are not a strict
yes/no input.

A reminder paragraph owns only that paragraph. It does not use the next
paragraph as an answer. A tagged heading uses only the heading text. For
longer content, use an explicit block:

````markdown
```flashcard
type: reminder
content: Prefer reversible decisions when uncertainty is high.
```
````

The public name is **Reminder**, and the Anki content field is `Content`. V2
does not use `Prompt` because that word now commonly means an instruction to
an LLM.

V1 used `#card-spaced` and `#card/spaced`. Run **Flashcards: Check vault for
v2 syntax migration** and replace either marker with `#card-reminder`. The
next sync converts an existing linked `Obsidian-spaced` note in place, so its
Anki note ID and review history remain.

### Card callout

```markdown
> [!CARD] : What is recursion?
> A function that calls itself.
>
> It needs a base case.
```

`[!CARD]` is case-insensitive. The text after the marker is the question. The
callout body is the answer. The optional colon only improves readability.

Ordinary callouts remain content. When they are inside a card, Anki receives a
normal blockquote without the `[!type]` control marker.

### Lists

An inline card in a list item owns that item and all child blocks:

```markdown
- What is TCP?::Transmission Control Protocol.

  This child paragraph is part of the same answer.
```

A sibling list item is a separate card. Keep it at the same indentation:

```markdown
- First question?::First answer.

  More detail for the first answer.

- Second question?::Second answer.
```

Indented items belong to their parent card. They do not start a second card.
To end the first card, start another item at the same indentation or leave the
list and start another card block.

A list containing cloze syntax becomes one cloze note, not one note per item:

```markdown
- The ==heart== pumps blood.
- The {2:lungs} exchange gases.
```

### Atomic note card

An atomic card uses the first paragraph as its authored content. The `test`
frontmatter property selects the question type.

```markdown
---
test: title
---

The first paragraph becomes the answer.
```

`test: title` asks for the note filename. `test: reversed` makes the filename
and first paragraph reversible. `test: cloze` creates a cloze from the first
paragraph and leaves Anki's Extra field empty. A custom value, such as
`test: Define recursion`, uses that value as the question and the first
paragraph as the complete answer. The plugin does not add the filename to a
custom answer.

## Which syntax wins

An explicit card container owns its full source range. Text inside that range
is card content. It cannot create another card.

The precedence is:

1. Atomic note, fenced card, and `[!CARD]` callout containers.
2. Hashtag card containers.
3. Inline list cards, including their child blocks.
4. Inline reversed cards.
5. Inline basic cards.
6. Cloze cards, including complete cloze lists.

For example, `Answer::detail` inside a hashtag answer is part of the answer.
It does not create a second inline card.

Disabled syntax does not claim a range. A `test:` key selects atomic authoring
for implicit inline and cloze syntax in that note. If its value is invalid,
sync reports the error and does not reinterpret the prose as implicit cards.
Explicit fenced and hashtag cards remain available.

**Inline cards** is on by default. Turn it off to stop `::` and `:::` from
creating cards. The other card types still work.

## Hashtag answer boundaries

A tagged heading owns its section. The answer continues until the next heading
of the same or a higher level, or until the next explicit card starts. Lower
headings are part of the answer.

```markdown
## First question

#card

First answer.

### Detail included in the first answer

More detail.

## Second question

#card

Second answer.
```

Here, `### Detail...` stays in the first answer. `## Second question` ends the
first card because it is at the same heading level. A `#` heading would also
end it. A heading below `###` would stay inside the answer.

```markdown
## What is a process? #card

A running instance of a program.

### Details

It has memory and operating-system resources.

## Next topic
```

A tagged paragraph uses the content after the marker in the same paragraph. If
there is no content there, it uses the next top-level Markdown block. One block
can be a paragraph, list, blockquote, or code block. It does not consume a block
that starts another card; an empty answer produces a warning.

Use a tagged heading when the answer needs several blocks. Use a fenced card
when you need an exact explicit container. This rule needs no special
continuation marker.

## Markdown, code, and math

The Markdown parser defines structural boundaries. Inline code, code blocks,
math, links, emphasis, lists, and quotes keep their Markdown meaning. Card
markers inside code or math are not parsed as cards.

Outside automatic cloze fields, Obsidian `==highlight==` syntax renders as
highlighted text in Anki. This includes text inside explicit basic or reversed
cards. In a cloze card with **Highlight clozes** enabled, the same syntax
creates a cloze instead. Highlight markers inside code or math stay literal.

A cloze may contain a complete math expression when the cloze marker is
outside the math delimiters:

```markdown
First $a+b$, then {1:$c+d$}, then $e+f$.
```

The parser reads this as normal math, one cloze containing math, then normal
math. LaTeX braces inside math are not cloze markers.

The plugin converts Markdown math delimiters to the delimiters required by
Anki. It does not change the Obsidian source.

## Decks

The first available value wins:

1. The note property `cards-deck`.
2. The note folder when folder-based decks are enabled.
3. The `defaultDeck` setting.

Example:

```yaml
---
cards-deck: Knowledge::Biology
---
```

Anki uses `::` between parent and child decks.

Folder-based decks are on by default. **Folder deck prefix** is empty by
default. If it is `Obsidian` and a note is in `Biology/Cells/`, the derived
deck is `Obsidian::Biology::Cells`. The prefix never changes an explicit
`cards-deck` value.

## Tags

Tags come from two Obsidian sources:

- The plugin `defaultTags` setting.
- The note's `tags` frontmatter property.

Duplicate tags are removed.

**Folder tags** is off by default. When enabled, a note in
`Biology/Cells/Note.md` gets one derived tag: `Biology::Cells`.

This resolved set is the complete desired set of authored tags. If a source
tag is removed in Obsidian, sync removes it from Anki. If an authored tag is
added only in Anki, the next sync removes it. This needs no tag ownership
database and has one predictable result.

Anki also uses a small number of tags as review controls. The plugin preserves
the built-in `leech` and `marked` tags even when they are not in Obsidian. It
does not promise to preserve tags created by other Anki add-ons. Add any tag
that must persist to the Obsidian note.

## Sync behavior

The plugin gives each card an Obsidian block anchor and stores the matching
Anki note ID in the note's `flashcards` frontmatter map.

The Anki `Source` field links back to that exact block, not only to the start of
the note. The link is shown on the answer side of cards created by the plugin.

Normal sync can:

- create a missing Anki note;
- update changed content;
- move an existing note to another deck;
- change between basic and reversed without replacing the shared Anki card;
- recover when a stored Anki note ID no longer exists;
- ask before a destructive change, such as deletion or crossing the cloze
  note-type boundary.

Sync also compares live Anki fields and tags with the last successful Obsidian
write. It repairs Anki-only edits even when the Obsidian file has not changed.

### Cards created before the v2 design

Existing cards do not need to be recreated. They use one of the shared managed
Anki models, so updating that model changes the display of all cards that use
it while their note IDs, schedules, and review history stay the same. This also
changes the appearance of any card created manually with the same managed model.

Normal sync does not replace custom templates or CSS. To opt in, run
**Flashcards: Apply v2 Anki card style** from the command palette. The preview
lists the models that will change and any incompatible model that will be
skipped. A compatible old model may receive the missing `Source` field.

After confirmation, the plugin first saves the exact current fields, templates,
and CSS here:

```text
.obsidian/plugins/flashcards-obsidian/backups/anki-style-<timestamp>.json
```

Only after that backup succeeds does it update Anki. The command replaces
custom template HTML and CSS by design. Cancel the preview to keep the current
style.

## Defaults

You do not need to write default values in a note or change them in settings.

| Setting | Default | Meaning |
| --- | --- | --- |
| Minimum Obsidian version | `1.13.0` | Older versions are not supported. |
| Default deck | `Default` | Used when neither frontmatter nor folder selects a deck. |
| Folder-based decks | On | A note in `Biology/Cells.md` uses deck `Biology`. |
| Folder deck prefix | Empty | Optional parent for folder-derived decks only. |
| Folder tags | Off | Optionally add one hierarchical folder-path tag. |
| Default tags | `obsidian` | Added to every card. |
| Context | Heading path | Parent headings appear above the active question. Reversed cards use the same context in both directions. |
| Context separator | ` > ` | Separates nested heading parts inside the context. |
| Basic separator | `::` | Defines an inline basic card. |
| Reversed separator | `:::` | Defines an inline reversed card. |
| Inline cards | On | Allows `::` and `:::` to create cards. |
| Highlight clozes | On | Allows `==text==` to create automatic clozes. |
| Fenced card label | `flashcard` | Starts an explicit fenced card. |
| Hashtag syntax | On | Uses `#card` by default. |
| Atomic syntax | On | Enables the `test` frontmatter property. |
| Confirm before delete | On | Prevents automatic loss of review history. |
| Reading and live preview | On | Hides or styles supported card markers. |
| File logging | On | Writes a bounded `sync.log` in the plugin folder. |
| AnkiConnect API key | None | Optional key selected from Obsidian secrets. |

## Edge cases

### A card marker appears in code or math

It is content, not a card marker.

### A wikilink target does not exist

The wikilink stays as visible `[[text]]`. The plugin does not create a new
Obsidian note when you click from Anki. Create the target note in Obsidian and
sync again to turn it into a clickable link.

### A hashtag answer contains `::` or a cloze

The hashtag container owns the text. It creates one card.

### A cloze delimiter is not closed

The source stays visible. Sync reports a warning and does not guess.

### A card is edited only in Anki

Review data is preserved. Obsidian-owned content is restored on the next sync.

### A card is deleted only in Anki

If the card still exists in Obsidian, sync creates it again and stores the new
Anki note ID. Deleted Anki review history cannot be recovered.

### A card is deleted in Obsidian

The plugin asks before deleting the linked Anki note by default. This safety
step exists because deleting the Anki note also deletes its review history.

### A card changes between basic and cloze

Anki cannot preserve this safely as a normal in-place change. The plugin asks
before replacing the Anki note. Replacement loses its old review history.

## Migration policy

V2 does not keep two parsing paths.

Before a breaking grammar change, a migration check must:

1. Find unsupported syntax without changing the note.
2. Report the file, line, and reason.
3. Show the supported replacement.
4. Let the user open and edit the Obsidian source.
5. Make no automatic source changes.

This keeps the runtime parser small and makes every v2 note follow the same
rules.
