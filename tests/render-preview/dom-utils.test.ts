import { describe, expect, test } from "vitest";
import {
  matchElementKey,
  mergeMatches,
} from "../../src/render-preview/dom-utils.js";
import type { Match } from "../../src/render-preview/feature.js";

describe("matchElementKey", () => {
  test("equal specs produce equal keys", () => {
    expect(matchElementKey({ cls: "a", text: "x", data: { c: "1" } })).toBe(
      matchElementKey({ cls: "a", text: "x", data: { c: "1" } }),
    );
  });

  test("differing text produces differing keys", () => {
    expect(matchElementKey({ cls: "a", text: "x" })).not.toBe(
      matchElementKey({ cls: "a", text: "y" })
    );
  });

  test("differing title produces differing keys", () => {
    expect(matchElementKey({ cls: "a", text: "x", title: "t" })).not.toBe(
      matchElementKey({ cls: "a", text: "x" }),
    );
  });
});

describe("mergeMatches", () => {
  const m = (start: number, end: number, cls: string): Match => ({
    start,
    end,
    el: { cls, text: cls },
  });

  test("returns empty for empty input", () => {
    expect(mergeMatches([])).toEqual([]);
  });

  test("returns single feature's matches sorted", () => {
    expect(mergeMatches([[m(5, 10, "b"), m(0, 3, "a")]])).toEqual([
      m(0, 3, "a"),
      m(5, 10, "b"),
    ]);
  });

  test("first-feature-wins on overlap", () => {
    const a = [m(0, 5, "A")];
    const b = [m(3, 8, "B")];
    expect(mergeMatches([a, b])).toEqual([m(0, 5, "A")]);
  });

  test("first-feature-wins even when B starts before A in source order", () => {
    const a = [m(5, 10, "A")];
    const b = [m(0, 7, "B")];
    expect(mergeMatches([a, b])).toEqual([m(5, 10, "A")]);
  });

  test("non-overlapping interleaved matches are preserved", () => {
    expect(mergeMatches([[m(0, 2, "A")], [m(5, 7, "B")]])).toEqual([
      m(0, 2, "A"),
      m(5, 7, "B"),
    ]);
  });
});
