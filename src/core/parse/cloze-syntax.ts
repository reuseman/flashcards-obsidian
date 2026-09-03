export interface SourceSpan {
  end: number;
  start: number;
}

export type ClozeKind = "auto" | "native" | "numbered";

export interface ClozeSpan extends SourceSpan {
  bodyEnd: number;
  bodyStart: number;
  kind: ClozeKind;
  number?: number;
}

export interface ClozeSyntaxError {
  kind: ClozeKind;
  message: string;
  start: number;
}

export interface ClozeSyntaxResult {
  errors: ClozeSyntaxError[];
  spans: ClozeSpan[];
}

export interface ClozeSyntaxOptions {
  /** Parse `==text==` as automatic cloze syntax. Default: true. */
  auto?: boolean;
}

function isEscaped(source: string, index: number): boolean {
  let slashes = 0;
  for (let i = index - 1; i >= 0 && source[i] === "\\"; i--) slashes++;
  return slashes % 2 === 1;
}

function protectedAt(index: number, spans: SourceSpan[]): SourceSpan | undefined {
  return spans.find((span) => index >= span.start && index < span.end);
}

function findAutoClose(
  source: string,
  from: number,
  protectedSpans: SourceSpan[],
): number {
  let i = from;
  while (i < source.length) {
    const protectedSpan = protectedAt(i, protectedSpans);
    if (protectedSpan) {
      i = protectedSpan.end;
      continue;
    }
    if (source[i] === "\n") return -1;
    if (source.startsWith("==", i) && !isEscaped(source, i)) return i;
    i++;
  }
  return -1;
}

function findNumberedClose(
  source: string,
  from: number,
  protectedSpans: SourceSpan[],
): number {
  let depth = 1;
  let i = from;
  while (i < source.length) {
    const protectedSpan = protectedAt(i, protectedSpans);
    if (protectedSpan) {
      i = protectedSpan.end;
      continue;
    }
    if (source[i] === "\n") return -1;
    if (source[i] === "{" && !isEscaped(source, i)) depth++;
    if (source[i] === "}" && !isEscaped(source, i)) {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

function findNativeClose(
  source: string,
  from: number,
  protectedSpans: SourceSpan[],
): number {
  let depth = 1;
  let i = from;
  while (i < source.length - 1) {
    const protectedSpan = protectedAt(i, protectedSpans);
    if (protectedSpan) {
      i = protectedSpan.end;
      continue;
    }
    if (source[i] === "\n") return -1;
    if (source.startsWith("{{", i) && !isEscaped(source, i)) {
      depth++;
      i += 2;
      continue;
    }
    if (source.startsWith("}}", i) && !isEscaped(source, i)) {
      depth--;
      if (depth === 0) return i;
      i += 2;
      continue;
    }
    i++;
  }
  return -1;
}

export function parseClozeSyntax(
  source: string,
  protectedSpans: SourceSpan[] = [],
  options: ClozeSyntaxOptions = {},
): ClozeSyntaxResult {
  const protectedRanges = [...protectedSpans].sort((a, b) => a.start - b.start);
  const spans: ClozeSpan[] = [];
  const errors: ClozeSyntaxError[] = [];
  let i = 0;

  while (i < source.length) {
    const protectedSpan = protectedAt(i, protectedRanges);
    if (protectedSpan) {
      i = protectedSpan.end;
      continue;
    }

    if (!isEscaped(source, i)) {
      const native = /^\{\{c(\d+)::/.exec(source.slice(i));
      if (native) {
        const bodyStart = i + native[0].length;
        const close = findNativeClose(source, bodyStart, protectedRanges);
        if (close < 0) {
          errors.push({
            kind: "native",
            message: "native cloze is missing `}}`",
            start: i,
          });
          i = bodyStart;
          continue;
        }
        spans.push({
          bodyEnd: close,
          bodyStart,
          end: close + 2,
          kind: "native",
          number: Number(native[1]),
          start: i,
        });
        i = close + 2;
        continue;
      }

      const numbered = /^\{(\d+):/.exec(source.slice(i));
      if (numbered) {
        const bodyStart = i + numbered[0].length;
        const close = findNumberedClose(source, bodyStart, protectedRanges);
        if (close < 0) {
          errors.push({
            kind: "numbered",
            message: "numbered cloze is missing `}`",
            start: i,
          });
          i = bodyStart;
          continue;
        }
        spans.push({
          bodyEnd: close,
          bodyStart,
          end: close + 1,
          kind: "numbered",
          number: Number(numbered[1]),
          start: i,
        });
        i = close + 1;
        continue;
      }

      if (options.auto !== false && source.startsWith("==", i)) {
        const bodyStart = i + 2;
        const close = findAutoClose(source, bodyStart, protectedRanges);
        if (close < 0) {
          errors.push({
            kind: "auto",
            message: "automatic cloze is missing `==`",
            start: i,
          });
          i = bodyStart;
          continue;
        }
        spans.push({
          bodyEnd: close,
          bodyStart,
          end: close + 2,
          kind: "auto",
          start: i,
        });
        i = close + 2;
        continue;
      }
    }

    i++;
  }

  return { errors, spans };
}

export function renderClozeForAnki(
  source: string,
  protectedSpans: SourceSpan[] = [],
  options: ClozeSyntaxOptions = {},
): string {
  const { spans } = parseClozeSyntax(source, protectedSpans, options);
  let output = "";
  let cursor = 0;
  let autoNumber = 1;

  for (const span of spans) {
    output += source.slice(cursor, span.start);
    if (span.kind === "native") {
      output += source.slice(span.start, span.end);
    } else {
      const number = span.kind === "auto" ? autoNumber++ : span.number;
      output += `{{c${number}::${source.slice(span.bodyStart, span.bodyEnd)}}}`;
    }
    cursor = span.end;
  }

  return output + source.slice(cursor);
}
