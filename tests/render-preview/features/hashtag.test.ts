import { describe, expect, test } from "vitest";
import { DEFAULT_SETTINGS } from "../../../src/core/config/settings.js";
import { createHashtag } from "../../../src/render-preview/features/hashtag.js";

const feat = createHashtag(DEFAULT_SETTINGS);

describe("hashtag feature", () => {
  test("id and scope", () => {
    expect(feat.id).toBe("hashtag");
    expect(feat.scope).toBe("text");
  });

  test("matches `#card`", () => {
    const out = feat.detect("Question text #card");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ start: 14, end: 19 });
    expect(out[0]!.html).toBe(
      `<span class="ff-hashtag-tag" title="Hashtag (#card) syntax">#card</span>`,
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

  test("disabled when settings.hashtag.enabled is false", () => {
    const off = createHashtag({
      ...DEFAULT_SETTINGS,
      hashtag: { enabled: false, basicTag: "card" },
    });
    expect(off.detect("x #card y")).toEqual([]);
  });

  test("respects custom basicTag", () => {
    const custom = createHashtag({
      ...DEFAULT_SETTINGS,
      hashtag: { enabled: true, basicTag: "flash" },
    });
    expect(custom.detect("q #flash")).toHaveLength(1);
    expect(custom.detect("q #card")).toEqual([]);
  });
});
