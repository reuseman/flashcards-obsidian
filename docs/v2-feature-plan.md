# V2 feature decision plan

Last reviewed: 2026-09-03

All linked GitHub issues describe v1. This file records the v2 decision so the
same issues do not need to be researched again. GitHub issues remain open until
the final v2 release pass.

Status meanings:

- **Covered**: v2 already provides the requested result. Verify the original
  example before closing the issue.
- **Implement**: accepted work with a bounded design.
- **Design**: do not implement until the behavior and ownership rules are
  approved.
- **Defer**: intentionally outside the first v2 release.
- **Decline**: the request conflicts with a documented v2 rule.

## Accepted implementation order

- [x] Add a read-only, actionable syntax migration report.
- [x] Finish the standalone-marker case for heading-section hashtag cards
      (#167).
- [x] Expose syntax toggles and secure AnkiConnect API-key configuration (#85,
      #181, #229).
- [x] Make the small independent improvements (#96, #112, #116, #134, then
      #131).
- [x] Add shared list-item/list ownership (#162, #217).
- [x] Add callout authoring and rendering (#107, #173).
- [x] Implement the approved default Anki card design for new managed models
      (#163, #209). The interactive prototype is in
      [`card-types.html`](card-types.html).
- [x] Add an explicit, backed-up style migration for existing managed Anki
      models.
- [x] Skip unchanged notes proven to be card-free with a disposable vault-scan
      index; keep full reconciliation for notes containing cards.
- [ ] Run the manual release smoke matrix.

Custom model profiles and mobile support remain post-v2 design projects.

## Issue map

| Issues     | Decision      | V2 action                                                                                                                                                                                                                       |
| ---------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #82, #103  | Covered       | Strict cloze syntax treats plain `{text}` and code/math braces as ordinary content.                                                                                                                                             |
| #85        | Covered       | **Highlight clozes** is on by default. Turning it off leaves `==text==` as Markdown while numbered/native clozes still work.                                                                                                    |
| #181       | Covered       | **Inline cards** exposes the existing parser toggle and is on by default.                                                                                                                                                       |
| #192       | Defer         | Use fixed documented syntax and per-syntax toggles; do not add arbitrary delimiters now.                                                                                                                                        |
| #229       | Covered       | The optional AnkiConnect key uses Obsidian `SecretStorage`; plugin data stores only the selected secret name. The key is passed to AnkiConnect and never logged.                                                                |
| #108       | Defer         | Mobile needs separate Android/iOS transports and its own roadmap.                                                                                                                                                               |
| #113       | Covered       | The built-in `obsidian://open` Source link opens the exact note block without an Advanced URI dependency. Sync repairs existing managed Back templates that have the field but omit `{{Source}}`, while preserving custom HTML. |
| #16        | Covered       | Stable source identities prevent unchanged cards from being re-added. Do not add an ambiguous partial-note ignore marker.                                                                                                       |
| #74        | Design        | Consider one-level `![[Note#^block]]` expansion only; define missing targets, media paths, and recursion first.                                                                                                                 |
| #88        | Decline       | Keep one consistent separate-line identity anchor and hide/style it in Obsidian views.                                                                                                                                          |
| #107, #173 | Covered       | `[!CARD] Question` is an explicit container. Ordinary callouts render as blockquotes without leaking `[!type]`.                                                                                                                 |
| #162, #217 | Covered       | Shared AST ownership makes inline list cards own child blocks and makes a cloze list one note.                                                                                                                                  |
| #167       | Covered       | Inline tagged headings and a marker-only paragraph after a heading both own the complete heading section.                                                                                                                       |
| #215       | Partial       | Heading-section cards are covered. Do not generate cards implicitly from every heading; track editor commands or multiblock cloze separately if needed.                                                                         |
| #75, #186  | Design        | Define named model profiles, field mapping, and template ownership before supporting arbitrary models. Managed v2 template customization is already preserved.                                                                  |
| #146       | Design        | Handle a separate Context field as part of model profiles; do not mutate existing models implicitly.                                                                                                                            |
| #96        | Covered       | Default CSS for new managed models wraps long code. Existing user CSS is never overwritten.                                                                                                                                     |
| #163       | Documentation | Document managed-model CSS, tag display, and template recipes instead of maintaining a large theme.                                                                                                                             |
| #209       | Documentation | Keep semantic paragraph HTML and document `p { margin: 0 }`; do not strip `<p>` globally.                                                                                                                                       |
| #112       | Covered       | Fenced `type: cloze` maps front to Text and optional back to Extra.                                                                                                                                                             |
| #193       | Design        | A bounded future typing model should use explicit fenced `type: typing`, not tag magic.                                                                                                                                         |
| #116       | Covered       | Active-note status shows the parsed card total with pending changes; no derived count is written to YAML.                                                                                                                       |
| #131       | Covered       | **Folder tags** is off by default. When enabled, it adds one normalized hierarchical folder tag.                                                                                                                                |
| #134       | Covered       | **Folder deck prefix** applies only to folder-derived decks; explicit `cards-deck` remains authoritative.                                                                                                                       |

## Managed Anki card design

Accepted and implemented for newly created managed models:

- Use a quiet, neutral review surface with readable spacing and a limited
  content width.
- Support light and dark mode, mobile width, long code, lists, and empty Extra
  content.
- Keep Source on the answer side so the note name cannot hint at the answer.
- Default Source label: **Edit source in Obsidian**, followed by the relative
  note path without `.md`.
- Do not overwrite customized Anki templates or CSS during normal sync. New
  models receive the default design. Existing models change only when the user
  runs **Flashcards: Apply v2 Anki card style** and confirms the preview.
- Keep plugin-owned CSS in a marked section so a later update can preserve CSS
  written by the user.

The Anki design lab in [`card-types.html`](card-types.html) shows basic,
reversed, cloze, and technical-content states. It can switch question/answer,
light/dark, and desktop/mobile views. Existing customized models keep their
templates and CSS until the user explicitly runs the style command. Before any
Anki write, the command saves their exact fields, templates, and CSS as JSON in
the plugin's `backups` directory. It updates the shared models in place, so the
existing note IDs, schedules, and review history remain. Their Source field
still receives the new action and path when a note syncs.

## Verification and issue updates

When work changes an issue assessment:

1. Update this file and `v2-readiness.md` in the same change.
2. Add the automated test or repeatable manual check.
3. Keep the GitHub issue open until the final v2 release pass.
4. Before closing, rerun the original v1 example against the release build.
5. In the closing comment, state that the report concerned v1 and name the
   first v2 release that contains the result.
