import type { FlashcardsSettings } from "../../core/config/settings.js";
import {
  collectClozeSpans,
  intersectsSpan,
} from "../../core/parse/cloze-spans.js";
import type { Feature, FeatureFactory, Match } from "../feature.js";

function collectCodeSpans(line: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === "`") {
      const close = line.indexOf("`", i + 1);
      if (close === -1) {
        // Stray backtick with no closer — skip it and keep scanning.
        i++;
        continue;
      }
      out.push({ start: i, end: close + 1 });
      i = close + 1;
    } else {
      i++;
    }
  }
  return out;
}

function intersects(
  start: number,
  end: number,
  spans: { start: number; end: number }[],
): boolean {
  for (const s of spans) if (start < s.end && s.start < end) return true;
  return false;
}

export const createInlineSeparator: FeatureFactory = (
  settings: FlashcardsSettings,
): Feature => {
  const basic = settings.inlineSeparator;
  const reversed = settings.inlineReverseSeparator;

  return {
    id: "inline-separator",
    scope: "text",
    detect(source: string): Match[] {
      const clozes = collectClozeSpans(source);
      const code = collectCodeSpans(source);
      const matches: Match[] = [];
      const claimed: { start: number; end: number }[] = [];

      for (const [sep, html] of [
        [reversed, `<span class="ff-sep" data-kind="reversed">⇄</span>`],
        [basic, `<span class="ff-sep" data-kind="basic">→</span>`],
      ] as const) {
        if (!sep) continue;
        let idx = 0;
        while ((idx = source.indexOf(sep, idx)) !== -1) {
          const end = idx + sep.length;
          if (
            idx > 0 &&
            !intersectsSpan(idx, end, clozes) &&
            !intersects(idx, end, code) &&
            !intersects(idx, end, claimed)
          ) {
            matches.push({ start: idx, end, html });
            claimed.push({ start: idx, end });
          }
          idx = end;
        }
      }

      matches.sort((a, b) => a.start - b.start);
      return matches;
    },
  };
};
