import { describe, expect, test } from "vitest";
import {
  collectClozeSpans,
  intersectsSpan,
} from "../../../src/core/parse/cloze-spans.js";

describe("collectClozeSpans", () => {
  test("empty input", () => {
    expect(collectClozeSpans("")).toEqual([]);
  });

  test("==highlight==", () => {
    expect(collectClozeSpans("a ==b== c")).toEqual([{ start: 2, end: 7 }]);
  });

  test("{{cN::body}}", () => {
    const spans = collectClozeSpans("{{c1::x}}");
    expect(spans.some((s) => s.start === 0 && s.end === 9)).toBe(true);
  });

  test("{N:body}", () => {
    expect(collectClozeSpans("{2:x}")).toEqual([{ start: 0, end: 5 }]);
  });

  test("multiple kinds in one line", () => {
    const out = collectClozeSpans("a ==b== {1:c} {{c2::d}}");
    expect(out.length).toBeGreaterThanOrEqual(3);
  });
});

describe("intersectsSpan", () => {
  test("non-overlapping ranges", () => {
    expect(intersectsSpan(10, 12, [{ start: 0, end: 5 }])).toBe(false);
  });

  test("touching ranges (boundary) do not intersect", () => {
    expect(intersectsSpan(5, 10, [{ start: 0, end: 5 }])).toBe(false);
  });

  test("partial overlap", () => {
    expect(intersectsSpan(3, 7, [{ start: 0, end: 5 }])).toBe(true);
  });

  test("full containment", () => {
    expect(intersectsSpan(2, 4, [{ start: 0, end: 10 }])).toBe(true);
  });
});
