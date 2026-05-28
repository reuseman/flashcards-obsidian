export interface Span {
  end: number;
  start: number;
}

/**
 * Returns the source ranges of cloze constructs claimed by `parseClozeCard`:
 *   - `==highlight==`
 *   - `{N:text}` and `{text}`
 *   - `{{cN::text}}` (Anki-native; matched by the curly-brace pattern via its
 *     inner `{cN::text}` substring — we widen to the outer `{{...}}` here so
 *     the entire Anki cloze is excluded from inline-separator scanning).
 */
export function collectClozeSpans(line: string): Span[] {
  const spans: Span[] = [];

  for (const m of line.matchAll(/==.+?==/g)) {
    const idx = m.index ?? 0;
    spans.push({ end: idx + m[0].length, start: idx });
  }

  for (const m of line.matchAll(/\{\{c\d+::[^}]+\}\}/g)) {
    const idx = m.index ?? 0;
    spans.push({ end: idx + m[0].length, start: idx });
  }

  for (const m of line.matchAll(/\{(?:\d+:)?[^}]+\}/g)) {
    const idx = m.index ?? 0;
    spans.push({ end: idx + m[0].length, start: idx });
  }

  return spans;
}

export function intersectsSpan(start: number, end: number, spans: Span[]): boolean {
  for (const s of spans) {
    if (start < s.end && end > s.start) return true;
  }
  return false;
}
