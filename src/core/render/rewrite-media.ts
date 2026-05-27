import { extractMedia, type MediaKind } from "./extract-media.js";

export interface MediaRewriteMap {
  [originalName: string]: { kind: MediaKind; finalName: string };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function rewriteMedia(
  markdown: string,
  map: MediaRewriteMap,
): string {
  const refs = extractMedia(markdown);
  if (refs.length === 0) return markdown;
  let out = "";
  let cursor = 0;
  for (const ref of refs) {
    const entry = map[ref.filename];
    if (!entry) continue;
    out += markdown.slice(cursor, ref.start);
    if (entry.kind === "audio") {
      out += `[sound:${entry.finalName}]`;
    } else {
      let attrs = "";
      if (ref.width !== undefined) attrs += ` width='${ref.width}'`;
      if (ref.alt !== undefined) attrs += ` alt='${escapeHtml(ref.alt)}'`;
      out += `<img src='${entry.finalName}'${attrs}>`;
    }
    cursor = ref.end;
  }
  out += markdown.slice(cursor);
  return out;
}
