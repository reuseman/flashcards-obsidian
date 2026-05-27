export type MediaKind = "image" | "audio";

export interface MediaRef {
  kind: MediaKind;
  raw: string;
  filename: string;
  width?: number;
  alt?: string;
  start: number;
  end: number;
}

const IMAGE_EXTS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "bmp",
  "svg",
  "tiff",
  "webp",
  "avif",
]);

const AUDIO_EXTS = new Set([
  "mp3",
  "webm",
  "wav",
  "m4a",
  "ogg",
  "3gp",
  "flac",
]);

interface ExcludedRange {
  start: number;
  end: number;
}

/**
 * Mirrors the exclusion logic in `rewrite-wikilinks.ts`: fenced code blocks,
 * HTML comments, and inline backticks. Kept local so the two render modules
 * stay decoupled.
 */
function findExcludedRanges(md: string): ExcludedRange[] {
  const ranges: ExcludedRange[] = [];
  let i = 0;
  const n = md.length;
  while (i < n) {
    if ((i === 0 || md[i - 1] === "\n") && md.startsWith("```", i)) {
      const fenceEnd = md.indexOf("\n", i);
      const bodyStart = fenceEnd === -1 ? n : fenceEnd + 1;
      const close = md.indexOf("\n```", bodyStart);
      if (close === -1) {
        ranges.push({ start: i, end: n });
        i = n;
      } else {
        const afterClose = close + 4;
        ranges.push({ start: i, end: afterClose });
        i = afterClose;
      }
      continue;
    }
    if (md.startsWith("<!--", i)) {
      const close = md.indexOf("-->", i + 4);
      const end = close === -1 ? n : close + 3;
      ranges.push({ start: i, end });
      i = end;
      continue;
    }
    if (md[i] === "`") {
      const close = md.indexOf("`", i + 1);
      if (close === -1) {
        i += 1;
      } else {
        ranges.push({ start: i, end: close + 1 });
        i = close + 1;
      }
      continue;
    }
    i += 1;
  }
  return ranges;
}

function isExcluded(index: number, ranges: ExcludedRange[]): boolean {
  for (const r of ranges) {
    if (index >= r.start && index < r.end) return true;
  }
  return false;
}

function classify(filename: string): MediaKind | null {
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = filename.slice(dot + 1).toLowerCase();
  if (IMAGE_EXTS.has(ext)) return "image";
  if (AUDIO_EXTS.has(ext)) return "audio";
  return null;
}

function parseWidth(s: string): number | undefined {
  if (!/^\d+$/.test(s)) return undefined;
  const n = Number(s);
  return n > 0 ? n : undefined;
}

export function extractMedia(markdown: string): MediaRef[] {
  const excluded = findExcludedRanges(markdown);
  const refs: MediaRef[] = [];
  const n = markdown.length;
  let i = 0;
  while (i < n) {
    if (markdown[i] !== "!") {
      i += 1;
      continue;
    }
    if (isExcluded(i, excluded)) {
      i += 1;
      continue;
    }
    // Wikilink: ![[...]]
    if (markdown.startsWith("![[", i)) {
      const close = markdown.indexOf("]]", i + 3);
      if (close === -1) {
        i += 1;
        continue;
      }
      const inner = markdown.slice(i + 3, close);
      const pipeIdx = inner.indexOf("|");
      const filename = pipeIdx === -1 ? inner : inner.slice(0, pipeIdx);
      const widthRaw = pipeIdx === -1 ? "" : inner.slice(pipeIdx + 1);
      const kind = classify(filename);
      if (kind) {
        const ref: MediaRef = {
          kind,
          raw: markdown.slice(i, close + 2),
          filename,
          start: i,
          end: close + 2,
        };
        if (kind === "image" && widthRaw) {
          const w = parseWidth(widthRaw);
          if (w !== undefined) ref.width = w;
        }
        refs.push(ref);
        i = close + 2;
        continue;
      }
      i += 1;
      continue;
    }
    // Markdown image: ![alt](file)
    if (markdown.startsWith("![", i)) {
      const altClose = markdown.indexOf("]", i + 2);
      if (altClose === -1 || markdown[altClose + 1] !== "(") {
        i += 1;
        continue;
      }
      const parenClose = markdown.indexOf(")", altClose + 2);
      if (parenClose === -1) {
        i += 1;
        continue;
      }
      const altRaw = markdown.slice(i + 2, altClose);
      const target = markdown.slice(altClose + 2, parenClose);
      // Choice: do not support title attribute (`(file "title")`). Simplest.
      let decoded: string;
      try {
        decoded = decodeURIComponent(target);
      } catch {
        decoded = target;
      }
      const kind = classify(decoded);
      if (kind) {
        const ref: MediaRef = {
          kind,
          raw: markdown.slice(i, parenClose + 1),
          filename: decoded,
          start: i,
          end: parenClose + 1,
        };
        if (kind === "image" && altRaw.length > 0) ref.alt = altRaw;
        refs.push(ref);
        i = parenClose + 1;
        continue;
      }
      i += 1;
      continue;
    }
    i += 1;
  }
  return refs;
}
