---
cards-deck: Flashcards V2 checks
tags:
  - flashcards-v2-grammar-check
flashcards:
  q-bw5a: { nid: 1788465160040, hash: gcg5uq8u, sync: 672wj8mk }
  q-zi2e: { nid: 1788465160065, hash: d4jekzwi, sync: ym77chqi }
  q-3vh6: { nid: 1788465160089, hash: iwtjfgpb, sync: 7ic4vdib }
---

# Strict grammar and boundaries

A mathematical set such as {a, b, c} is ordinary text.

First $a+b$, then {1:$c^{2}+d$}, then $e+f$.
^q-bw5a

## What does a hashtag heading own? #card

The whole section is one answer. Text such as left::right,
TCP:::Transmission Control Protocol, and ==highlight== stays in this answer.

### Lower heading

This lower section is also part of the answer.
^q-zi2e

## Next topic

Which items are in the next Markdown node? #card

- first item
- second item
^q-3vh6

This paragraph is outside that card.

`Code with #card, left::right, and {1:hidden} stays code.`

Math-only markers stay math: $x_{#card} + y::{1:z}$.

```text
Question #card
left::right
{1:not-a-card}
```
