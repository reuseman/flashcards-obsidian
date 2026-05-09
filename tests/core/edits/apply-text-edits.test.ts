import { applyTextEdits } from "../../../src/core/edits/apply-text-edits.js";

describe("applyTextEdits", () => {
  test("applies multiple edits from right to left", () => {
    const result = applyTextEdits("abcdef", [
      { end: 2, start: 1, text: "X" },
      { end: 5, start: 4, text: "Y" },
    ]);

    expect(result).toBe("aXcdYf");
  });

  test("throws on invalid ranges", () => {
    expect(() =>
      applyTextEdits("abc", [{ end: 1, start: 2, text: "x" }]),
    ).toThrow("Invalid edit range");
  });
});
