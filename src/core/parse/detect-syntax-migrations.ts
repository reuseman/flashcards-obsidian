import { intersectsSpan } from "./cloze-spans.js";
import { parseClozeSyntax } from "./cloze-syntax.js";
import {
  collectProtectedMarkdownSpans,
  parseMarkdownTree,
} from "./markdown-tree.js";

export type SyntaxMigrationKind =
  | "legacy-curly-cloze"
  | "legacy-hashtag-continuation"
  | "legacy-spaced-card"
  | "malformed-cloze";

export interface SyntaxMigrationDiagnostic {
  column: number;
  kind: SyntaxMigrationKind;
  line: number;
  message: string;
  replacement: string;
  snippet: string;
}

/** Read-only diagnostics for syntax that needs a human migration decision. */
export function detectSyntaxMigrations(
  markdown: string,
): SyntaxMigrationDiagnostic[] {
  const tree = parseMarkdownTree(markdown);
  const diagnostics: SyntaxMigrationDiagnostic[] = [];
  const linkedNote = /^flashcards:\s*$/m.test(markdown) || /\^\d{13}\b/.test(markdown);

  for (const node of tree.children) {
    if (node.type !== "paragraph") continue;
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) continue;

    const source = markdown.slice(start, end);
    const protectedSpans = collectProtectedMarkdownSpans(node, start);

    for (const match of source.matchAll(/#card(?:-|\/)spaced(?![\w/-])/g)) {
      const matchStart = match.index;
      if (
        matchStart === undefined ||
        intersectsSpan(
          matchStart,
          matchStart + match[0].length,
          protectedSpans,
        )
      ) {
        continue;
      }
      diagnostics.push(
        diagnosticAt(
          markdown,
          start + matchStart,
          "legacy-spaced-card",
          `The v1 reminder syntax \`${match[0]}\` is not parsed by v2.`,
          "Replace it with `#card-reminder`. The existing card anchor keeps the link to its Anki note.",
        ),
      );
    }

    if (source.trim() === "^") {
      diagnostics.push(
        diagnosticAt(
          markdown,
          start + source.indexOf("^"),
          "legacy-hashtag-continuation",
          "A bare `^` continuation marker is not part of the v2 hashtag grammar.",
          "Use a tagged heading for a section answer or a fenced flashcard for an exact region, then remove `^`.",
        ),
      );
    }

    for (const error of parseClozeSyntax(source, protectedSpans).errors) {
      diagnostics.push(
        diagnosticAt(
          markdown,
          start + error.start,
          "malformed-cloze",
          `Malformed ${error.kind} cloze: ${error.message}.`,
          error.kind === "auto"
            ? "Close the cloze with `==`, or remove the opening `==`."
            : error.kind === "native"
              ? "Close the native cloze with `}}`, or remove its opener."
              : "Close the numbered cloze with `}`, or remove its opener.",
        ),
      );
    }

    if (!linkedNote) continue;
    collectLegacyCurlyCandidates(
      markdown,
      source,
      start,
      protectedSpans,
      diagnostics,
    );
  }

  return diagnostics.sort(
    (left, right) => left.line - right.line || left.column - right.column,
  );
}

function collectLegacyCurlyCandidates(
  markdown: string,
  source: string,
  sourceStart: number,
  protectedSpans: Array<{ end: number; start: number }>,
  diagnostics: SyntaxMigrationDiagnostic[],
): void {
  const candidates = /\{([^{}\n:]+)\}/g;
  for (const match of source.matchAll(candidates)) {
    const start = match.index;
    if (start === undefined || intersectsSpan(start, start + match[0].length, protectedSpans)) {
      continue;
    }
    const body = match[1]!.trim();
    if (body.length === 0) continue;
    diagnostics.push(
      diagnosticAt(
        markdown,
        sourceStart + start,
        "legacy-curly-cloze",
        `Possible v1 unnumbered cloze \`${match[0]}\`. Plain braces are ordinary text in v2.`,
        `If this is a cloze, change it to \`==${body}==\` or \`{1:${body}}\`. Otherwise, leave it unchanged.`,
      ),
    );
  }
}

function diagnosticAt(
  markdown: string,
  offset: number,
  kind: SyntaxMigrationKind,
  message: string,
  replacement: string,
): SyntaxMigrationDiagnostic {
  const before = markdown.slice(0, offset);
  const line = before.split("\n").length;
  const lineStart = before.lastIndexOf("\n") + 1;
  const lineEnd = markdown.indexOf("\n", offset);
  return {
    column: offset - lineStart + 1,
    kind,
    line,
    message,
    replacement,
    snippet: markdown.slice(lineStart, lineEnd < 0 ? markdown.length : lineEnd),
  };
}
