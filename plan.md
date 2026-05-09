# Flashcards Rewrite Plan

## Goal

Rewrite the project into a leaner, more testable, more portable codebase with:

- a pure markdown-centric core
- thin Obsidian and Anki adapters
- a real regression-focused test suite
- a parser architecture that handles structural markdown edge cases better than the current regex-heavy implementation

This document is based on an exploration of the current repository state as of April 25, 2026.

## Current Diagnosis

The current project works, but the implementation is tightly coupled and brittle in exactly the areas users have been reporting problems.

### 1. Runtime concerns are fused together

The current orchestration in `src/services/cards.ts` mixes:

- Obsidian APIs
- note reading/writing
- frontmatter handling
- card parsing
- deck selection
- media resolution
- Anki synchronization
- ID insertion/deletion

This makes the code difficult to test and hard to evolve without regressions.

### 2. The parser is regex-first instead of structure-first

The current parser in `src/services/parser.ts` and `src/conf/regex.ts` relies on large regexes to detect:

- card markers
- headings and context
- cloze syntax
- global tags
- deletion blocks
- code/math exclusions

This works for happy paths, but breaks down around structural edge cases such as:

- comments / HTML regions
- frontmatter interactions
- list items and nested list contexts
- code blocks and math boundaries
- inline ID placement drift
- note rewriting offsets after edits

### 3. The core logic is not portable beyond Obsidian

Even though the actual source material is markdown notes, the implementation assumes Obsidian deeply:

- direct imports from `obsidian`
- metadata cache dependencies
- DOM-based embed extraction
- file adapter assumptions

This blocks a future where markdown notes are processed outside Obsidian or where another adapter is introduced.

### 4. The current test suite is effectively absent

The repository has fixture notes under `tests/obsidian_vault`, but the actual test file is only a placeholder.

The current test harness is not a meaningful feedback loop for refactoring, regression prevention, or agent-assisted development.

### 5. Tooling and plugin scaffolding are old

The project currently uses:

- old Rollup-based plugin scaffolding
- old TypeScript and linting stack
- old manifest baseline
- old Obsidian API dependency setup

This increases maintenance cost and makes the rewrite harder to reason about unless modernized first.

## Concrete Risks Already Visible In Current Code

These are not theoretical; they are visible in the current implementation and match reported issues.

### Frontmatter rewriting is brittle

`src/services/cards.ts` rewrites frontmatter by slicing strings around offsets and manually appending `cards-deck`.

This is likely the root of frontmatter/dataview-related failures.

### ID insertion is offset-based string surgery

The current ID insertion logic mutates the source string using tracked offsets. This is fragile whenever multiple edits happen in one pass.

This likely explains missing IDs, duplicate IDs, and drift.

### Some async flows are not awaited

At least two runtime calls are suspicious:

- media insertion is kicked off without awaiting completion
- Anki update is invoked without awaiting the promise

This can create inconsistent runtime behavior and misleading notifications.

### Regexes encode invalid assumptions

Example: the `cards-deck` detection regex appears too narrow for real deck names.

This is a broader sign that the grammar is encoded through ad hoc patterns instead of a coherent model.

### Parser behavior depends on live DOM state

Embed extraction currently reaches into the rendered DOM, which makes pure tests difficult and couples parsing to runtime display behavior.

## Signals From Reported Issues

Recent open issues line up closely with the architectural weaknesses above:

- missing updates / missing IDs
- frontmatter and YAML breakage
- cloze overmatching inside comments / HTML
- cloze limitations for list-based notes

This confirms that the rewrite should target the architecture, not only patch specific bugs.

## Target Architecture

The rewrite should separate the system into a pure core plus thin adapters.

### 1. `core/`

A pure markdown-to-plan engine with no Obsidian imports and no Anki transport code.

Responsibilities:

- parse note content into card candidates
- resolve card semantics
- build context text
- normalize tags
- determine note edits
- produce diagnostics
- produce a sync plan

Input:

- note text
- note metadata
- config
- resolved references if needed

Output:

- parsed cards
- diagnostics / warnings
- deterministic text edits
- Anki sync intent

### 2. `adapters/markdown`

A vault-agnostic markdown note layer.

Responsibilities:

- note loading abstraction
- note identity / path abstraction
- link and media resolution contracts

This layer should make it possible to support:

- Obsidian-backed notes
- plain filesystem markdown
- test fixtures

### 3. `adapters/obsidian`

A thin integration layer around Obsidian APIs only.

Responsibilities:

- obtain the active note
- load file contents
- resolve vault metadata when available
- apply text edits
- expose commands, notices, settings, and status UI

No card grammar or sync business rules should live here.

### 4. `adapters/anki`

A typed AnkiConnect client.

Responsibilities:

- typed request/response handling
- note/card CRUD
- deck/model operations
- transport-level retries and error handling

No markdown parsing or note mutation should live here.

### 5. `application/`

Use-case orchestration that connects adapters and core.

Likely initial use cases:

- sync current note
- preview generated cards
- apply note edits

Likely future use cases:

- sync selected notes
- sync folder
- sync whole vault

## Parsing Strategy

The rewrite should stop using regex as the main architecture.

### Recommendation

Use a markdown AST pipeline as the main parse layer, with regex only for narrow local token helpers.

A likely stack is:

- `unified`
- `remark-parse`
- optionally `remark-frontmatter`
- custom visitors/plugins for flashcard syntax

### Why this is better

It gives explicit structure for:

- headings
- paragraphs
- list items
- blockquotes
- code blocks
- HTML/comment regions
- inline formatting
- source positions

This matters because many current bugs come from treating markdown like an unstructured string.

### Important principle

The parser should build an internal card-oriented model from markdown structure, then a separate rendering layer should generate the final Anki-facing fields.

That separation is important:

- parsing decides what the card is
- rendering decides how the card is presented

## Card Generation / Rendering Direction

The current project has good ideas, but they are entangled with parsing and note syntax.

The rewrite should preserve flexibility while making notes less noisy.

### Suggested split

#### Card definition syntax

What in the note means “this should become a card”.

Examples:

- `#card`
- inline separators
- cloze markers
- spaced markers

#### Context strategy

How surrounding note structure contributes to the front/text.

Examples:

- none
- heading ancestry
- note title
- note title plus headings
- custom template later

#### Source strategy

How the original note is referenced in the card.

Examples:

- disabled
- note link
- note link plus heading

#### Rendering strategy

How parsed markdown becomes Anki fields.

Examples:

- plain markdown-preserving render
- HTML render
- cloze render
- render with code support

This allows the user-facing behavior to stay flexible without forcing too much syntax into the markdown source.

## Candidate Authoring Syntaxes

We should not assume that the current `#card` model is the best long-term product choice.

Before implementation, it is worth listing the plausible syntax families and their trade-offs. We can decide later which one becomes:

- the canonical syntax
- the lightweight syntax
- the legacy-compatible syntax

### Option A. Hashtag-based cards

Examples:

```md
Question #card
Answer
```

```md
## Question #card
Answer
```

Pros:

- already familiar to existing users
- concise
- easy to type
- reasonably readable in plain markdown

Cons:

- visually pollutes prose
- collides conceptually with normal tags
- encourages line-shape parsing hacks
- awkward for advanced metadata
- not an especially clean long-term grammar

Assessment:

- good for backward compatibility
- weak candidate for canonical long-term syntax

### Option B. Inline separator cards

Examples:

```md
Question:: Answer
Question::: Answer
```

Pros:

- very fast to author
- low visual noise
- works well inside notes and lists
- feels natural for simple Q/A cards

Cons:

- ambiguous in richer prose
- hard to scale to advanced options
- harder to make robust for multiline and complex content
- can become fragile around escaping and formatting edge cases

Assessment:

- strong candidate for lightweight authoring
- weak candidate for fully expressive cards

### Option C. Cloze markers inside normal markdown

Examples:

```md
This is a ==cloze==.
This is a {cloze}.
This is a {2:cloze}.
```

Pros:

- excellent note ergonomics
- minimal visual disruption
- maps well to actual cloze use
- can coexist naturally with ordinary writing

Cons:

- can overmatch in comments / HTML / math if parsing is sloppy
- harder to make explicit when a whole block should or should not become a card
- limited room for per-card metadata

Assessment:

- strong candidate to keep
- should likely remain a specialized syntax rather than the only syntax

### Option D. Fenced flashcard blocks

Examples:

```md
```flashcard
type: basic
front: What is X?
back: X is ...
```
```

```md
```flashcard
type: reversed
tags: biology, exam-1
front: What is ATP?
back: Adenosine triphosphate
```
```

Pros:

- explicit intent
- easy to parse deterministically
- portable outside Obsidian
- scales well to advanced metadata
- good fit for multiline content
- good fit for testing and migration

Cons:

- visually heavier
- slower to author than inline syntax
- more “configuration-shaped”
- may feel too verbose for quick note-taking

Assessment:

- strong candidate for canonical explicit syntax

### Option E. Obsidian callout-based cards

Examples:

```md
> [!flashcard]
> What is X?
>
> X is ...
```

Pros:

- visually pleasant in Obsidian
- uses an existing markdown-ish convention
- more explicit than inline syntax

Cons:

- more Obsidian-shaped than markdown-portable
- semantics depend on a UI convention rather than a generic markdown construct
- less clean for non-Obsidian adapters

Assessment:

- attractive UX in Obsidian
- weaker fit for portability goals

### Option F. HTML comment / hidden metadata markers

Examples:

```md
Question
<!-- flashcard -->
Answer
```

Pros:

- low visible noise
- can hide metadata from readers

Cons:

- poor discoverability
- easy to break
- ugly in source once metadata grows
- creates comment parsing edge cases
- poor general UX for authors

Assessment:

- not recommended as a primary syntax

### Option G. Frontmatter / properties-driven note-level card definitions

Examples:

```md
---
flashcards:
  - type: basic
    front: What is X?
    back: X is ...
---
```

Pros:

- explicit
- structured
- easy to validate

Cons:

- bad authoring ergonomics for most note-taking flows
- disconnects cards from nearby note content
- poor fit for incremental editing
- frontmatter becomes overloaded quickly

Assessment:

- not recommended as the main authoring model

### Option H. Dedicated section syntax

Examples:

```md
## Flashcards

### Q
What is X?

### A
X is ...
```

Pros:

- very markdown-native
- readable without custom tooling
- less punctuation-heavy

Cons:

- structurally ambiguous
- cumbersome for many cards
- difficult to support inline note-taking flows
- likely to create heading-structure conflicts

Assessment:

- interesting conceptually
- weak fit for practical use at scale

## Current Product Direction Hypothesis

This is not the final decision, but at the moment the strongest direction appears to be a two-lane model:

### Lane 1. Lightweight syntax

Keep a small number of low-friction syntaxes for normal note-taking:

- inline basic/reversed cards
- cloze markers

### Lane 2. Explicit syntax

Introduce one robust, explicit syntax for advanced and multiline cards:

- fenced `flashcard` blocks

### Legacy support

Continue to parse legacy hashtag-based syntax for compatibility:

- `#card`
- `#card-reverse`
- `#card-spaced`

This would likely give the best balance of:

- usability
- portability
- parser clarity
- testability
- migration safety

## Text Editing Strategy

One of the most important changes is to replace ad hoc string mutation with deterministic text edits.

### Recommendation

The core should produce `TextEdit[]` operations with stable positions and explicit intent.

Examples:

- insert `cards-deck` into frontmatter
- insert a new card ID anchor
- remove orphaned ID blocks
- normalize generated metadata sections if needed

### Benefits

- easier testing
- easier idempotency guarantees
- easier debugging
- less offset drift

## Test Strategy

The test suite should be designed as the main feedback loop for future development.

This is a first-class requirement, not a follow-up task.

### Principles

- prefer pure-core tests over plugin-runtime tests
- capture real bug reports as fixtures
- assert both parsing and text-edit results
- make the sync plan testable without a running Anki instance
- ensure idempotency of repeated runs

### Test layers

#### 1. Parser fixture tests

Given markdown input, assert:

- detected cards
- card kinds
- fields
- tags
- context
- source info
- diagnostics

#### 2. Rewrite / text edit tests

Given markdown input and sync results, assert:

- frontmatter updates
- ID insertion behavior
- deletion block cleanup
- stable second-run output

#### 3. Regression fixture tests from GitHub issues

Every important edge case should become a locked regression fixture.

Initial targets:

- frontmatter/dataview YAML behavior
- missing ID insertion
- duplicate inline ID edge cases
- cloze inside comments / HTML
- cloze lists
- heading/context edge cases

#### 4. Application tests with fake adapters

Run the sync use case against:

- fake note repository
- fake Anki client
- fake media resolver

Assert the resulting sync plan and edits.

#### 5. Thin adapter tests

Only a small number of tests should exercise Obsidian-specific integration boundaries.

The goal is not to test Obsidian itself, but to verify that the adapter wires data correctly into the core.

### Properties worth testing explicitly

- parsing the same note twice yields the same card semantics
- applying generated edits and parsing again is stable
- note updates do not duplicate IDs
- frontmatter edits preserve unrelated properties
- comment/code/math regions do not leak card syntax

## Tooling Modernization

Before or alongside the rewrite, modernize the repo so the core can be developed safely.

### Recommended updates

- adopt the current Obsidian sample-plugin structure
- move to `esbuild`
- update TypeScript
- add `versions.json`
- refresh manifest requirements
- replace the current test setup with `vitest`
- add linting and typecheck commands

### Why this matters

The architecture rewrite should not sit on top of outdated scaffolding if we want a stable long-term codebase.

## Documentation Strategy

Documentation should optimize for two things:

- low maintenance for us
- a path to better end-user UX later without rewriting the documentation corpus

### Decision

Start with repository-native markdown documentation:

- keep `README.md` as the main landing page
- keep longer documentation in `/docs`
- keep everything as plain markdown with relative links

Do not introduce a full docs site yet.

### Why

This gives us:

- low maintenance now
- docs reviewed in normal PR flow
- docs living next to the code and tests
- an easy upgrade path later to VitePress or another static site generator

### Migration posture

The documentation should be structured from the start so it can later become a docs site with minimal churn.

That means:

- one topic per file
- stable filenames
- clear folder hierarchy
- explicit headings
- relative links
- assets under `/docs/assets`

### Relationship with the GitHub wiki

The wiki should be treated as transitional rather than a permanent parallel documentation system.

Likely path:

- migrate important content from the wiki into repo docs over time
- avoid maintaining both as authoritative sources long term

### Likely starter structure

- `README.md`
- `docs/getting-started.md`
- `docs/card-syntax.md`
- `docs/settings.md`
- `docs/faq.md`
- `docs/architecture.md`
- `docs/contributing.md`
- `docs/assets/...`

### Future upgrade path

If later the docs volume or UX needs justify it, move the same markdown corpus into:

- VitePress
- or another static docs system if needed

The goal is to evolve into a better user-facing docs experience without rebuilding documentation from scratch.

## Proposed Delivery Phases

### Phase 1. Scaffolding modernization

Deliver:

- modern build setup
- modern TS config
- baseline lint/typecheck/test commands
- updated plugin skeleton

No behavioral rewrite yet beyond what is needed to establish the new structure.

### Phase 2. Pure domain/core foundation

Deliver:

- domain types
- config schema
- parse result model
- sync plan model
- text edit model

This phase creates the contract the rest of the code will build on.

### Phase 3. New parser for current supported syntax

Deliver support for the currently important card forms:

- tagged basic cards
- inline cards
- reversed inline cards
- spaced cards
- cloze cards

Keep feature parity as a target, but prefer correctness over preserving accidental behavior.

### Phase 4. Deterministic note rewriting

Deliver:

- frontmatter patching
- ID insertion
- deletion cleanup
- stable second-run behavior

This phase should close a large class of update-related bugs.

### Phase 5. Anki sync application layer

Deliver:

- typed Anki adapter
- diffing between parsed cards and remote state
- create/update/delete/deck operations

This should be driven by the sync plan model, not by direct parser output.

### Phase 6. Obsidian integration layer

Deliver:

- plugin commands
- settings UI
- notices / status updates
- current-note sync flow

At this point the plugin becomes a shell around the new engine.

### Phase 7. Regression and feature completion

Deliver:

- issue-driven regression fixtures
- compatibility review against old syntax
- targeted improvements such as cloze lists and better source/context rendering

## Initial Rewrite Scope

To avoid trying to solve everything at once, the first meaningful rewrite slice should be:

1. modernize scaffolding
2. define pure core contracts
3. implement parser + fixture tests for basic cards, inline cards, and cloze exclusion rules
4. implement deterministic ID/frontmatter edits

That slice is small enough to ship incrementally but large enough to validate the architecture.

## Non-Goals For The First Slice

These should not block the initial rewrite:

- full feature parity for every historical edge case
- UI polish
- multi-note sync
- advanced media/embed behavior
- preserving every old accidental parsing quirk

## Open Design Questions

These should be resolved as the plan evolves:

- Should card IDs remain inline caret anchors, or should there be a more explicit metadata block strategy?
- How much of Obsidian-specific link behavior should the pure core understand versus delegate to adapters?
- Should embed expansion remain a feature, and if yes, should it operate on markdown source rather than rendered DOM?
- Should source/context rendering be fully template-driven or a constrained strategy enum initially?
- How much backward-compatibility should be preserved for existing notes that rely on old regex quirks?

## Recommended Next Step

Start implementation on a dedicated rewrite branch and make the first PR-sized milestone:

- modern scaffolding
- new core folders
- test harness
- first parser fixtures
- first deterministic note edit pipeline

That is the smallest step that meaningfully reduces future risk while creating a strong base for iteration.
