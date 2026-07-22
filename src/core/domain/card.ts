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

export type IdentifiedFlashcard = Flashcard & {
  blockId: string;
  // Atomic cards only: the cue hash computed at identity-resolution time
  // (from the raw, pre-media-rewrite front). Carried through every downstream
  // stage so frontmatter writers never recompute it from a possibly-rewritten
  // front (see preview-sync-plan.ts WI-9 comment).
  cue?: string;
};
