import { describe, expect, test } from "vitest";
import { anchor } from "../../../src/render-preview/features/anchor.js";

describe("anchor feature", () => {
  test("id and scope", () => {
    expect(anchor.id).toBe("anchor");
    expect(anchor.scope).toBe("text");
  });

  test("matches V2 anchor `^q-abcd`", () => {
    const out = anchor.detect("Question:: Answer ^q-abcd");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ start: 18, end: 25 });
    expect(out[0]!.html).toBe(`<span class="ff-anchor" title="^q-abcd">·</span>`);
  });

  test("matches V1 13-digit anchor", () => {
    const out = anchor.detect("Question:: Answer ^1234567890123");
    expect(out).toHaveLength(1);
    expect(out[0]!.html).toBe(
      `<span class="ff-anchor" title="^1234567890123">·</span>`,
    );
  });

  test("does NOT match `^q-` with wrong-length suffix", () => {
    expect(anchor.detect("text ^q-abc")).toEqual([]);
    expect(anchor.detect("text ^q-abcde")).toEqual([]);
  });

  test("does NOT match `^q-` with disallowed alphabet chars", () => {
    expect(anchor.detect("text ^q-ABCD")).toEqual([]);
    expect(anchor.detect("text ^q-aoli")).toEqual([]);
  });

  test("does NOT match V1-like with wrong digit count", () => {
    expect(anchor.detect("text ^123")).toEqual([]);
    expect(anchor.detect("text ^12345678901234")).toEqual([]);
  });

  test("multiple anchors on one line, sorted by start", () => {
    const out = anchor.detect("a ^q-abcd b ^1234567890123");
    expect(out).toHaveLength(2);
    expect(out[0]!.start).toBeLessThan(out[1]!.start);
  });

  test("no matches in plain text", () => {
    expect(anchor.detect("plain text with ^something")).toEqual([]);
  });
});
