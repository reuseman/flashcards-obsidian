import { parseClozeSyntax, type SourceSpan } from "./cloze-syntax.js";

export type Span = SourceSpan;

/**
 * Compatibility adapter for callers that need only the ranges claimed by the
 * strict tokenizer: `==highlight==`, `{N:text}`, and `{{cN::text}}`.
 */
export function collectClozeSpans(line: string): Span[] {
  return parseStrictClozeSpans(line);
}

function parseStrictClozeSpans(line: string): Span[] {
  return parseClozeSyntax(line).spans.map(({ start, end }) => ({ start, end }));
}

export function intersectsSpan(start: number, end: number, spans: Span[]): boolean {
  for (const s of spans) {
    if (start < s.end && end > s.start) return true;
  }
  return false;
}
