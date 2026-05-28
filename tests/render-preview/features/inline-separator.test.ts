import { describe, expect, test } from "vitest";
import { DEFAULT_SETTINGS } from "../../../src/core/config/settings.js";
import { createInlineSeparator } from "../../../src/render-preview/features/inline-separator.js";

const feat = createInlineSeparator(DEFAULT_SETTINGS);

describe("inline-separator feature", () => {
  test("id and scope", () => {
    expect(feat.id).toBe("inline-separator");
    expect(feat.scope).toBe("text");
  });

  test("matches `::` in `Question:: Answer`", () => {
    const out = feat.detect("Question:: Answer");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ start: 8, end: 10 });
    expect(out[0]!.html).toBe(`<span class="ff-sep" data-kind="basic">→</span>`);
  });

  test("matches `:::` as reversed, not basic", () => {
    const out = feat.detect("Front::: Back");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ start: 5, end: 8 });
    expect(out[0]!.html).toBe(
      `<span class="ff-sep" data-kind="reversed">⇄</span>`,
    );
  });

  test("does NOT match `::` inside a cloze `{{c1::body}}`", () => {
    expect(feat.detect("text {{c1::body}} more")).toEqual([]);
  });

  test("does NOT match `::` inside backtick code", () => {
    expect(feat.detect("see `foo::bar` thanks")).toEqual([]);
  });

  test("does NOT match if there is no left-hand text (empty front)", () => {
    expect(feat.detect(":: answer")).toEqual([]);
  });

  test("respects custom inlineSeparator from settings", () => {
    const custom = createInlineSeparator({
      ...DEFAULT_SETTINGS,
      inlineSeparator: ";;",
      inlineReverseSeparator: ";;;",
    });
    const out = custom.detect("Q;; A");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ start: 1, end: 3 });
  });
});
