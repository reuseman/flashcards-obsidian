# V2 release readiness

Last reviewed: 2026-09-03

This is the working plan for the unpublished v2 rewrite. It is not a public
changelog and it does not change the status of existing GitHub issues.

## Important interpretation rule

All 98 currently open GitHub issues were reported against v1. Nobody has
reported a production v2 bug because v2 has not been published.

An issue can have one of these v2 assessments:

- **Carries into v2** - the v1 scenario is still broken in the current v2 code.
- **Resolved by v2** - v2 code or tests cover the v1 scenario.
- **Missing from v2** - the requested feature is not present in v2.
- **Needs reproduction** - code inspection is not enough to decide.
- **New v2 finding** - found during this audit, not reported by a v2 user.

## Tracker rules

Task status follows this sequence:

`candidate -> reproduced -> failing test -> implemented -> verified`

Execution mode:

- **AUTO** - Codex can implement and verify this without a product decision.
- **AUTO-THEN-DECIDE** - Codex can reproduce and test it, then must stop for a
  behavior decision.
- **DECISION** - expected behavior must be chosen before implementation.
- **MANUAL** - requires a running Obsidian and Anki environment.

No task is complete only because the code compiles. Each task must have an
automated behavior test or a repeatable manual check.

## Current baseline

- Branch: `rewrite-v2`
- Minimum supported Obsidian version: 1.13.0
- Automated suite: 73 test files, 817 tests passing
- Last measured line coverage before this work: 77.14 percent
- Full local gate: lint, Markdown lint, architecture check, tests, typecheck,
  and production build passing
- Core parsing and sync code has strong coverage.
- Plugin startup and full Obsidian/Anki smoke coverage still require the manual
  release check.

## Release gate

These items must be fixed, explicitly accepted as a limitation, or moved out of
the advertised v2 behavior before release.

| ID | Work item | Origin | Done when | Mode | Status |
| --- | --- | --- | --- | --- | --- |
| V2-00 | Use the Obsidian 1.13 settings API | New Obsidian platform requirement | The manifest requires 1.13.0; settings use declarative definitions; defaults and persistence have adapter tests | AUTO | Verified |
| V2-01 | Apply heading or note-title context | Carries into v2: #50, #51; related #210 | All card syntaxes follow `contextStrategy` and `contextSeparator`; adjacent and skipped heading levels have tests | AUTO | Verified |
| V2-02 | Change an existing card between basic, reversed, and cloze | Carries into v2: #57 | Basic/reversed converts in place; crossing the cloze boundary asks before safely recreating | AUTO-THEN-DECIDE | Verified |
| V2-03a | Sync deck changes | New v2 finding; related #27, #99 | Editing `cards-deck`, folder deck, or the default deck moves every card for the note without duplicating it | AUTO-THEN-DECIDE | Verified |
| V2-03b | Define and sync tag ownership | New v2 finding; related #99 | Authored tags mirror Obsidian; Anki's `leech` and `marked` review tags survive reconciliation | AUTO | Verified |
| V2-03c | Repair Anki-only field edits | Accepted one-way authoring policy | Every sync restores linked note fields from Obsidian even when the source hash is unchanged, without changing review data | AUTO | Verified |
| V2-04 | Recover from stale Anki note IDs | Carries into v2: #177; support report #221 | Sync detects a missing nid, recreates the source card, stores its new nid, and reports the recovery | AUTO-THEN-DECIDE | Verified |
| V2-05 | Read Obsidian block-style YAML tags | Carries into v2: #117, #202, #206 | Inline and block YAML tag lists produce the same Anki tags and preserve unrelated frontmatter | AUTO | Verified |
| V2-06 | Preserve Markdown in inline and cloze cards | Carries into v2 goal: #216; adjacent finding from #211 | Bold, emphasis, links, images, and inline code reach Anki without losing text or creating false cards | AUTO | Verified |
| V2-07 | Make cloze parsing safe for math and nested braces | Carries into v2: #102, #120, #156, #203; related #82 | Markdown math and code are protected; one balanced tokenizer detects and renders the strict v2 cloze grammar | AUTO | Verified |
| V2-07b | Report syntax that needs manual migration | Breaking v2 grammar policy | A read-only check reports the file, line, reason, and supported replacement without maintaining a second parser | AUTO | Verified |
| V2-08 | Prevent duplicate extraction from overlapping syntaxes | Carries into v2: #218 | An explicit container owns its source range, with regression tests for every overlapping syntax pair | AUTO | Verified |
| V2-09 | Define structured content inside hashtag answers | Carries into v2: #37, #106, #167, #207 | Heading cards own their section; paragraph cards use their remainder or the next Markdown node; structured-node tests pass | AUTO | Verified |
| V2-10 | Cover the Obsidian adapter boundary | New v2 test gap | Commands, settings persistence, repository writes, notices, status bars, and sync locking have automated adapter tests | AUTO | Verified |
| V2-11 | Run the release smoke matrix | Pre-release verification | A clean vault and migrated v1 vault pass create, update, delete, media, wikilinks, deck, tag, restart, and failure-recovery checks with real Obsidian and Anki | MANUAL | Candidate |
| V2-12 | Modernize release checks | New v2 finding: release workflow used Node 14 and old GitHub actions | Pull requests run lint, architecture, tests, and build on a supported Node version; the release job uses the same checks | AUTO | Verified |
| V2-13 | Repair Source links in existing managed Anki templates | New v2 finding from live smoke; related #113 | Sync detects a managed model whose Back template omits `{{Source}}`, preserves its customized HTML, and appends the missing field | AUTO + MANUAL | Implemented; live display check pending |
| V2-14 | Keep internal sync metadata out of the Properties UI | New v2 UX finding from live smoke | User-authored settings remain readable properties; machine-owned card identity and sync data stay note-local without filling the native Properties editor | DECISION | Candidate |
| V2-15 | Apply the v2 design to existing managed Anki models safely | New v2 migration need | A command previews compatible models, backs up exact fields/templates/CSS before writing, and updates models without recreating notes | AUTO + MANUAL | Implemented; manual Anki check pending |
| V2-16 | Avoid rescanning unchanged card-free notes | New v2 performance finding | After one full classification pass, vault sync skips content reads and parsing only for unchanged notes proven to contain no cards; changes, settings, errors, or cache loss fall back safely | AUTO + MANUAL | Implemented; manual timing pending |

## Recommended execution order

1. Keep V2-00, V2-01, V2-05, V2-06, V2-10, V2-12, V2-13, V2-15, and V2-16 green in CI.
2. Keep V2-02, V2-03a, V2-03b, V2-03c, and V2-04 green.
3. Keep V2-07, V2-08, and V2-09 green. Add the focused V2-07b migration check
   without adding a second runtime parser.
4. Run V2-11 after every release-gate item is verified.

## Behavior decisions and implementation

### V2-02: card type changes

A disposable live-Anki probe confirmed that `updateNoteModel` preserves the
note ID and the first card ID for basic to reversed. Reversed to cloze also
kept the second reversed card, but it became an invalid “No cloze 2 found”
card. The probe was deleted and a tag search confirmed that nothing remained.

Chosen policy:

- Use `updateNoteModel` for basic to reversed and reversed to basic. Preserve
  the shared card's scheduling; adding or removing the reverse sibling is an
  expected result of changing type.
- Require confirmation before crossing the cloze boundary. Recreating the
  note is the only clean option exposed by this AnkiConnect instance. The
  replacement is created before the old note is removed, and a failed create
  leaves the old note untouched. Recreation loses the old review history.

### V2-03a: deck changes

Chosen policy: Obsidian owns the deck. Every sync reads the live card decks.
When one differs from the resolved source deck, all cards belonging to that
Anki note move together. A deck-only change does not rewrite note fields.

### V2-03b: tag ownership

Chosen policy:

- Obsidian owns authored tags for cards linked to Obsidian. The desired set is
  the plugin default tags plus the note's frontmatter tags.
- Sync removes an authored tag that exists only in Anki. Users should add a tag
  to the Obsidian note when it must persist.
- Preserve Anki's built-in `leech` and `marked` tags because they can represent
  review actions. Do not promise to preserve tags created by other add-ons.
- Do not store previous tag sets or implement a three-way tag merge.
- Ignore independent Anki notes that have no Obsidian identity link.

The reconciliation step applies this rule to normal updates, model conversion,
and confirmed cloze recreation.

### V2-03c: Anki-only field edits

Chosen policy: Obsidian owns the rendered fields of every linked Anki note.
Every sync compares the live Anki fields with the current rendered Obsidian
card, even when the stored source hash is unchanged. Drift creates an in-place
field update. It does not recreate the note or change scheduling. Independent
Anki notes without an Obsidian identity link remain untouched.

### V2-04: missing Anki note IDs

The live API returns an empty object for a missing ID from `notesInfo`, and an
empty result from `findNotes`. This gives v2 a reliable preflight check.

Chosen policy: if the source card still exists and `notesInfo` confirms that
its stored ID is missing, recreate it automatically, replace the stored ID,
and show the recovery count in the sync notice. The old scheduling is already
unavailable because the Anki note no longer exists.

### V2-07: cloze and math grammar

Chosen policy:

- Keep Markdown parsing in unified/mdast and add Markdown math nodes.
- Use one small balanced cloze tokenizer for detection and rendering. Do not
  maintain separate regular-expression grammars.
- Support `==text==`, `{N:text}`, and native `{{cN::text}}` syntax. Plain
  `{text}` is ordinary text.
- Treat code and math as protected syntax. A cloze may contain a complete math
  node when its delimiters are outside the math delimiters.
- Leave malformed syntax visible and report its source location.
- Provide a migration detector, not a permanent legacy parser.

### V2-08: overlapping syntax

Chosen policy: a successfully parsed explicit card container owns its complete
source range. Atomic and fenced regions take precedence over hashtag regions;
hashtag regions take precedence over inline reversed, inline basic, and cloze
syntax. Markers inside an owned region are content, not additional cards.
Disabled syntax does not claim a range. A present `test:` key suppresses
implicit inline and cloze extraction for the note, including when its value is
invalid; this prevents a typo from turning prose into accidental cards.

### V2-09: hashtag answer boundaries

Chosen policy:

- A tagged heading owns its section until the next heading of the same or a
  higher level, or the next explicit card.
- A tagged paragraph uses content after its marker in the same Markdown node.
  If there is no content after the marker, it uses the next top-level node.
- One node may be a paragraph, list, blockquote, or code block.
- Use a tagged heading for a multi-block section and a fenced card for an exact
  explicit container. Do not add a special continuation marker.
- Markers inside code, math, quotes, or HTML comments are content.

### V2-14: internal sync metadata presentation

The `flashcards` map is plugin-owned state, not a property that users should
normally edit. Nested YAML is shown as an opaque value by Obsidian's native
Properties UI, and the public plugin API does not expose a custom editor for
one native property row.

Options to decide:

1. Move the existing registry unchanged into one HTML comment immediately
   after frontmatter. This keeps the note self-contained, hides the registry
   from Properties and Reading view, and preserves deleted-card detection.
2. Keep YAML but use a compact scalar or list representation. This is the
   smallest migration, but machine state remains visible and removing the
   hash fields requires a reconciliation redesign.
3. Store only one stable note identity in YAML and put the per-card mapping in
   hidden Anki fields. This makes Properties cleaner but requires a new lookup,
   deletion, rename, migration, and recovery protocol.
4. Use a plugin sidecar database. This produces the cleanest notes but creates
   sync, backup, rename, multi-device, and state-loss problems.

Recommended direction: option 1, plus a read-only plugin command or view for a
human-readable card status. Keep author-owned properties such as `cards-deck`
and `tags` in frontmatter. Do not depend on private Properties DOM hooks or CSS
selectors for correctness.

### V2-15: existing Anki model style

Chosen policy:

- Normal sync preserves existing template HTML and CSS.
- **Flashcards: Apply v2 Anki card style** is the only action that replaces
  them with the managed v2 design.
- The confirmation lists every model that will change and any incompatible
  model that will be skipped.
- The command saves exact current fields, templates, and CSS to a timestamped
  JSON file in the plugin's `backups` directory before the first Anki write.
- A missing `Source` field can be added when the normal content fields and card
  template count are compatible. Other incompatible shapes are not guessed.
- Models are updated in place. Existing Anki note IDs, schedules, and review
  history remain.

### V2-16: incremental vault scan

Chosen policy:

- The first vault sync reads every Markdown note and builds a disposable scan
  index in the plugin directory.
- A later vault sync skips reading and parsing only when the file timestamp and
  size are unchanged and the previous parse proved that the note had no cards
  or parser warnings.
- Card-bearing, failed, and uncertain notes always run through normal parsing
  and live Anki reconciliation. This preserves stale-ID recovery and the rule
  that Obsidian repairs Anki-only edits.
- A settings or plugin-version change invalidates the index. A changed, new, or
  renamed note is read again.
- A missing, corrupt, or unwritable index affects performance only. The sync
  falls back to safe work and never treats the index as card identity.
- The sync notice reports how many unchanged card-free notes were skipped.

This is intentionally narrower than skipping every unchanged card note. A
future optimization may batch live Anki verification before parsing those
notes, but it must prove the same one-way ownership behavior first.

## GitHub issue follow-up

The issue number links this private v2 work to its original v1 report. It does
not mean that the issue was reported against v2.

Use these follow-up states:

- **Waiting for fix** - a v2 task still reproduces the problem.
- **Waiting for decision** - the requested behavior is not defined yet.
- **Waiting for v2 release** - the fix is verified locally, but users cannot
  install it yet.
- **Needs reporter check** - the result depends on the reporter's environment.
- **Reference only** - related context; completing the task does not prove the
  whole issue is solved.

The table currently contains 33 unique issue numbers in its
**Issues to close after a verified v2 release** column. GitHub still shows them
as open because v2 is not public.

| Work item | Issues to close after a verified v2 release | Other follow-up | Current state |
| --- | --- | --- | --- |
| V2-01 | #50, #51, #210 | Mention `\n` separator support | Waiting for v2 release |
| V2-02 | #57 | Record the chosen scheduling policy in the closing comment | Waiting for v2 release |
| V2-03a | None yet | #27 and #99 remain reference only | Waiting for v2 release |
| V2-03b | None yet | #99 remains reference only | Waiting for v2 release |
| V2-03c | None yet | One-way authoring rule is documented in the v2 wiki | Waiting for v2 release |
| V2-04 | #177 | #221 needs a reporter check | Waiting for v2 release |
| V2-05 | #117, #202, #206 | Include inline and block YAML examples in the closing comment | Waiting for v2 release |
| V2-06 | #216 | #211 is reference only | Waiting for v2 release |
| V2-07 | #102, #156, #203 | #120 is a duplicate report; #82 is reference only | Waiting for v2 release |
| V2-07b | None yet | Release migration support | Waiting for v2 release |
| V2-08 | #218 | State the syntax precedence rule in the closing comment | Waiting for v2 release |
| V2-09 | #37, #106, #167, #207 | State the supported content boundary in the closing comment | Waiting for v2 release |
| V2-13 | #113 | Confirm the link opens the exact source block in the manual smoke | Needs reporter check |
| V2-F01 | #82, #85, #103, #181, #229 | #192 remains deferred | Waiting for v2 release |
| V2-F02 | #16, #107, #162, #173, #217 | #74 needs design; #88 is declined; #215 is partial | Waiting for v2 release |
| V2-F03 | #96, #112 | #75, #146, #186, and #193 need model-profile design | Waiting for v2 release |
| V2-F04 | #116, #131, #134 | Verify the visible settings and status in the manual smoke | Waiting for v2 release |

Before closing an issue:

1. Re-run the original v1 example against the release build.
2. Link the regression test or repeatable manual check.
3. Comment that the report was for v1 and name the first v2 release containing
   the result.
4. Close only when the whole reported case is fixed. Keep partial or
   environment-dependent cases open.

## Verification evidence

| Work item | Automated evidence |
| --- | --- |
| V2-00 | `tests/adapters/obsidian/settings-tab.test.ts`; typecheck and production build |
| V2-01 | `tests/core/parse/context.test.ts`; feature-render snapshots |
| V2-02 | `tests/application/reconcile-existing-cards.test.ts`; `tests/adapters/anki/execute-sync-plan.test.ts`; live disposable-note API probe |
| V2-03a | Deck-only reconciliation and all-card move tests in the same two files |
| V2-03b | Tag reconciliation tests in `tests/application/reconcile-existing-cards.test.ts` and `tests/adapters/anki/execute-sync-plan.test.ts` |
| V2-03c | Live field-drift tests in the same two files; sync fingerprint parser and writeback tests |
| V2-04 | Stale-nid unit and full `syncNote` writeback tests in `tests/application/reconcile-existing-cards.test.ts` |
| V2-05 | `tests/core/parse/note-metadata.test.ts`; `tests/core/parse/tag-merge.test.ts` |
| V2-06 | Markdown-preservation cases in `tests/core/parse/extract-cards.test.ts`; feature-render snapshots |
| V2-07 | `tests/core/parse/cloze-syntax.test.ts`; math-aware extraction and rendering cases |
| V2-07b | `tests/core/parse/detect-syntax-migrations.test.ts`; `tests/application/build-syntax-migration-report.test.ts`; command/modal adapter test |
| V2-08 | Container precedence cases in `tests/core/parse/extract-cards.test.ts` and `tests/core/parse/hashtag-card-answer-model.test.ts` |
| V2-09 | Markdown-node boundary cases in `tests/core/parse/hashtag-card-answer-model.test.ts` |
| V2-10 | Adapter tests for commands, settings, Markdown repository, and status bars |
| V2-11 | Feature-vault snapshot coverage plus an existing-target assertion for all four wikilink forms in `tests/adapters/anki/features.test.ts`; final Obsidian/Anki run remains manual |
| V2-12 | `.github/workflows/checks.yml`; release workflow runs the same `npm run check` gate on Node 24 |
| V2-13 | `tests/adapters/anki/repair-managed-source-templates.test.ts`; Source action, path, escaping, and model CSS tests in `tests/adapters/anki/render-card.test.ts`; sync-command adapter test; live Anki inspection confirmed the Source field existed while all managed Back templates omitted it |
| V2-15 | `tests/adapters/anki/manage-managed-model-style.test.ts`; model styling client tests; `tests/adapters/obsidian/anki-style-backup.test.ts`; confirmation, backup ordering, and failure-safety command tests |
| V2-16 | `tests/adapters/obsidian/incremental-vault-sync.test.ts`; descriptor/cached-read adapter tests; skipped-note accounting in `tests/application/sync-vault.test.ts` |
| V2-F01 | Settings/config/command adapter tests; cloze extraction and rendering toggle tests; AnkiConnect key-envelope test |
| V2-F02 | List ownership and callout cases in `tests/core/parse/extract-cards.test.ts`; callout rendering test |
| V2-F03 | Managed light/dark/responsive CSS and Source markup in renderer tests; fenced cloze cases in renderer/parser tests; interactive states in `docs/card-types.html` |
| V2-F04 | Status-bar count, folder deck prefix, and hierarchical tag tests |

On 2026-09-03, a disposable note in the live Anki test profile confirmed the
AnkiConnect `notesInfo`, `addTags`, and `removeTags` request and response shapes.
The note was deleted after the probe and its unique tag returned no results.

The manual examples for V2-01, V2-02, V2-03a, V2-04, V2-05, and V2-06 live in
`test-vault/scenarios/auto-fixes/`. Their expected extraction is checked by
`tests/core/parse/auto-fix-examples.test.ts`.

## Feature queue

These are not release blockers unless v2 documentation promises them. Accept or
defer each group before turning it into implementation tasks.

The durable per-issue decisions and implementation order are in
[`v2-feature-plan.md`](v2-feature-plan.md). Update both documents whenever a
linked issue changes state.

| ID | Feature area | V1 requests | Suggested disposition | Mode |
| --- | --- | --- | --- | --- |
| V2-F01 | Settings UI and connection options | #82, #85, #103, #181, #192, #229 | Fixed controls and secure API-key wiring are covered; arbitrary delimiters remain deferred | VERIFIED/MIXED |
| V2-F02 | Larger and structured card regions | #16, #74, #88, #107, #162, #167, #173, #215, #217 | Heading, list, and callout ownership are covered; block embeds need design | VERIFIED except #74 |
| V2-F03 | Custom Anki fields, templates, and rendering | #75, #96, #112, #146, #163, #186, #193, #209 | CSS wrapping and cloze Extra are covered; documentation and model-profile design remain | MIXED |
| V2-F04 | Organization metadata | #116, #131, #134 | Live count, optional folder tag, and folder-deck prefix are covered | VERIFIED |
| V2-F05 | Platform and external integrations | #108, #113, #229 | Source link and secure API key are covered; mobile remains deferred | MIXED |

## V1 reports already covered by v2

Keep these as regression references. Do not reopen implementation work unless a
v2 reproduction fails.

- Identity, update, deletion, and frontmatter: #90, #142, #194, #197, #199,
  #208, #213, #223, #225, #226
- Vault sync: #14, #94, #126, #224
- Images and audio: #60, #109, #150, #153, #160, #183
- Parsing and rendering: #41, #53, #98, #115, #118, #127, #157, #161, #172,
  #180, #185, #187, #205, #211, #219, #228
- Source links, filename fronts, and project test setup: #149, #152, #165, #166
- Runtime or supported customization: #95, #99, #122

## Triage-only issues

These do not currently define implementation work:

- Support or environment: #105, #195, #212, #221
- Duplicate or unclear screenshots: #120, #170, #171
- Project or documentation: #125, #132, #151

## Autonomous work boundary

Codex may take an **AUTO** item from candidate through verified using TDD, update
this tracker, run the full checks, and leave the changes uncommitted for review.

For **AUTO-THEN-DECIDE** items, Codex may inspect, reproduce, write a focused
test harness, and present concrete behavior choices. It must not choose a policy
that can lose Anki scheduling, remove user-managed tags, or recreate cards
without approval.

For **DECISION** items, Codex may collect evidence and propose one recommended
behavior. Implementation starts after that behavior is accepted.

Codex does not commit, push, modify GitHub issues, or publish v2 unless asked.

## Update protocol

After each work session:

1. Change the task status in this file.
2. Add the test file or manual check that proves the result.
3. Record any behavior decision next to the task.
4. Move verified non-blockers to the feature queue or resolved section.
5. Keep one work item per root cause, even when several v1 issues reference it.
