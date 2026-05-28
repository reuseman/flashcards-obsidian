import type { FlashcardsSettings } from "../../core/config/settings.js";
import { escapeHtml } from "../dom-utils.js";
import type { Feature, FeatureFactory, Match } from "../feature.js";

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const createLegacyHashtag: FeatureFactory = (
  settings: FlashcardsSettings,
): Feature => {
  const enabled = settings.legacy.enabled;
  const basic = settings.legacy.hashtagBasic;
  const escBasic = escapeRegex(basic);
  const re = new RegExp(
    `#${escBasic}(?:-reverse|/reverse)?(?![\\w-])`,
    "g",
  );

  return {
    id: "legacy-hashtag",
    scope: "text",
    detect(source: string): Match[] {
      if (!enabled) return [];
      const matches: Match[] = [];
      for (const m of source.matchAll(re)) {
        const idx = m.index ?? 0;
        matches.push({
          start: idx,
          end: idx + m[0].length,
          html: `<span class="ff-legacy-tag" title="Legacy v1 syntax">${escapeHtml(m[0])}</span>`,
        });
      }
      return matches;
    },
  };
};
