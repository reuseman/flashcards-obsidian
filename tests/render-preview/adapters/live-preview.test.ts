import { describe, expect, test } from "vitest";
import { DEFAULT_SETTINGS } from "../../../src/core/config/settings.js";
import { buildDecorationsForText } from "../../../src/render-preview/adapters/live-preview.js";
import { buildRegistry } from "../../../src/render-preview/registry.js";

const features = buildRegistry(DEFAULT_SETTINGS);

describe("live-preview adapter — buildDecorationsForText", () => {
  test("returns decoration ranges for cloze", () => {
    const ranges = buildDecorationsForText(
      "The {{c1::brain}} thinks.",
      0,
      [],
      features,
    );
    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toMatchObject({ from: 4, to: 17 });
    expect(ranges[0]!.html).toContain("ff-cloze");
  });

  test("offsets are relative to document, not line", () => {
    const ranges = buildDecorationsForText(
      "The {{c1::brain}} thinks.",
      100,
      [],
      features,
    );
    expect(ranges[0]).toMatchObject({ from: 104, to: 117 });
  });

  test("cursor-reveal: skip decoration when selection intersects", () => {
    const ranges = buildDecorationsForText(
      "The {{c1::brain}} thinks.",
      100,
      [{ from: 110, to: 110 }],
      features,
    );
    expect(ranges).toEqual([]);
  });

  test("anchor decoration with no other features active", () => {
    const ranges = buildDecorationsForText("Q:: A ^q-abcd", 0, [], features);
    expect(ranges.map((r) => r.html)).toEqual([
      expect.stringContaining("ff-anchor"),
    ]);
  });

  test("returns empty when no features", () => {
    expect(buildDecorationsForText("anything", 0, [], [])).toEqual([]);
  });
});
