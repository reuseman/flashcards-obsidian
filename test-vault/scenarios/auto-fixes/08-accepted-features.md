---
cards-deck: Flashcards V2 accepted features
tags:
  - flashcards-v2-feature-check
---

# Accepted v2 features

## What does a standalone heading marker own?

#card

The complete heading section.


### A lower heading stays in the answer

This paragraph also stays in the answer.

## Card callout

> [!CARD] : Where should a long code line wrap?
> In Anki, inside the card instead of outside it.
>
> ```ts
> const deliberatelyLongName = "This long code line should wrap inside the Anki card on a narrow screen";
> ```

## Inline list card

- What belongs to this list card?:: Its first answer and all child blocks.

  This child paragraph belongs to the same answer.

  - This nested item also belongs to the answer.

## One cloze note from a list

- The ==heart== pumps blood.
- The {2:lungs} exchange gases.

## Explicit fenced cloze

```flashcard
type: cloze
front: The {1:atrium} receives blood.
back: This optional back becomes the Anki Extra field.
```
