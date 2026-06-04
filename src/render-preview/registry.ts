import type { FlashcardsSettings } from "../core/config/settings.js";
import type { Feature } from "./feature.js";
import { anchor } from "./features/anchor.js";
import { cloze } from "./features/cloze.js";
import { createHashtag } from "./features/hashtag.js";
import { createInlineSeparator } from "./features/inline-separator.js";

/**
 * Build the active feature list for the given settings. Order is precedence:
 * earlier features win on overlap with later features.
 */
export function buildRegistry(settings: FlashcardsSettings): Feature[] {
  const rp = settings.renderPreview;
  if (!rp.enabled) return [];

  const out: Feature[] = [];
  if (rp.features.cloze) out.push(cloze);
  if (rp.features.anchor) out.push(anchor);
  if (rp.features.inlineSeparator) out.push(createInlineSeparator(settings));
  if (rp.features.hashtag) out.push(createHashtag(settings));
  return out;
}
