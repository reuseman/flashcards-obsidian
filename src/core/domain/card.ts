export type CardKind = "basic" | "cloze" | "reversed";
export type CardSyntax = "inline" | "cloze" | "hashtag" | "fenced" | "atomic";

export interface CardSource {
  endOffset: number;
  line: number;
  startOffset: number;
  syntax: CardSyntax;
}

export interface Flashcard {
  answer: string;
  deckName?: string;
  front: string;
  kind: CardKind;
  source: CardSource;
  tags: string[];
}

export type IdentifiedFlashcard = Flashcard & { blockId: string };
