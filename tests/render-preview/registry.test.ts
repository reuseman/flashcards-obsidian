import { describe, expect, test } from "vitest";
import { DEFAULT_SETTINGS } from "../../src/core/config/settings.js";
import { buildRegistry } from "../../src/render-preview/registry.js";

describe("buildRegistry", () => {
  test("returns 3 features with defaults (inline-separator off)", () => {
    const features = buildRegistry(DEFAULT_SETTINGS);
    expect(features.map((f) => f.id)).toEqual([
      "cloze",
      "anchor",
      "hashtag",
    ]);
  });

  test("includes inline-separator when toggled on (in declared order)", () => {
    const features = buildRegistry({
      ...DEFAULT_SETTINGS,
      renderPreview: {
        ...DEFAULT_SETTINGS.renderPreview,
        features: {
          ...DEFAULT_SETTINGS.renderPreview.features,
          inlineSeparator: true,
        },
      },
    });
    expect(features.map((f) => f.id)).toEqual([
      "cloze",
      "anchor",
      "inline-separator",
      "hashtag",
    ]);
  });

  test("master switch off -> empty array", () => {
    const features = buildRegistry({
      ...DEFAULT_SETTINGS,
      renderPreview: { ...DEFAULT_SETTINGS.renderPreview, enabled: false },
    });
    expect(features).toEqual([]);
  });

  test("each toggle off removes only that feature", () => {
    const features = buildRegistry({
      ...DEFAULT_SETTINGS,
      renderPreview: {
        enabled: true,
        features: {
          cloze: false,
          anchor: true,
          inlineSeparator: false,
          hashtag: true,
        },
      },
    });
    expect(features.map((f) => f.id)).toEqual(["anchor", "hashtag"]);
  });

  test("cloze precedes anchor for first-feature-wins", () => {
    const features = buildRegistry(DEFAULT_SETTINGS);
    const clozeIdx = features.findIndex((f) => f.id === "cloze");
    const anchorIdx = features.findIndex((f) => f.id === "anchor");
    expect(clozeIdx).toBeLessThan(anchorIdx);
  });
});
