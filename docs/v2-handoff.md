# V2 session handoff

Last updated: 2026-09-04

Read this file first when starting the next development session. The detailed
decision record is in [`v2-readiness.md`](v2-readiness.md). User-facing rules
are in [`wiki.md`](wiki.md).

## Current state

- Branch: `rewrite-v2`
- Current committed HEAD before this handoff: `c86e432`
- Remote state: nothing from this session was pushed
- V2 is still unpublished; every linked GitHub issue describes v1
- Supported Obsidian version: 1.13.0 or newer
- Automated gate: lint, Markdown lint, architecture check, typecheck, build,
  and 826 tests across 74 test files pass
- The latest production build is installed in
  `test-vault/.obsidian/plugins/flashcards-obsidian/`
- Automated implementation is substantially complete. The remaining release
  work is one product decision and live Obsidian/Anki verification.

Readiness summary:

- 16 release-gate items are verified by automated tests.
- V2-13, V2-15, and V2-16 are implemented and need live checks.
- V2-11 is the final manual smoke matrix.
- V2-14 needs a product decision before implementation.
- V2-17 repository hygiene is fixed and verified.

## Product rules already decided

Do not reopen these decisions without new evidence:

- Obsidian is the only authoring source for cards linked to Obsidian.
- Anki owns review history and scheduling. Independent Anki notes are ignored.
- Obsidian owns linked-note content, card type, deck, and authored tags. Sync
  repairs Anki-only edits. The Anki review tags `leech` and `marked` survive.
- V2 has one strict parser. Unsupported v1 syntax gets a read-only migration
  report; the runtime does not keep a legacy parsing path.
- Basic and reversed cards can change model in place. Crossing the cloze
  boundary requires confirmation and recreates the note.
- Normal sync preserves existing Anki templates and CSS. The explicit
  **Apply v2 Anki card style** command previews changes and writes an exact JSON
  backup before modifying compatible models.
- The vault scan index is disposable. Losing it may make one sync slower but
  must never change card identity or sync results.

## Work completed in the last session

The final work was split into four local commits:

- `6023fc8` — strict card grammar, Markdown boundaries, migration reporting,
  accepted settings, and related tests
- `7991671` — Obsidian-owned Anki field/deck/tag reconciliation, stale-ID
  recovery support, Source action and path, managed card styling, safe style
  backup/migration, and tests
- `b3440e1` — command integration and incremental vault scanning
- `c86e432` — readiness/wiki/usage documentation, the HTML card design lab,
  and manual test-vault examples

The relevant user-visible commands are:

- **Flashcards: Sync current note**
- **Flashcards: Sync vault**
- **Flashcards: Check vault for v2 syntax migration**
- **Flashcards: Apply v2 Anki card style**

## Start here next session

Follow this order.

### Completed: test-vault repository hygiene (V2-17)

On 2026-09-04, the manual-sync artifacts introduced in `c86e432` were removed
from tracked fixtures. The authored scenarios 07 and 08 and the `note.md` and
`capital.md` wikilink targets were preserved. Deliberate fake identities in
migration and already-synced scenarios were restored to their baseline values.

The pre-commit guard now rejects newly added:

- standalone or inline `^q-xxxx` anchors;
- standalone or inline 13-digit legacy anchors;
- v2 or legacy registry entries containing generated identity/sync fields;
- hash-only registry entries written before an Anki note is created.

Regression coverage is in
`tests/repository/check-test-vault-ids.test.ts`. V2-17 is complete.

### 1. Run the three focused live checks

Use the already installed build in `test-vault` and reload Obsidian first. Do
not run a full vault sync against yesterday's test profile without deciding
what to do with its notes: the cleaned fixture sources no longer contain their
live IDs, so a fresh create-path test would create new notes.

If you want to verify migration against yesterday's existing cards, run the
V2-13 and V2-15 checks first. Then wipe or switch to a clean disposable Anki
test profile before testing fresh creation and the full vault sync.

V2-13 — Source repair:

1. Sync an existing managed card created before the Source template repair.
2. Confirm the answer shows **Edit source in Obsidian** and its relative path.
3. Click it and confirm Obsidian opens the exact note block.
4. Confirm customized template HTML was otherwise preserved.

V2-15 — style migration:

1. Record one existing note ID and visible scheduling/review state in Anki.
2. Run **Flashcards: Apply v2 Anki card style**.
3. Confirm the preview names changed and skipped models.
4. Confirm a JSON backup appears in the plugin `backups` directory before the
   model changes.
5. Check basic, reversed, cloze, long code, dark mode, and narrow/mobile width.
6. Confirm the recorded note ID and review state did not change.

V2-16 — incremental scan:

1. Run **Flashcards: Sync vault** once to build or refresh the scan index.
2. Run it again without edits and confirm the notice reports unchanged
   card-free notes as skipped.
3. Edit a card-free note and confirm the next sync reads it again.
4. Edit a linked card only in Anki and confirm an unchanged Obsidian card note
   is still reconciled. Card-bearing notes must never be skipped.

Record the result and date in `v2-readiness.md`. If a check fails, change the
item to **Reproduced**, add a focused failing test where possible, and fix the
root cause before continuing.

### 2. Decide where internal card metadata belongs (DECISION, V2-14)

The current `flashcards` frontmatter map is correct but appears as an opaque,
ugly value in Obsidian Properties. The recommended design is to move the same
note-local registry into one HTML comment immediately after frontmatter. This
keeps notes self-contained, hides machine state from Properties and Reading
view, and avoids a sidecar database.

Before implementation, confirm this choice and define migration behavior for
existing YAML registries. The alternatives and trade-offs are recorded under
V2-14 in [`v2-readiness.md`](v2-readiness.md).

### 3. Run the final release smoke matrix (MANUAL, V2-11)

In a clean vault and a migrated v1 vault, verify:

- create, update, and confirmed delete;
- basic, reversed, cloze, fenced, hashtag, callout, list, and atomic cards;
- images, audio, code, math, and all four wikilink forms;
- deck and tag changes, including preserved `leech`/`marked` tags;
- basic/reversed conversion and confirmed cloze-boundary recreation;
- stale Anki note-ID recovery;
- plugin restart, Anki unavailable, and retry after a per-operation failure;
- visible settings, note card count, progress status, and migration report.

Update V2-11 to **Verified** only after both vault paths pass.

### 4. Prepare the release pass

- Confirm the non-blocking feature decisions remain deferred for v2: block
  embeds (#74), arbitrary model profiles and Context fields (#75, #146, #186,
  #193), implicit heading generation/multiblock cloze (#215), and mobile
  transport (#108).
- Run `npm run check` from a clean working tree.
- Re-run the original v1 examples for every issue listed for closure.
- Only after v2 is published, add closing comments that explain the report was
  against v1 and name the first fixed v2 release.
- Do not push, publish, or close GitHub issues without an explicit request.

## Useful paths and commands

- Main tracker: `docs/v2-readiness.md`
- Durable feature decisions: `docs/v2-feature-plan.md`
- User-facing behavior: `docs/wiki.md`
- Manual harness: `test-vault/README.md`
- Card design lab: `docs/card-types.html`
- Full gate: `npm run check`
- Current changes: `git status --short`
- Recent work: `git log --oneline -10`

When completing any tracked item, update the tracker, evidence, and linked
issue assessment in the same change. Keep GitHub issues open until the verified
public v2 release.
