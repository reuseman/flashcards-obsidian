# Agent Guide

This file exists to reduce search time and prevent agents from making product or architecture decisions implicitly in code.

Start here before making changes.

## Current Goal

Build `v2` as a cleaner rewrite with:

- a pure markdown-centric core
- thin Obsidian and Anki adapters
- tests as the main executable spec
- low-maintenance repo-native docs

## Source Of Truth

Use these in this order:

1. tests
2. `plan.md`
3. the current codebase

If code and tests disagree, treat tests as the intended behavior unless the human explicitly says otherwise.

## Current Architecture

Main folders:

- `src/core`: pure parsing, domain, edits, sync planning
- `src/application`: use-case orchestration
- `src/adapters/obsidian`: Obsidian-specific integration only
- `src/adapters/anki`: AnkiConnect transport only
- `tests`: executable behavior/spec

Do not reintroduce the old `v1` structure with parser + service + UI logic mixed together.

## Current Product Direction

This is the current working direction, not a permanent law:

- inline cards stay as lightweight syntax
- cloze stays
- fenced `flashcard` blocks are the main explicit syntax candidate
- legacy `#card` syntax is compatibility-oriented, not the center of `v2`

## Current Documentation Direction

- keep docs in the repo
- `README.md` is the landing page
- longer docs live in `/docs`
- do not introduce a full docs site yet
- structure docs so they can later move into VitePress or something similar

## Current Parser Decisions

These are the first explicit `v2` parser decisions already encoded in tests:

- parse inline cards in paragraphs
- parse inline cards in list items
- do not parse inline cards in blockquotes
- do not parse inline cards in fenced code blocks
- do not parse inline cards in HTML comments
- parse cloze in paragraphs
- parse fenced `flashcard` blocks

If you want to change these rules, change tests intentionally first.

## Known Current State

At the time this guide was written:

- `npm run typecheck` passes
- `npm run lint` passes
- `npm test` intentionally has failing parser-spec tests

The current failing areas are part of the active TDD loop, not random breakage.

## Where Agents Usually Waste Time

Avoid spending time on these unless the human asks for it:

- searching the old `v1` code for design guidance
- inventing new syntax families without discussion
- building docs infrastructure beyond repo markdown
- polishing UI or plugin UX before core semantics are stable
- broad parser rewrites without first checking tests
- treating old GitHub issues as strict `v2` regressions instead of reference cases

## Do

- read the relevant tests first
- make the smallest change that satisfies the current behavior contract
- keep product decisions out of implementation code unless already encoded in tests
- preserve the architecture boundaries
- prefer explicit, typed domain models
- keep markdown parsing structure-first, not regex-first
- update tests first if behavior needs to change

## Don't

- do not silently expand syntax support
- do not add fallback heuristics just to make one case pass
- do not couple core logic to Obsidian runtime APIs
- do not move behavior into adapters that belongs in `src/core`
- do not create parallel “spec” prose for behavior already expressed clearly in tests
- do not restore the old architecture in new folders

## Fast Navigation

Useful files:

- `plan.md`
- `src/core/parse/extract-cards.ts`
- `tests/core/parse/extract-cards.test.ts`
- `tests/properties/inline-cards.property.test.ts`
- `src/core/edits/apply-text-edits.ts`
- `src/plugin.ts`

## Role-Specific Guides

- [TDD Agent Guide](docs/agents/tdd-agent.md)
- [Implementation Agent Guide](docs/agents/implementation-agent.md)
