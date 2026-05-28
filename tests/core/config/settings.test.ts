import { describe, expect, test } from "vitest";
import { DEFAULT_SETTINGS, mergeSettings } from "../../../src/core/config/settings.js";

describe("renderPreview settings", () => {
  test("defaults: enabled true, inline-separator off, others on", () => {
    expect(DEFAULT_SETTINGS.renderPreview).toEqual({
      enabled: true,
      features: {
        cloze: true,
        anchor: true,
        inlineSeparator: false,
        legacyHashtag: true,
      },
    });
  });

  test("mergeSettings preserves user overrides for renderPreview", () => {
    const merged = mergeSettings({
      renderPreview: { enabled: false, features: { cloze: false } },
    });
    expect(merged.renderPreview.enabled).toBe(false);
    expect(merged.renderPreview.features.cloze).toBe(false);
    expect(merged.renderPreview.features.anchor).toBe(true);
    expect(merged.renderPreview.features.inlineSeparator).toBe(false);
    expect(merged.renderPreview.features.legacyHashtag).toBe(true);
  });
});
