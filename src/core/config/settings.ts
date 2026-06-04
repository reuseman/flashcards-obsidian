export type ContextStrategy = "headings" | "none" | "note-title";
export type ExplicitSyntax = "fenced";
export type LogLevelSetting = "debug" | "info" | "warn" | "error";

export interface LegacySettings {
  enabled: boolean;
  hashtagBasic: string;
}

export interface RenderPreviewSettings {
  enabled: boolean;
  features: {
    cloze: boolean;
    anchor: boolean;
    inlineSeparator: boolean;
    legacyHashtag: boolean;
  };
}

export interface FlashcardsSettings {
  confirmBeforeDelete: boolean;
  contextSeparator: string;
  contextStrategy: ContextStrategy;
  defaultDeck: string;
  defaultTags: string[];
  explicitSyntax: ExplicitSyntax;
  folderBasedDecks: boolean;
  inlineReverseSeparator: string;
  inlineSeparator: string;
  legacy: LegacySettings;
  logLevel: LogLevelSetting;
  logToFile: boolean;
  perfTracing: boolean;
  renderPreview: RenderPreviewSettings;
  v1MigrationDecisionMade: boolean;
}

export const DEFAULT_SETTINGS: FlashcardsSettings = {
  confirmBeforeDelete: true,
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
  logLevel: "info",
  logToFile: true,
  perfTracing: false,
  renderPreview: {
    enabled: true,
    features: {
      cloze: true,
      anchor: true,
      inlineSeparator: false,
      legacyHashtag: true,
    },
  },
  v1MigrationDecisionMade: false,
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
  const renderPreviewCandidate =
    candidate.renderPreview && typeof candidate.renderPreview === "object"
      ? (candidate.renderPreview as Partial<RenderPreviewSettings>)
      : undefined;
  const renderPreviewFeaturesCandidate =
    renderPreviewCandidate?.features && typeof renderPreviewCandidate.features === "object"
      ? (renderPreviewCandidate.features as Partial<RenderPreviewSettings["features"]>)
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
    renderPreview: {
      ...defaults.renderPreview,
      ...(renderPreviewCandidate ?? {}),
      features: {
        ...defaults.renderPreview.features,
        ...(renderPreviewFeaturesCandidate ?? {}),
      },
    },
  };
}
