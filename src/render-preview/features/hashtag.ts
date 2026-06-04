import type { FlashcardsSettings } from "../../core/config/settings.js";
import { escapeHtml } from "../dom-utils.js";
import type { Feature, FeatureFactory, Match } from "../feature.js";

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const createHashtag: FeatureFactory = (
  settings: FlashcardsSettings,
): Feature => {
  const enabled = settings.hashtag.enabled;
  const basic = settings.hashtag.basicTag;
  const escBasic = escapeRegex(basic);
  const re = new RegExp(
    `#${escBasic}(?:-reverse|/reverse)?(?![\\w-])`,
    "g",
  );

  return {
    id: "hashtag",
    scope: "text",
    detect(source: string): Match[] {
      if (!enabled) return [];
      const matches: Match[] = [];
      for (const m of source.matchAll(re)) {
        const idx = m.index ?? 0;
        matches.push({
          start: idx,
          end: idx + m[0].length,
          html: `<span class="ff-hashtag-tag" title="Hashtag (#card) syntax">${escapeHtml(m[0])}</span>`,
        });
      }
      return matches;
    },
  };
};
