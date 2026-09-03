import type { MarkdownNote } from "./ports.js";
import {
  detectSyntaxMigrations,
  type SyntaxMigrationDiagnostic,
} from "../core/parse/detect-syntax-migrations.js";

export interface SyntaxMigrationReportItem extends SyntaxMigrationDiagnostic {
  notePath: string;
}

export function buildSyntaxMigrationReport(
  notes: MarkdownNote[],
): SyntaxMigrationReportItem[] {
  return notes.flatMap((note) =>
    detectSyntaxMigrations(note.markdown).map((diagnostic) => ({
      ...diagnostic,
      notePath: note.path,
    })),
  );
}
