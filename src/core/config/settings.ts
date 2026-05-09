export type ContextStrategy = "headings" | "none" | "note-title";
export type ExplicitSyntax = "fenced";

export interface LegacySettings {
  enabled: boolean;
  hashtagBasic: string;
}

export interface FlashcardsSettings {
  contextSeparator: string;
  contextStrategy: ContextStrategy;
  defaultDeck: string;
  defaultTags: string[];
  explicitSyntax: ExplicitSyntax;
  folderBasedDecks: boolean;
  inlineReverseSeparator: string;
  inlineSeparator: string;
  legacy: LegacySettings;
}

export const DEFAULT_SETTINGS: FlashcardsSettings = {
  contextSeparator: " > ",
  contextStrategy: "headings",
  defaultDeck: "Default",
  defaultTags: ["obsidian"],
  explicitSyntax: "fenced",
  folderBasedDecks: true,
  inlineReverseSeparator: ":::",
  inlineSeparator: "::",
  legacy: {
    enabled: true,
    hashtagBasic: "card",
  },
};

export function mergeSettings(
  data: unknown,
  defaults: FlashcardsSettings = DEFAULT_SETTINGS,
): FlashcardsSettings {
  if (!data || typeof data !== "object") {
    return defaults;
  }

  const candidate = data as Partial<FlashcardsSettings>;
  const legacyCandidate =
    candidate.legacy && typeof candidate.legacy === "object"
      ? (candidate.legacy as Partial<LegacySettings>)
      : undefined;

  return {
    ...defaults,
    ...candidate,
    defaultTags: Array.isArray(candidate.defaultTags)
      ? candidate.defaultTags.filter((value): value is string => typeof value === "string")
      : defaults.defaultTags,
    legacy: {
      ...defaults.legacy,
      ...(legacyCandidate ?? {}),
    },
  };
}
