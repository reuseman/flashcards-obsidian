import type { Match } from "./feature.js";

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);
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
