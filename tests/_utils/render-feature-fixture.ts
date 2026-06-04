import { DEFAULT_SETTINGS } from "../../src/core/config/settings.js";
import type { FlashcardsSettings } from "../../src/core/config/settings.js";
import { extractCardsFromMarkdown } from "../../src/core/parse/extract-cards.js";
import {
  type RenderedCard,
  renderCardForAnki,
} from "../../src/core/render/render-card.js";
import type { IdentifiedFlashcard } from "../../src/core/domain/card.js";
import { extractMedia } from "../../src/core/render/extract-media.js";
import {
  rewriteMedia,
  type MediaRewriteMap,
} from "../../src/core/render/rewrite-media.js";
import { createHash } from "node:crypto";

export interface FixtureOptions {
  notePath: string;
  settings?: FlashcardsSettings;
  vaultName?: string;
}

const ANCHOR_RE = /(?:[ \t]+\^[A-Za-z0-9-]+)+[ \t]*$/gm;

/**
 * Synthetic resolver used only in feature snapshots: deterministically maps
 * every `MediaRef.filename` to `<sha1>.<ext>` where the SHA-1 is taken over
 * the literal string `"placeholder:" + filename`. Avoids real bytes, keeps
 * snapshots stable, exercises the rewrite pipeline end-to-end.
 */
function buildSyntheticMap(markdown: string): MediaRewriteMap {
  const refs = extractMedia(markdown);
  const map: MediaRewriteMap = {};
  for (const ref of refs) {
    if (map[ref.filename]) continue;
    const hash = createHash("sha1")
      .update(`placeholder:${ref.filename}`)
      .digest("hex");
    const dot = ref.filename.lastIndexOf(".");
    const ext = dot < 0 ? "" : ref.filename.slice(dot + 1).toLowerCase();
    map[ref.filename] = {
      kind: ref.kind,
      finalName: ext.length > 0 ? `${hash}.${ext}` : hash,
    };
  }
  return map;
}

export function renderFeatureFixture(
  markdown: string,
  options: FixtureOptions,
): RenderedCard[] {
  const settings = options.settings ?? DEFAULT_SETTINGS;
  const vaultName = options.vaultName ?? "Vault";
  const cleaned = markdown.replace(ANCHOR_RE, "");
  const mediaMap = buildSyntheticMap(cleaned);
  const { cards } = extractCardsFromMarkdown(cleaned, {
    notePath: options.notePath,
    settings,
  });
  return cards.map((card, index): RenderedCard => {
    const identified: IdentifiedFlashcard = {
      ...card,
      answer: rewriteMedia(card.answer, mediaMap),
      blockId: `card-${index}`,
      front: rewriteMedia(card.front, mediaMap),
    };
    return renderCardForAnki(identified, {
      deckName: card.deckName ?? settings.defaultDeck,
      notePath: options.notePath,
      tags: card.tags,
      vaultName,
      resolveLink: (target) => target,
    });
  });
}
