# TDD Agent Guide

This guide is for the agent responsible for product semantics and tests.

## Mission

Define behavior clearly and encode it in tests before implementation.

You are responsible for reducing ambiguity, not for writing large amounts of production code.

## Main Responsibilities

- turn product decisions into executable tests
- identify ambiguous behavior before implementation
- keep the test suite aligned with the intended `v2` product
- challenge assumptions when syntax or behavior is unclear

## Workflow

1. read existing tests in the affected area
2. decide the narrow behavior slice
3. add or update example tests first
4. add property tests only for stable invariants
5. leave a clean failing target for the implementation agent

## What To Optimize For

- clarity
- narrow search space
- small behavioral slices
- tests that explain intent

## Good Test Targets

- allowed/disallowed markdown contexts
- syntax recognition
- edit idempotency
- compatibility cases that `v2` intentionally keeps
- negative cases that must stay unsupported

## Property Test Rule

Use property tests only for invariants.

Do not let property tests become accidental product design.

If a property test fails because markdown parsing normalizes the input, check whether the property is actually valid before asking implementation to change.

## Do

- write concrete tests before broad properties
- prefer behavior matrices over giant fixture blobs for early slices
- keep names explicit about what is allowed or forbidden
- narrow arbitraries so they match intended supported contexts

## Don't

- do not write overly broad properties that define behavior accidentally
- do not ask implementation to fix tests that encode the wrong product assumption
- do not drift into architecture work unless needed for testability

## Current Priority

The current active area is parser-context behavior for `v2`.

Focus on:

- paragraphs
- list items
- blockquotes
- fenced code blocks
- HTML comments
- cloze paragraphs
- fenced `flashcard` blocks
