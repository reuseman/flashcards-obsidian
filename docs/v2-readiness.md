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
- Automated suite: 66 test files, 738 tests passing
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
| V2-03b | Define and sync tag ownership | New v2 finding; related #99 | Source tag removal is defined without deleting tags added manually in Anki | DECISION | Candidate |
| V2-04 | Recover from stale Anki note IDs | Carries into v2: #177; support report #221 | Sync detects a missing nid, recreates the source card, stores its new nid, and reports the recovery | AUTO-THEN-DECIDE | Verified |
| V2-05 | Read Obsidian block-style YAML tags | Carries into v2: #117, #202, #206 | Inline and block YAML tag lists produce the same Anki tags and preserve unrelated frontmatter | AUTO | Verified |
| V2-06 | Preserve Markdown in inline and cloze cards | Carries into v2 goal: #216; adjacent finding from #211 | Bold, emphasis, links, images, and inline code reach Anki without losing text or creating false cards | AUTO | Verified |
| V2-07 | Make cloze parsing safe for math and nested braces | Carries into v2: #102, #120, #156, #203; related #82 | LaTeX braces and `*` stay literal; valid cloze syntax renders valid Anki clozes; unnumbered-curly behavior is decided | DECISION | Candidate |
| V2-08 | Prevent duplicate extraction from overlapping syntaxes | Carries into v2: #218 | A documented precedence rule prevents accidental duplicates when a hashtag answer contains inline or cloze syntax | DECISION | Candidate |
| V2-09 | Define structured content inside hashtag answers | Carries into v2: #37, #106, #207 | Fenced code and blockquotes are either included correctly or rejected with a clear warning and documented alternative | DECISION | Candidate |
| V2-10 | Cover the Obsidian adapter boundary | New v2 test gap | Commands, settings persistence, repository writes, notices, status bars, and sync locking have automated adapter tests | AUTO | Verified |
| V2-11 | Run the release smoke matrix | Pre-release verification | A clean vault and migrated v1 vault pass create, update, delete, media, deck, tag, restart, and failure-recovery checks with real Obsidian and Anki | MANUAL | Candidate |
| V2-12 | Modernize release checks | New v2 finding: release workflow used Node 14 and old GitHub actions | Pull requests run lint, architecture, tests, and build on a supported Node version; the release job uses the same checks | AUTO | Verified |

## Recommended execution order

1. Keep V2-00, V2-01, V2-05, V2-06, V2-10, and V2-12 green in CI.
2. Keep V2-02, V2-03a, and V2-04 green. Decide V2-03b tag ownership
   separately.
3. Resolve the grammar decisions in V2-07, V2-08, and V2-09, then implement one
   parser rule at a time with regression tests.
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

Still undecided. A source tag can be removed while a tag can also be added
manually in Anki. Without ownership data, sync cannot distinguish those cases.

Until this is decided, ordinary updates do not change existing Anki tags.
Model conversion and cloze recreation preserve the live Anki tags exactly.

### V2-04: missing Anki note IDs

The live API returns an empty object for a missing ID from `notesInfo`, and an
empty result from `findNotes`. This gives v2 a reliable preflight check.

Chosen policy: if the source card still exists and `notesInfo` confirms that
its stored ID is missing, recreate it automatically, replace the stored ID,
and show the recovery count in the sync notice. The old scheduling is already
unavailable because the Anki note no longer exists.

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

| Work item | Issues to close after a verified v2 release | Other follow-up | Current state |
| --- | --- | --- | --- |
| V2-01 | #50, #51, #210 | Mention `\n` separator support | Waiting for v2 release |
| V2-02 | #57 | Record the chosen scheduling policy in the closing comment | Waiting for v2 release |
| V2-03a | None yet | #27 and #99 remain reference only | Waiting for v2 release |
| V2-03b | None yet | #99 is reference only until tag ownership is decided | Waiting for decision |
| V2-04 | #177 | #221 needs a reporter check | Waiting for v2 release |
| V2-05 | #117, #202, #206 | Include inline and block YAML examples in the closing comment | Waiting for v2 release |
| V2-06 | #216 | #211 is reference only | Waiting for v2 release |
| V2-07 | #102, #156, #203 | #120 is a duplicate report; #82 is reference only | Waiting for decision |
| V2-08 | #218 | State the syntax precedence rule in the closing comment | Waiting for decision |
| V2-09 | #37, #106, #207 | State the supported content boundary in the closing comment | Waiting for decision |

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
| V2-04 | Stale-nid unit and full `syncNote` writeback tests in `tests/application/reconcile-existing-cards.test.ts` |
| V2-05 | `tests/core/parse/note-metadata.test.ts`; `tests/core/parse/tag-merge.test.ts` |
| V2-06 | Markdown-preservation cases in `tests/core/parse/extract-cards.test.ts`; feature-render snapshots |
| V2-10 | Adapter tests for commands, settings, Markdown repository, and status bars |
| V2-12 | `.github/workflows/checks.yml`; release workflow runs the same `npm run check` gate on Node 24 |

The manual examples for V2-01, V2-02, V2-03a, V2-04, V2-05, and V2-06 live in
`test-vault/scenarios/auto-fixes/`. Their expected extraction is checked by
`tests/core/parse/auto-fix-examples.test.ts`.

## Feature queue

These are not release blockers unless v2 documentation promises them. Accept or
defer each group before turning it into implementation tasks.

| ID | Feature area | V1 requests | Suggested disposition | Mode |
| --- | --- | --- | --- | --- |
| V2-F01 | Settings UI and connection options | #82, #85, #103, #181, #192, #229 | Expose existing syntax toggles first; API-key client support already exists | AUTO for wiring; DECISION for trigger policy |
| V2-F02 | Larger and structured card regions | #16, #74, #88, #107, #162, #167, #173, #215, #217 | Defer until one content-boundary model is designed | DECISION |
| V2-F03 | Custom Anki fields, templates, and rendering | #75, #96, #112, #146, #163, #186, #193, #209 | Defer as a separate customization milestone | DECISION |
| V2-F04 | Organization metadata | #116, #131, #134 | Decide after correct deck and tag mutation sync exists | DECISION |
| V2-F05 | Platform and external integrations | #108, #113, #229 | API key is a small desktop feature; mobile and Advanced URI are separate scopes | DECISION |

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
