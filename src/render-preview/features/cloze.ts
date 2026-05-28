import { escapeHtml } from "../dom-utils.js";
import type { Feature, Match } from "../feature.js";

const RE = /\{\{c(\d+)::([^}]+)\}\}|\{(\d+):([^}]+)\}/g;

export const cloze: Feature = {
  id: "cloze",
  scope: "text",
  detect(source: string): Match[] {
    const matches: Match[] = [];
    for (const m of source.matchAll(RE)) {
      const idx = m.index ?? 0;
      const n = m[1] ?? m[3]!;
      const body = m[2] ?? m[4]!;
      matches.push({
        start: idx,
        end: idx + m[0].length,
        html: `<span class="ff-cloze" data-c="${n}">${escapeHtml(body)}</span>`,
      });
    }
    matches.sort((a, b) => a.start - b.start);
    return matches;
  },
};
