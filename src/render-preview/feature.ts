import type { FlashcardsSettings } from "../core/config/settings.js";

export type FeatureId =
  | "cloze"
  | "anchor"
  | "inline-separator"
  | "hashtag";

/**
 * Declarative description of the `<span>` a match renders to.
 *
 * Features describe elements rather than emitting HTML strings: `text` is
 * assigned via `textContent` and attributes via `setAttribute`, so user
 * content can never be interpreted as markup. This is what keeps the
 * adapters free of `innerHTML`.
 */
export interface MatchElement {
  /** Value for the span's `class` attribute. */
  cls: string;
  /** Visible text content. Never parsed as HTML. */
  text: string;
  /** Optional `title` attribute (tooltip). */
  title?: string;
  /** Optional `data-*` attributes, keyed by the part after `data-`. */
  data?: Record<string, string>;
}

export interface Match {
  start: number;
  end: number;
  el: MatchElement;
}

export interface Feature {
  id: FeatureId;
  scope: "text" | "block";
  detect(source: string): Match[];
}

export type FeatureFactory = (settings: FlashcardsSettings) => Feature;
