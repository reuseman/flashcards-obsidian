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

describe("WI-7: per-syntax toggles", () => {
  test("DEFAULT_SETTINGS has inline/cloze/fenced/atomic all enabled by default", () => {
    expect(DEFAULT_SETTINGS.inline).toEqual({ enabled: true });
    expect(DEFAULT_SETTINGS.cloze).toEqual({ enabled: true });
    expect(DEFAULT_SETTINGS.fenced).toEqual({ enabled: true });
    expect(DEFAULT_SETTINGS.atomic).toEqual({ enabled: true });
  });

  test("mergeSettings fills defaults for inline/cloze/fenced/atomic from a pre-WI-7 persisted config", () => {
    const merged = mergeSettings({ defaultDeck: "Legacy" });
    expect(merged.defaultDeck).toBe("Legacy");
    expect(merged.inline).toEqual({ enabled: true });
    expect(merged.cloze).toEqual({ enabled: true });
    expect(merged.fenced).toEqual({ enabled: true });
    expect(merged.atomic).toEqual({ enabled: true });
  });

  test("mergeSettings preserves a persisted override on one toggle block", () => {
    const merged = mergeSettings({ inline: { enabled: false } });
    expect(merged.inline).toEqual({ enabled: false });
    expect(merged.cloze).toEqual({ enabled: true });
    expect(merged.fenced).toEqual({ enabled: true });
    expect(merged.atomic).toEqual({ enabled: true });
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
