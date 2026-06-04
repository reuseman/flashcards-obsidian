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
        hashtag: true,
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
    expect(merged.renderPreview.features.hashtag).toBe(true);
  });
});

describe("mergeSettings back-compat (pre-rename keys)", () => {
  test("old `legacy` object maps onto `hashtag` (enabled + basicTag)", () => {
    const merged = mergeSettings({
      legacy: { enabled: false, hashtagBasic: "flashcard" },
    });
    expect(merged.hashtag).toEqual({ enabled: false, basicTag: "flashcard" });
    // The deprecated key must not leak into the merged shape.
    expect((merged as { legacy?: unknown }).legacy).toBeUndefined();
  });

  test("old `renderPreview.features.legacyHashtag` maps onto `hashtag`", () => {
    const merged = mergeSettings({
      renderPreview: { features: { legacyHashtag: false } },
    });
    expect(merged.renderPreview.features.hashtag).toBe(false);
    expect(
      (merged.renderPreview.features as { legacyHashtag?: unknown }).legacyHashtag,
    ).toBeUndefined();
  });

  test("new `hashtag` key wins over old `legacy` key when both present", () => {
    const merged = mergeSettings({
      legacy: { enabled: false, hashtagBasic: "old" },
      hashtag: { enabled: true, basicTag: "new" },
    } as unknown);
    expect(merged.hashtag).toEqual({ enabled: true, basicTag: "new" });
  });
});
