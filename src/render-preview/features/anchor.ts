import { escapeHtml } from "../dom-utils.js";
import type { Feature, Match } from "../feature.js";

// Must match insert-card-anchors.ts: V2 `^q-XXXX` with the 32-char custom
// alphabet, V1 `^<13 digits>`.
const V2_RE = /\^q-[abcdefghijkmnpqrstuvwxyz23456789]{4}\b/g;
const V1_RE = /\^\d{13}\b/g;

export const anchor: Feature = {
  id: "anchor",
  scope: "text",
  detect(source: string): Match[] {
    const matches: Match[] = [];
    for (const re of [V2_RE, V1_RE]) {
      for (const m of source.matchAll(re)) {
        const idx = m.index ?? 0;
        matches.push({
          start: idx,
          end: idx + m[0].length,
          html: `<span class="ff-anchor" title="${escapeHtml(m[0])}">·</span>`,
        });
      }
    }
    matches.sort((a, b) => a.start - b.start);
    return matches;
  },
};
