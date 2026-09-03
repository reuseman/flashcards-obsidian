import { buildSyntaxMigrationReport } from "../../src/application/build-syntax-migration-report.js";
import type { MarkdownNote } from "../../src/application/ports.js";

function note(path: string, markdown: string): MarkdownNote {
  return { file: {}, markdown, name: path, path };
}

describe("vault syntax migration report", () => {
  test("adds note paths and keeps source order", () => {
    const report = buildSyntaxMigrationReport([
      note("A.md", "Question #card\n\nAnswer\n\n^"),
      note("B.md", "The {1:answer is open."),
    ]);

    expect(report.map((item) => [item.notePath, item.line])).toEqual([
      ["A.md", 5],
      ["B.md", 1],
    ]);
  });
});
