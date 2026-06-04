import type { FlashcardsSettings } from "../core/config/settings.js";

export type FeatureId =
  | "cloze"
  | "anchor"
  | "inline-separator"
  | "hashtag";

export interface Match {
  start: number;
  end: number;
  html: string;
}

export interface Feature {
  id: FeatureId;
  scope: "text" | "block";
  detect(source: string): Match[];
}

export type FeatureFactory = (settings: FlashcardsSettings) => Feature;
