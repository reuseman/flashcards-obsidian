---
name: create-obsidian-flashcards
description: Create or improve effective Anki flashcards inside Obsidian notes using the Flashcards plugin v2 syntax. Use when a user asks to turn notes, documents, or study material into cards, revise weak cards, or choose the right supported card type. Do not use for editing Anki notes directly or for generic summaries with no flashcard output.
---

# Create Obsidian Flashcards

Create a small set of useful retrieval prompts from the user's source. Keep the
source accurate, preserve its meaning, and use only syntax supported by this
repository.

## Required context

Before generating or revising cards, read
[card design](references/card-design.md). Before writing cards into an Obsidian
note, also read [plugin syntax](references/plugin-syntax.md).

Use the source material supplied or selected by the user. If a claim is unclear
or unsupported, do not silently turn it into a fact. Preserve the uncertainty
or tell the user what is missing.

## Workflow

1. Identify the user's learning goal and the part of the source in scope.
2. Find the durable ideas that are worth retrieving. Do not create cards for
   every sentence.
3. Check existing cards in the target note. Avoid exact and semantic
   duplicates.
4. Draft a clear cue and the smallest answer that fully satisfies it.
5. Choose the card type from the decision rules in `plugin-syntax.md`.
6. If the user asked for file changes, place cards near the relevant source
   section unless they requested another location. Preserve unrelated prose and
   frontmatter.
7. Re-read each card without relying on nearby prose. Fix ambiguous questions,
   answer leakage, accidental multiple targets, and missing context.
8. Report which notes changed, how many cards were added or revised, and any
   source claims that need the user's judgment.

If the user asks only for suggestions or a preview, do not edit files. Show the
proposed cards in Markdown instead.

## Plugin invariants

- Obsidian is the authoring source. Do not edit linked card content in Anki.
- Never create or change the managed `flashcards` frontmatter property.
- Never create, copy, or change `^q-xxxx` or legacy numeric anchors. The plugin
  owns card identity and writes these values during update.
- Preserve existing generated metadata when editing around a card.
- Do not run an Obsidian-to-Anki update unless the user asks. Writing cards and
  changing external Anki state are separate actions.
- Use current v2 syntax. Do not produce v1 compatibility syntax.

## Card quality

- Make the learner retrieve an answer before seeing it.
- Give each card one main retrieval target. A short supporting explanation is
  fine when it helps understanding.
- Include enough context for one stable answer, but do not include words that
  reveal the answer.
- Prefer a direct question over a vague cue such as “Explain this.”
- Ask for a relationship, reason, distinction, or application when the learning
  goal is conceptual. Do not reduce every concept to isolated terminology.
- Use reversed cards only when recall in both directions is useful.
- Keep cloze deletions small and meaningful. Avoid hiding many unrelated facts
  in one note.
- Use reminder cards for principles or practices that should return
  periodically, not as a substitute for a testable question.
- Prefer fewer strong cards over exhaustive low-value coverage.

Do not claim that a card is “scientifically optimal.” Retrieval practice and
spacing have strong evidence, but the best cue and content still depend on the
learner's goal and prior knowledge.
