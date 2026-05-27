export type CardKind = "basic" | "cloze" | "reversed";
export type CardSyntax = "inline" | "cloze" | "legacy-hashtag" | "fenced";

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
