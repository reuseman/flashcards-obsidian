# Implementation Agent Guide

This guide is for the agent responsible for making the current tests pass.

## Mission

Implement the smallest coherent code changes that satisfy the current test-defined behavior.

You are not responsible for inventing new product behavior.

## Main Responsibilities

- read failing tests first
- change production code to satisfy the tests
- keep architecture boundaries intact
- surface ambiguity instead of guessing

## Workflow

1. run the affected tests
2. read the failing assertions carefully
3. inspect the smallest relevant production module
4. implement the narrowest correct fix
5. rerun tests

## Current Search Shortcuts

For parser work, start here:

- `tests/core/parse/extract-cards.test.ts`
- `tests/properties/inline-cards.property.test.ts`
- `src/core/parse/extract-cards.ts`

For text edit work, start here:

- `tests/core/edits/...`
- `src/core/edits/...`

Do not start by searching the deleted `v1` parser for ideas unless the human explicitly asks for compatibility research.

## Implementation Constraints

- keep parsing logic in `src/core`
- keep adapters thin
- do not add Obsidian-specific dependencies to core parsing
- prefer explicit branching on markdown node types
- avoid regex-first expansion when markdown structure can answer the question

## Current Expected Behavior

Already encoded in tests:

- paragraphs may produce inline cards
- list items may produce inline cards
- blockquotes must not produce inline cards
- fenced code blocks must not produce inline cards
- HTML comments must not produce inline cards
- paragraphs may produce cloze cards
- fenced `flashcard` code blocks may produce explicit cards

## Do

- implement only what the tests currently require
- keep fixes local and readable
- preserve or improve type clarity
- prefer node-type filtering over post-hoc string cleanup

## Don't

- do not broaden syntax support without tests
- do not “fix” tests by weakening them unless the TDD/product agent has changed the spec intentionally
- do not move product rules into settings prematurely
- do not optimize for completeness over correctness

## When To Stop

Stop when:

- the targeted tests pass
- you have not introduced unrelated behavior
- any remaining ambiguity is clearly surfaced for decision rather than guessed in code
