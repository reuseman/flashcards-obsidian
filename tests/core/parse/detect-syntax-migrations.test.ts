import { detectSyntaxMigrations } from "../../../src/core/parse/detect-syntax-migrations.js";

describe("read-only v2 syntax migration diagnostics", () => {
  test("reports an actionable legacy curly candidate in a linked note", () => {
    const markdown = [
      "---",
      "flashcards:",
      "  q-abcd: { nid: 123, hash: abcdefgh }",
      "---",
      "The {heart} pumps blood. ^q-abcd",
    ].join("\n");

    expect(detectSyntaxMigrations(markdown)).toEqual([
      expect.objectContaining({
        column: 5,
        kind: "legacy-curly-cloze",
        line: 5,
        replacement: expect.stringContaining("{1:heart}"),
        snippet: "The {heart} pumps blood. ^q-abcd",
      }),
    ]);
  });

  test("does not report ordinary braces in an unlinked note or protected code and math", () => {
    expect(detectSyntaxMigrations("A set is {a, b}. `\\w{2}` and $x^{2}$."))
      .toEqual([]);
  });

  test("reports a bare continuation marker with the supported alternatives", () => {
    const result = detectSyntaxMigrations("Question #card\n\nAnswer.\n\n^");

    expect(result).toEqual([
      expect.objectContaining({
        kind: "legacy-hashtag-continuation",
        line: 5,
        replacement: expect.stringMatching(/tagged heading.*fenced flashcard/i),
      }),
    ]);
  });

  test.each(["#card-spaced", "#card/spaced"])(
    "reports the v1 reminder marker %s with its v2 replacement",
    (marker) => {
      const result = detectSyntaxMigrations(`Read this again. ${marker}`);

      expect(result).toEqual([
        expect.objectContaining({
          column: 18,
          kind: "legacy-spaced-card",
          line: 1,
          replacement: expect.stringContaining("#card-reminder"),
        }),
      ]);
    },
  );

  test("ignores v1 reminder text inside code", () => {
    expect(detectSyntaxMigrations("`#card-spaced`\n\n```md\n#card-spaced\n```"))
      .toEqual([]);
  });

  test("reports malformed supported cloze syntax at its exact location", () => {
    const result = detectSyntaxMigrations("Prefix\n\nThe {2:answer is open.");

    expect(result).toEqual([
      expect.objectContaining({
        column: 5,
        kind: "malformed-cloze",
        line: 3,
        replacement: expect.stringContaining("Close the numbered cloze"),
      }),
    ]);
  });
});
