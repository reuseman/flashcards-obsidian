import { describe, expect, test } from "vitest";
import { DEFAULT_SETTINGS } from "../../../src/core/config/settings.js";
import { createLegacyHashtag } from "../../../src/render-preview/features/legacy-hashtag.js";

const feat = createLegacyHashtag(DEFAULT_SETTINGS);

describe("legacy-hashtag feature", () => {
  test("id and scope", () => {
    expect(feat.id).toBe("legacy-hashtag");
    expect(feat.scope).toBe("text");
  });

  test("matches `#card`", () => {
    const out = feat.detect("Question text #card");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ start: 14, end: 19 });
    expect(out[0]!.html).toBe(
      `<span class="ff-legacy-tag" title="Legacy v1 syntax">#card</span>`,
    );
  });

  test("matches `#card-reverse` and `#card/reverse`", () => {
    expect(feat.detect("q #card-reverse")[0]).toMatchObject({ start: 2, end: 15 });
    expect(feat.detect("q #card/reverse")[0]).toMatchObject({ start: 2, end: 15 });
  });

  test("does NOT match `#card-extra` (longer continuation)", () => {
    expect(feat.detect("x #card-extra y")).toEqual([]);
  });

  test("does NOT match `#cardiology` (prefix only)", () => {
    expect(feat.detect("x #cardiology y")).toEqual([]);
  });

  test("disabled when settings.legacy.enabled is false", () => {
    const off = createLegacyHashtag({
      ...DEFAULT_SETTINGS,
      legacy: { enabled: false, hashtagBasic: "card" },
    });
    expect(off.detect("x #card y")).toEqual([]);
  });

  test("respects custom hashtagBasic", () => {
    const custom = createLegacyHashtag({
      ...DEFAULT_SETTINGS,
      legacy: { enabled: true, hashtagBasic: "flash" },
    });
    expect(custom.detect("q #flash")).toHaveLength(1);
    expect(custom.detect("q #card")).toEqual([]);
  });
});
