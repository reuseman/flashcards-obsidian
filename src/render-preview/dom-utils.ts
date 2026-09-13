import type { Match, MatchElement } from "./feature.js";

/**
 * Build the DOM node for a match.
 *
 * `doc` is the document the node is destined for — in a popout window that is
 * not the same object as the global `document`, and a node created by the
 * wrong document cannot be inserted. Callers pass the `ownerDocument` of the
 * container they are about to write into.
 */
export function createMatchElement(
  spec: MatchElement,
  doc: Document,
): HTMLSpanElement {
  const el = doc.createElement("span");
  el.className = spec.cls;
  el.textContent = spec.text;
  if (spec.title !== undefined) el.setAttribute("title", spec.title);
  for (const [key, value] of Object.entries(spec.data ?? {})) {
    el.setAttribute(`data-${key}`, value);
  }
  return el;
}

/**
 * Stable identity for a match element, used to decide whether a CodeMirror
 * widget can be reused instead of re-created.
 */
export function matchElementKey(spec: MatchElement): string {
  return JSON.stringify([spec.cls, spec.text, spec.title ?? null, spec.data ?? {}]);
}

/**
 * Merge per-feature match arrays into a single non-overlapping array,
 * sorted by start. First-feature-wins on overlap.
 */
export function mergeMatches(perFeature: Match[][]): Match[] {
  const accepted: Match[] = [];
  for (const list of perFeature) {
    for (const m of list) {
      if (accepted.some((a) => overlaps(a, m))) continue;
      accepted.push(m);
    }
  }
  accepted.sort((a, b) => a.start - b.start);
  return accepted;
}

function overlaps(a: Match, b: Match): boolean {
  return a.start < b.end && b.start < a.end;
}
