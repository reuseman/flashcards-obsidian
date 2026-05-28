import { describe, expect, test } from "vitest";
import { cloze } from "../../../src/render-preview/features/cloze.js";

describe("cloze feature", () => {
  test("id and scope", () => {
    expect(cloze.id).toBe("cloze");
    expect(cloze.scope).toBe("text");
  });

  test("no matches in plain text", () => {
    expect(cloze.detect("nothing here")).toEqual([]);
  });

  test("matches double-brace Anki form", () => {
    const out = cloze.detect("The {{c1::powerhouse}} of the cell.");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ start: 4, end: 22 });
    expect(out[0]!.html).toBe(
      `<span class="ff-cloze" data-c="1">powerhouse</span>`,
    );
  });

  test("matches single-brace short form", () => {
    const out = cloze.detect("Hello {1:world} here");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ start: 6, end: 15 });
    expect(out[0]!.html).toBe(
      `<span class="ff-cloze" data-c="1">world</span>`,
    );
  });

  test("does NOT match ==highlight==", () => {
    expect(cloze.detect("Some ==highlight== text")).toEqual([]);
  });

  test("multiple matches in source order", () => {
    const out = cloze.detect("{{c1::a}} and {2:b}");
    expect(out).toHaveLength(2);
    expect(out[0]!.start).toBe(0);
    expect(out[1]!.start).toBeGreaterThan(out[0]!.end);
  });

  test("escapes HTML in body", () => {
    const out = cloze.detect("{{c1::a<b>c}}");
    expect(out[0]!.html).toContain("a&lt;b&gt;c");
    expect(out[0]!.html).not.toContain("<b>");
  });

  test("non-overlapping matches sorted by start", () => {
    const out = cloze.detect("{2:b} {{c1::a}}");
    expect(out.map((m) => m.start)).toEqual(
      [...out.map((m) => m.start)].sort((a, b) => a - b),
    );
  });
});
