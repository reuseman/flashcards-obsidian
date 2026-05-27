import { DEFAULT_SETTINGS } from "../../src/core/config/settings.js";
import type { FlashcardsSettings } from "../../src/core/config/settings.js";
import { extractCardsFromMarkdown } from "../../src/core/parse/extract-cards.js";
import {
  type RenderedCard,
  renderCardForAnki,
} from "../../src/adapters/anki/render-card.js";
import type { IdentifiedFlashcard } from "../../src/core/domain/card.js";

export interface FixtureOptions {
  notePath: string;
  settings?: FlashcardsSettings;
  vaultName?: string;
}

const ANCHOR_RE = /(?:[ \t]+\^[A-Za-z0-9-]+)+[ \t]*$/gm;

export function renderFeatureFixture(
  markdown: string,
  options: FixtureOptions,
): RenderedCard[] {
  const settings = options.settings ?? DEFAULT_SETTINGS;
  const vaultName = options.vaultName ?? "Vault";
  const cleaned = markdown.replace(ANCHOR_RE, "");
  const { cards } = extractCardsFromMarkdown(cleaned, {
    notePath: options.notePath,
    settings,
  });
  return cards.map((card, index): RenderedCard => {
    const identified: IdentifiedFlashcard = { ...card, blockId: `card-${index}` };
    return renderCardForAnki(identified, {
      deckName: card.deckName ?? settings.defaultDeck,
      notePath: options.notePath,
      tags: card.tags,
      vaultName,
      resolveLink: (target) => target,
    });
  });
}
