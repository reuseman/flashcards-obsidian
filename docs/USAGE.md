# Flashcards — usage

End-user manual for v2. For development notes, see `../CONTRIBUTING.md`.

## Requirements

- Obsidian 1.13.0 or newer.
- Anki with the **AnkiConnect** add-on installed and running. Default
  endpoint: `http://127.0.0.1:8765`.
- Community plugins enabled for the vault (Settings → Community plugins →
  *Turn on community plugins*; trust the author on first open).

Follow the [installation steps](../README.md#install) to set up both apps.
Flashcards 2.0.1 and later work with AnkiConnect's default settings. You do not
need to add `app://obsidian.md` to `webCorsOriginList`.

The first sync auto-creates Anki note types (`Obsidian-basic`,
`Obsidian-basic-reversed`, `Obsidian-cloze`, `Obsidian-reminder`) and any decks
it needs.

## Commands

From the command palette (`Cmd/Ctrl+P`):

- **Flashcards: Update Anki from current note** — updates Anki from the active note.
- **Flashcards: Update Anki from vault** — updates Anki from every markdown note.
- **Flashcards: Check vault for v2 syntax migration** — reports old syntax and
  opens each source location without changing the vault.
- **Flashcards: Apply v2 Anki card style** — previews and backs up existing
  managed Anki models, then installs the v2 design after confirmation.

Running an update again does not duplicate unchanged cards.

The first vault sync reads every Markdown note. It records which notes contain
no cards in a disposable `vault-scan-index.json` file inside the plugin folder.
Later vault syncs skip reading and parsing those notes while they remain
unchanged. Notes containing cards are still checked against Anki. The final
notice reports how many unchanged card-free notes were skipped.

Deleting the index is safe. The next vault sync rebuilds it with one full scan.

## Write cards

### Inline

```text
Capital of France?::Paris
```

`Question::Answer` produces a basic card.
`Question:::Answer` (triple colon) produces a reversed card.

The separators are configurable in settings.

### Cloze

```text
The mitochondria is the ==powerhouse== of the cell.
The {1:powerhouse} of the cell is the {1:mitochondria}.
```

`==text==` auto-numbers each cloze (`c1`, `c2`, … in source order).
`{N:text}` uses an explicit number — repeat the same `N` to hide
multiple spans together on a single card.

### Fenced block (multi-line)

````markdown
```flashcard
front: What does CSS stand for?
back: Cascading Style Sheets, a stylesheet language for HTML and XML.
```
````

`front:` and `back:` are required fields; an optional `type: reversed`
produces a reversed card (default is basic). Keys may appear in any order.

A fenced reminder has one `content:` field instead:

````markdown
```flashcard
type: reminder
content: Prefer reversible decisions when uncertainty is high.
```
````

Field values may span multiple lines: a value is the text after `key:`
plus every following line, up to the next key line or the closing fence,
joined with newlines. Blank lines inside a value are preserved; only the
whole value is trimmed.

````markdown
```flashcard
front: What is the CAP theorem?
back: A distributed store provides at most two of:
Consistency, Availability, Partition-tolerance.
Under a partition you choose C or A.
type: basic
```
````

**Reserved-key caveat:** a continuation line that itself begins with
`front:`, `back:`, `content:`, or `type:` starts that key instead of being
read as content. To include such a line verbatim in a value, reword it so it
does not begin with a reserved key.

If `front:` or `back:` is missing or empty, no card is produced and a
warning is logged.

### Hashtag (`#card`)

```text
# What is recursion? #card
A function that calls itself, with a base case to terminate.
```

Recognised at headings (h1–h6) and paragraphs. `#card` is basic,
`#card-reverse` or `#card/reverse` is reversed. The hashtag can sit inline
(end of the question line) or on its own line below.

A heading card owns its heading section. A lower-level heading stays in its
answer. A heading at the same or a higher level ends the card. For example, a
`##` card may contain `###` details; the next `##` or `#` starts a new section.

An inline card in a list owns its list item, including indented paragraphs and
nested lists. Another item at the same indentation can be another card:

```text
- First question?::First answer.

  More detail for the first answer.

- Second question?::Second answer.
```

The plugin writes `^q-xxxx` anchors to preserve card identity. They are source
metadata and are not part of the rendered Anki card.

### Reminder

```text
Keep the feedback loop short. #card-reminder
```

A reminder has one piece of authored content and no answer. After you reveal
it, Anki asks **How soon should this come back?** Use Anki's normal scheduling
buttons: **Again** returns it soon, **Good** uses the normal interval, and
**Easy** waits longer. You can use the result of a personal check-in to choose
the interval, but the buttons are not a strict yes/no input.

A reminder paragraph owns only that paragraph. It does not consume the next
paragraph as an answer. A tagged heading uses only its heading text. Use the
fenced form when the content needs several lines.

V1 used `#card-spaced` and `#card/spaced`. V2 does not parse those markers.
Run **Flashcards: Check vault for v2 syntax migration**, replace the reported
marker with `#card-reminder`, and sync. A linked v1 spaced note moves to the
new reminder model without changing its Anki note ID or review history.

Configurable via `hashtag.basicTag` (default `card`). Set
`hashtag.enabled: false` to disable hashtag recognition entirely.

### Card callout

```markdown
> [!CARD] What is recursion?
> A function that calls itself.
>
> It needs a base case to stop.
```

The callout title is the question and the callout body is the answer. Use it
when you want the card's start and end to be obvious in the note.

Everything inside the callout belongs to that one card. Card-like text in the
body, such as `this::that`, stays part of the answer instead of becoming a
second card. Add `-` or `+` after `[!CARD]` to make the callout foldable, and
a `:` after it if you prefer `> [!CARD] : Question`.

### Atomic note (`test:` in frontmatter)

Use this when the whole note is one idea and you want the note itself to be
the card. There is no syntax in the body at all — you add a `test:` key to the
frontmatter:

```markdown
---
test:
  - "Why does spacing beat cramming?"
---

The same total practice time retains better when spread out, because partial
forgetting between sessions forces effortful reconstruction.

This paragraph is never part of the card.
```

**The answer is always the first paragraph of the note.** Anything after it —
evidence, citations, links — stays out of the card. The question comes from
each item in the `test:` list. An item can be:

| `test:` item | Question | Cards |
| --- | --- | --- |
| `title` | the file name | 1 basic |
| `reversed` | file name and first paragraph, both directions | 1 note, 2 cards |
| `cloze` | first paragraph with its `==spans==` hidden | 1 cloze |
| any other text | that text, written by you | 1 basic |

List several items to ask the same idea in several ways. They share one
answer:

```markdown
---
test:
  - title
  - "Re-reading feels productive. What does it fail at?"
---
```

That note produces two cards with the same answer.

Rules worth knowing:

- Write `test:` as a list. A single value on one line also works, but the list
  form keeps the Properties panel consistent across notes.
- Every item must be different, and a question you write must not repeat the
  file name. A repeat makes the whole `test:` key invalid and the note
  produces no cards. The reason and the note path are written to the log
  (see [Logging](#logging)).
- `reversed` and `cloze` can each appear once.
- A note with no `test:` key is not a card. That is the normal state for most
  notes.
- To put the file name on the back of the card as well, set the context
  strategy to **Note title** in settings.

If the note has a `test:` key, the plugin stops looking for `::`, `==cloze==`
and other body syntax in that note, so prose stays prose.

Two more problems are logged as warnings rather than errors: a **thin card**
(a `test:` key but no first paragraph) and a **cloze item with no `==spans==`
in the first paragraph**. Both leave the note alone until you fix it.

### What is *not* parsed

Cards inside code fences and HTML comments are skipped. Ordinary blockquotes
are skipped too — only a `[!CARD]` callout is read as a card.

## Decks

Resolution chain — first match wins:

1. **Frontmatter** `cards-deck: My Knowledge::Demo`
2. **Folder path** (when `folderBasedDecks: true`) — `Notes/Bio/cells.md`
   becomes deck `Notes::Bio`.
3. **Plugin setting** `defaultDeck` (default: `Default`).

`::` is Anki's subdeck separator. Decks are auto-created on first sync.

## Tags

Per-note tags from the note's frontmatter `tags:` list are merged with the
plugin's `defaultTags` setting. Both YAML inline (`tags: [a, b]`) and
comma-separated string forms are supported. Hyphens, underscores, and
slashes are preserved (Anki nested-tag notation).

## Wikilinks

A wikilink to an existing note becomes a clickable Obsidian link in Anki.
Aliases, headings, and block references are supported. If the target note does
not exist, the `[[wikilink]]` stays visible and is not clickable. Create the
target in Obsidian and sync again.

## How sync works

Two phases per note.

**Phase A — local, no network.**

1. Parse cards from markdown.
2. Insert `^q-xxxx` anchors on cards that don't have one.
3. Write a `flashcards:` frontmatter map with `{ hash: <content-hash> }`
   per card.

The anchor + frontmatter entry are the persistent identity for each card.
The note is saved only if Phase A produced changes.

**Phase B — Anki.**

1. Diff parsed cards against the frontmatter map:
   - card present, no entry → **create**
   - entry present, hash mismatch → **update**
   - entry present, card removed from note → **delete**
2. Bootstrap: create missing note types and decks; extend v1 note types
   in place. Adding `Source` preserves existing template HTML and CSS.
3. Send create/update/delete to AnkiConnect, sequentially.
4. On success, write the new nid + hash back to the frontmatter entry.

Per-op failures don't abort the sync. Failed ops leave their frontmatter
entries untouched so the next run can retry.

## Apply the v2 design to existing cards

Cards created before the v2 design can keep their current appearance. Normal
sync does not replace their templates or CSS.

To opt in, run **Flashcards: Apply v2 Anki card style**. The confirmation lists
the compatible models that will change. The plugin saves their current fields,
templates, and CSS under
`.obsidian/plugins/flashcards-obsidian/backups/` before it writes to Anki. A
failed backup means Anki is not changed.

The command updates shared Anki models in place. It does not recreate notes, so
existing note IDs, schedules, and review history remain.

## Status bar

Two persistent indicators at the bottom of the Obsidian window.

- **`Note: …`** — state of the active markdown note. One of:
  - `Note: no cards`
  - `Note: in sync`
  - `Note: 2 new, 1 modified, 3 pending migration` (any combination)
- **`⚠ Vault: N pending migration`** — appears only while there are
  unmigrated v1 anchors across the vault *and* you haven't decided how to
  handle them yet. Disappears after the migration modal is dismissed.

During a vault sync, a third item shows progress (`3/27 — cells.md`) and
clears when the run finishes.

## Migrating from v1

v1 stored card identity as `^<13-digit>` anchors with no frontmatter
map. v2 also needs a content hash per card so it can detect local edits.
On the first sync against a vault that still has v1 anchors:

> **Migrate flashcards from a previous version?**

- **Migrate and continue** — adds a `<13-digit>: { hash: … }` entry per
  v1-anchored card across the whole vault, then runs the sync you asked
  for. Local change only; reversible by deleting the entries.
- **Sync without migrating** — syncs now and stops prompting. v1 cards
  still reach Anki, but local edits to them won't be detected as updates
  until you migrate.
- **Cancel** — aborts; you'll be asked again next time.

The prompt is per-vault. To re-trigger it, delete `data.json` from the
plugin folder (resets all plugin state).

## Settings

| Key | Default | Purpose |
| --- | --- | --- |
| `defaultDeck` | `Default` | Fallback deck if neither frontmatter nor folder picks one. |
| `folderBasedDecks` | `true` | Map folder path to deck (`/` → `::`). |
| `defaultTags` | `["obsidian"]` | Tags merged into every card. |
| `contextStrategy` | `headings` | Context shown above the active question. Use `headings`, `none`, or `note-title`. |
| `contextSeparator` | ` > ` | Text between context parts. Use `\n` for a new line. |
| `inlineSeparator` | `::` | Basic inline card delimiter. |
| `inlineReverseSeparator` | `:::` | Reversed inline card delimiter. |
| `explicitSyntax` | `fenced` | Fenced-block code label. |
| `hashtag.enabled` | `true` | Recognise hashtag (`#card`) syntax. |
| `hashtag.basicTag` | `card` | The hashtag used for basic cards (also matches `<basic>-reverse` and `<basic>/reverse`). |
| `ankiLaunch.enabled` | `true` | Start Anki when AnkiConnect does not answer, then resume the update. |
| `ankiLaunch.command` | `""` | Launch command. Empty means "detect a standard install". |
| `ankiLaunch.waitSeconds` | `60` | How long an update waits for AnkiConnect (5–300). |
| `logLevel` | `info` | `debug` \| `info` \| `warn` \| `error`. |
| `logToFile` | `true` | Append sync events to `sync.log` in the plugin folder. |

## Logging

- **Console** — open Obsidian's devtools (`Cmd/Ctrl+Shift+I`), filter for
  `[Flashcards]`.
- **File** — `<vault>/.obsidian/plugins/flashcards-obsidian/sync.log`.
  Capped at 1 MB; oldest half is truncated past that. Failures never
  crash the plugin — even a broken adapter just drops the line.

## Troubleshooting

**Sync fails — AnkiConnect not reachable.**
Flashcards starts Anki for you and waits up to `ankiLaunch.waitSeconds`. If it
still times out, use **Settings → Anki connection → Test** to see whether the
launch command or AnkiConnect is at fault, then follow the
[connection checks](../README.md#ankiconnect-connection-problems).

**Anki starts but the update still times out.**
Anki does not answer while a profile password prompt or its AnkiWeb sync dialog
is open. Dismiss it and run the command again, or raise `ankiLaunch.waitSeconds`.

**Anki is installed somewhere unusual (AppImage, flatpak, custom prefix).**
Set **Anki launch command** in settings and confirm it with **Test**.

**"Note was not found: 12345…" warnings.**
The `flashcards:` map has an entry whose `nid` no longer exists in Anki
(you deleted the card directly, or the fixture has bogus IDs). Delete
that entry from the frontmatter — the next sync will create a fresh card.

**The `flashcards` property shows `?` in Obsidian's Properties panel.**
Obsidian has no UI type for object-valued properties — the `?` is
cosmetic; the data is parsed correctly. **Don't change its type or edit
the value via the Properties panel** — Obsidian will rewrite the YAML
into a shape the plugin can't parse. Edit the frontmatter directly if you
need to fix something.

**Status bar says "in sync" but I just edited a card.**
v1-anchored cards (`^<13-digit>`) are invisible to modification detection
until you migrate — the status will say `N pending migration` instead.
If a v2-anchored card (`^q-xxxx`) doesn't flip to "modified" within
~400ms, your edit is probably inside an excluded block (code fence,
blockquote, HTML comment).

**I get "Sync already in progress" but nothing is running.**
A previous sync threw an unhandled error and didn't release the lock.
Reload Obsidian (`Cmd/Ctrl+R`).

## Customisation

The Anki note types created by v2 have minimal CSS. To customise: in Anki,
Tools → Manage Note Types → select `Obsidian-basic` → Cards → Styling.
v2 won't overwrite your CSS on future syncs.

If you migrated from v1, your existing CSS is preserved verbatim. v1's
richer CSS (tag pills, cloze colour) carries forward unchanged.
