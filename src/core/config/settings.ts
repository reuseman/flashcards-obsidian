export type ContextStrategy = "headings" | "none" | "note-title";
export type ExplicitSyntax = "fenced";
export type LogLevelSetting = "debug" | "info" | "warn" | "error";

export interface HashtagSettings {
  enabled: boolean;
  basicTag: string;
}

export interface SyntaxToggleSettings {
  enabled: boolean;
}

export interface RenderPreviewSettings {
  enabled: boolean;
  features: {
    cloze: boolean;
    anchor: boolean;
    inlineSeparator: boolean;
    hashtag: boolean;
  };
}

export interface FlashcardsSettings {
  /** Name of an Obsidian SecretStorage entry, never the secret value itself. */
  ankiConnectApiKeySecret: string;
  atomic: SyntaxToggleSettings;
  cloze: SyntaxToggleSettings;
  confirmBeforeDelete: boolean;
  contextSeparator: string;
  contextStrategy: ContextStrategy;
  defaultDeck: string;
  defaultTags: string[];
  explicitSyntax: ExplicitSyntax;
  fenced: SyntaxToggleSettings;
  folderBasedDecks: boolean;
  folderBasedTags: boolean;
  folderDeckPrefix: string;
  hashtag: HashtagSettings;
  highlightCloze: SyntaxToggleSettings;
  inline: SyntaxToggleSettings;
  inlineReverseSeparator: string;
  inlineSeparator: string;
  logLevel: LogLevelSetting;
  logToFile: boolean;
  perfTracing: boolean;
  renderPreview: RenderPreviewSettings;
  v1MigrationDecisionMade: boolean;
}

export const DEFAULT_SETTINGS: FlashcardsSettings = {
  ankiConnectApiKeySecret: "",
  atomic: { enabled: true },
  cloze: { enabled: true },
  confirmBeforeDelete: true,
  contextSeparator: " > ",
  contextStrategy: "headings",
  defaultDeck: "Default",
  defaultTags: ["obsidian"],
  explicitSyntax: "fenced",
  fenced: { enabled: true },
  folderBasedDecks: true,
  folderBasedTags: false,
  folderDeckPrefix: "",
  hashtag: {
    enabled: true,
    basicTag: "card",
  },
  highlightCloze: { enabled: true },
  inline: { enabled: true },
  inlineReverseSeparator: ":::",
  inlineSeparator: "::",
  logLevel: "info",
  logToFile: true,
  perfTracing: false,
  renderPreview: {
    enabled: true,
    features: {
      cloze: true,
      anchor: true,
      inlineSeparator: false,
      hashtag: true,
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

  const candidate = data as Partial<FlashcardsSettings> & {
    // Back-compat: pre-rename persisted shape used `legacy` / `hashtagBasic` /
    // `legacyHashtag`. Old key takes effect only when the new key is absent.
    legacy?: { enabled?: boolean; hashtagBasic?: string; basicTag?: string };
  };
  const newHashtagCandidate =
    candidate.hashtag && typeof candidate.hashtag === "object"
      ? (candidate.hashtag as Partial<HashtagSettings>)
      : undefined;
  const oldLegacyCandidate =
    candidate.legacy && typeof candidate.legacy === "object"
      ? candidate.legacy
      : undefined;
  const oldHashtagMapped: Partial<HashtagSettings> | undefined = oldLegacyCandidate
    ? {
        ...(typeof oldLegacyCandidate.enabled === "boolean"
          ? { enabled: oldLegacyCandidate.enabled }
          : {}),
        ...(typeof oldLegacyCandidate.hashtagBasic === "string"
          ? { basicTag: oldLegacyCandidate.hashtagBasic }
          : {}),
      }
    : undefined;

  const renderPreviewCandidate =
    candidate.renderPreview && typeof candidate.renderPreview === "object"
      ? (candidate.renderPreview as Partial<RenderPreviewSettings>)
      : undefined;
  const renderPreviewFeaturesCandidate =
    renderPreviewCandidate?.features && typeof renderPreviewCandidate.features === "object"
      ? (renderPreviewCandidate.features as Partial<RenderPreviewSettings["features"]> & {
          legacyHashtag?: boolean;
        })
      : undefined;
  const oldHashtagFeatureMapped: { hashtag?: boolean } =
    renderPreviewFeaturesCandidate &&
    typeof renderPreviewFeaturesCandidate.legacyHashtag === "boolean"
      ? { hashtag: renderPreviewFeaturesCandidate.legacyHashtag }
      : {};
  const newFeaturesCandidate = renderPreviewFeaturesCandidate
    ? { ...renderPreviewFeaturesCandidate }
    : undefined;
  if (newFeaturesCandidate) {
    delete (newFeaturesCandidate as { legacyHashtag?: unknown }).legacyHashtag;
  }

  const mergedCandidate = { ...candidate };
  delete (mergedCandidate as { legacy?: unknown }).legacy;

  return {
    ...defaults,
    ...mergedCandidate,
    atomic: mergeSyntaxToggle(defaults.atomic, candidate.atomic),
    cloze: mergeSyntaxToggle(defaults.cloze, candidate.cloze),
    defaultTags: Array.isArray(candidate.defaultTags)
      ? candidate.defaultTags.filter((value): value is string => typeof value === "string")
      : defaults.defaultTags,
    hashtag: {
      ...defaults.hashtag,
      // Old shape applies first; the new `hashtag` key (if present) wins.
      ...(oldHashtagMapped ?? {}),
      ...(newHashtagCandidate ?? {}),
    },
    highlightCloze: mergeSyntaxToggle(
      defaults.highlightCloze,
      candidate.highlightCloze,
    ),
    fenced: mergeSyntaxToggle(defaults.fenced, candidate.fenced),
    inline: mergeSyntaxToggle(defaults.inline, candidate.inline),
    renderPreview: {
      ...defaults.renderPreview,
      ...(renderPreviewCandidate ?? {}),
      features: {
        ...defaults.renderPreview.features,
        // Old `legacyHashtag` applies first; new `hashtag` feature key wins.
        ...oldHashtagFeatureMapped,
        ...(newFeaturesCandidate ?? {}),
      },
    },
  };
}

function mergeSyntaxToggle(
  defaults: SyntaxToggleSettings,
  candidate: SyntaxToggleSettings | undefined,
): SyntaxToggleSettings {
  return candidate && typeof candidate === "object"
    ? { ...defaults, ...candidate }
    : defaults;
}
