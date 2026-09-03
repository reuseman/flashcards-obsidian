---
cards-deck: Flashcards V2 accepted features
tags:
  - flashcards-v2-feature-check
flashcards:
  q-fhxd: { nid: 1788465159739, hash: scj3jvxe, sync: mynk3mfq }
  q-njw8: { nid: 1788465159765, hash: kkhhg26x, sync: nar7eemf }
  q-p44q: { nid: 1788465159790, hash: z89xpsvt, sync: jhu67tj9 }
  q-wrf8: { nid: 1788465159815, hash: epufnz7w, sync: hf7z4s4u }
  q-k49i: { nid: 1788465159840, hash: parvt2cj, sync: 7gnrnvjs }
---

# Accepted v2 features

## What does a standalone heading marker own?

#card

The complete heading section.


### A lower heading stays in the answer

This paragraph also stays in the answer.
^q-fhxd

## Card callout

> [!CARD] : Where should a long code line wrap?
> In Anki, inside the card instead of outside it.
>
> ```ts
> const deliberatelyLongName = "This long code line should wrap inside the Anki card on a narrow screen";
> ```
^q-njw8

## Inline list card

- What belongs to this list card?:: Its first answer and all child blocks.

  This child paragraph belongs to the same answer.

  - This nested item also belongs to the answer.
^q-p44q

## One cloze note from a list

- The ==heart== pumps blood.
- The {2:lungs} exchange gases.
^q-wrf8

## Explicit fenced cloze

```flashcard
type: cloze
front: The {1:atrium} receives blood.
back: This optional back becomes the Anki Extra field.
```
^q-k49i
