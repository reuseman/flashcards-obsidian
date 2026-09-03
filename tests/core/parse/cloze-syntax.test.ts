import { describe, expect, it } from "vitest";

import {
  parseClozeSyntax,
  renderClozeForAnki,
} from "../../../src/core/parse/cloze-syntax.js";

describe("strict cloze syntax", () => {
  it("finds a cloze beginning at an odd source offset", () => {
    const parsed = parseClozeSyntax("x==answer==");

    expect(parsed.spans).toHaveLength(1);
    expect(parsed.spans[0]).toMatchObject({
      bodyStart: 3,
      kind: "auto",
      start: 1,
    });
  });

  it("recognizes only the three supported forms", () => {
    const source = "==auto== {2:explicit} {{c3::native}} {plain}";
    const parsed = parseClozeSyntax(source);

    expect(parsed.errors).toEqual([]);
    expect(parsed.spans.map((span) => span.kind)).toEqual([
      "auto",
      "numbered",
      "native",
    ]);
  });

  it("balances braces inside a numbered cloze", () => {
    expect(renderClozeForAnki("Value {2:x^{2} + {y}}.")).toBe(
      "Value {{c2::x^{2} + {y}}}.",
    );
  });

  it("does not parse delimiters inside protected code or math", () => {
    const source = "`{1:code}` $x^{2}$ and {1:$y^{2}$}";
    const codeEnd = source.indexOf("`", 1) + 1;
    const mathStart = source.indexOf("$");
    const mathEnd = source.indexOf("$", mathStart + 1) + 1;
    const parsed = parseClozeSyntax(source, [
      { start: 0, end: codeEnd },
      { start: mathStart, end: mathEnd },
    ]);

    expect(parsed.spans).toHaveLength(1);
    expect(source.slice(parsed.spans[0]?.start, parsed.spans[0]?.end)).toBe(
      "{1:$y^{2}$}",
    );
  });

  it("respects escaped delimiters", () => {
    const parsed = parseClozeSyntax(String.raw`\==text== \{1:text} ==real==`);
    expect(parsed.spans).toHaveLength(1);
    expect(parsed.spans[0]?.kind).toBe("auto");
  });

  it("reports a recognized opener without a closing delimiter", () => {
    const parsed = parseClozeSyntax("The {1:answer is missing.");
    expect(parsed.spans).toEqual([]);
    expect(parsed.errors).toEqual([
      expect.objectContaining({ start: 4, kind: "numbered" }),
    ]);
  });
});
