# Flashcards — usage

End-user manual for v2. For development notes, see `CONTRIBUTING.md`.

## Requirements

- Obsidian ≥ 1.8.7.
- Anki with the **AnkiConnect** add-on installed and running. Default
  endpoint: `http://127.0.0.1:8765`.
- Community plugins enabled for the vault (Settings → Community plugins →
  *Turn on community plugins*; trust the author on first open).

The first sync auto-creates Anki note types (`Obsidian-basic`,
`Obsidian-basic-reversed`, `Obsidian-cloze`) and any decks it needs.

## Commands

From the command palette (`Cmd/Ctrl+P`):

- **Flashcards: Sync current note** — runs the pipeline on the active note.
- **Flashcards: Sync vault** — iterates every markdown note sequentially.

Both are idempotent: re-running on unchanged notes makes no network calls
and no file writes.

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
produces a reversed card (default is basic). Each field is read from a
single line.

### Legacy hashtag (v1 compatibility)

```text
# What is recursion? #card
A function that calls itself, with a base case to terminate.
```

Recognised at headings (h1–h6) and paragraphs. `#card` is basic,
`#card-reverse` or `#card/reverse` is reversed. The hashtag can sit inline
(end of the question line) or on its own line below.

Configurable via `legacy.hashtagBasic` (default `card`). Set
`legacy.enabled: false` to disable v1 recognition entirely.

### What is *not* parsed

Cards inside code fences, blockquotes, and HTML comments are skipped.
Cards inside callouts are skipped (treated as blockquotes).

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
   in place (adds `Source` field, rewrites templates).
3. Send create/update/delete to AnkiConnect, sequentially.
4. On success, write the new nid + hash back to the frontmatter entry.

Per-op failures don't abort the sync. Failed ops leave their frontmatter
entries untouched so the next run can retry.

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
| `contextStrategy` | `headings` | Heading-context to prepend to card fronts. `headings` \| `none` \| `note-title`. |
| `contextSeparator` | ` > ` | Joiner between heading levels in context. |
| `inlineSeparator` | `::` | Basic inline card delimiter. |
| `inlineReverseSeparator` | `:::` | Reversed inline card delimiter. |
| `explicitSyntax` | `fenced` | Fenced-block code label. |
| `legacy.enabled` | `true` | Recognise v1 hashtag syntax. |
| `legacy.hashtagBasic` | `card` | The hashtag used for v1 basic cards (also matches `<basic>-reverse` and `<basic>/reverse`). |
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
Start Anki. Confirm the AnkiConnect add-on is installed and the listen
port is 8765.

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
