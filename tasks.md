# Tasks

Continuation log for agents picking up the v2 rewrite. Most recent first within each section. See `plan.md` for the master plan, `docs/agents/` for role rules, `agent.md` for orientation.

## Workflow

Strict-gate two-agent TDD:

1. Human + main agent agree on the next slice and resolve product ambiguity.
2. TDD agent writes failing tests only. No production code.
3. Main agent verifies the tests fail for the right reason.
4. Implementation agent makes the smallest change to turn them green. No test edits.
5. Main agent verifies and updates this file.

If a slice is "test backfill" (behavior already implemented), the implementation step is skipped and the slice is marked accordingly.

## In progress

_None._

## Backlog (next candidates)

- Property test flake to investigate: `tests/properties/inline-cards.property.test.ts`. Counterexample includes a single backtick (e.g. `` "` " ``); mdast emits an `inlineCode` node and `phrasingToVisibleText` strips it, so the inline-card text disappears. Either narrow the arbitrary or change the visible-text rule. Pre-existing, unrelated to the legacy slice.
- Trailing content after heading inline-tag (`# Question #card moretext`): unspecified. Decide whether `moretext` is part of the front, the answer, or rejected.
- `source.line` is hardcoded to `1` in `extract-legacy-cards.ts` — fix when ID edits start depending on it.

- Spaced cards product design — settle Anki schema (basic with empty back vs. custom note type vs. cloze-of-everything) before writing tests.
- Legacy `#card-reverse` compatibility (mirrors legacy basic slice).
- ID insertion edits (Phase 4) — deterministic ID anchor placement, idempotent on second run.
- Sync plan diff (Phase 5) — pure diff between parsed cards and a fake remote state.
- Note-level metadata: deck via frontmatter `cards-deck`, default tags merge — partially implemented in `parseNoteMetadata`; needs explicit tests.
- Anki adapter (AnkiConnect transport) wiring once sync plan is stable.
- Obsidian adapter wiring (`application/sync-current-note.ts` exists; not yet connected to a command).

## Done

### Legacy `#card` basic compatibility

- Settings: replaced flat `legacyHashTag` with nested `legacy: { hashtagBasic: "card"; enabled: true }`. `mergeSettings` deep-merges the `legacy` field.
- New module `src/core/parse/extract-legacy-cards.ts` runs after the mdast walk. Block-range-aware line scanner; honours fenced-code, HTML-comment, blockquote exclusions.
- Recognises inline-tag (`Q #card`) and separate-line (`Q\n#card`) shapes on paragraphs and headings h1–h6. Answer terminates at blank line, next heading, next `#card`, or EOF; multi-line answer joined with `\n`.
- Disabled-mode (`legacy.enabled === false`) and custom hashtag (`legacy.hashtagBasic`) both covered.
- 21 new tests added (11 unit + 14 fixture × 1 + 4 mixed); 42/42 passing, `tsc --noEmit` clean.

### Reversed inline `Q::: A` test backfill

Tests added in `tests/core/parse/extract-cards.test.ts` under `describe("reversed inline cards (:::)")`. 7 cases: paragraph, list item, blockquote/code/HTML-comment exclusions, `:::` wins over `::`, basic+reversed co-existence in the same note. All pass against existing implementation; no production code change.

### Phase 1–early Phase 4 scaffolding

- Modern build (esbuild, eslint flat config, vitest, TS).
- Core contracts: `Flashcard`, `CardSource`, `FlashcardsSettings`, sync plan types.
- Parser slice: inline (paragraph + list), cloze (`==x==` and `{n:x}`), fenced ` ```flashcard `, structural exclusions (blockquote, code, HTML comment).
- Edits slice: `applyTextEdits`, `ensureNoteFrontmatter` with tests.
- Compatibility test scaffold + 14 fixture files for legacy hashtag basics.

## Notes for agents

- Do NOT read the v1 implementation under the old `src/services/` paths for ideas unless the human asks. Test-first, structure-first.
- `extractCardsFromMarkdown` uses `mdast` from `mdast-util-from-markdown`. Prefer node-type filtering over regex.
- Tests run with `npx vitest run`. Do not pass `--reporter=basic` (alias is broken in this vitest version).
- `.js` extensions in test/source imports are required (NodeNext module resolution).
