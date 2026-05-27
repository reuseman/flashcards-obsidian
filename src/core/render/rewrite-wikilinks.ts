export interface RewriteWikilinksContext {
  vaultName: string;
  sourcePath: string;
  resolveLink: (target: string, sourcePath: string) => string | null;
}

interface ExcludedRange {
  start: number;
  end: number;
}

function findExcludedRanges(md: string): ExcludedRange[] {
  const ranges: ExcludedRange[] = [];
  let i = 0;
  const n = md.length;
  while (i < n) {
    // Fenced code block at line start
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

export function rewriteWikilinks(
  markdown: string,
  ctx: RewriteWikilinksContext,
): string {
  const excluded = findExcludedRanges(markdown);
  const vault = encodeURIComponent(ctx.vaultName);
  let out = "";
  let i = 0;
  const n = markdown.length;
  while (i < n) {
    if (markdown.startsWith("[[", i)) {
      if (isExcluded(i, excluded) || (i > 0 && markdown[i - 1] === "!")) {
        out += "[[";
        i += 2;
        continue;
      }
      const close = markdown.indexOf("]]", i + 2);
      if (close === -1) {
        out += markdown.slice(i);
        i = n;
        break;
      }
      const inner = markdown.slice(i + 2, close);
      if (inner.length === 0) {
        out += "[[]]";
        i = close + 2;
        continue;
      }
      const pipeIdx = inner.indexOf("|");
      let targetPart: string;
      let alias: string | null;
      if (pipeIdx === -1) {
        targetPart = inner;
        alias = null;
      } else {
        targetPart = inner.slice(0, pipeIdx);
        alias = inner.slice(pipeIdx + 1);
      }
      const hashIdx = targetPart.indexOf("#");
      let target: string;
      let fragment: string | null;
      if (hashIdx === -1) {
        target = targetPart;
        fragment = null;
      } else {
        target = targetPart.slice(0, hashIdx);
        fragment = targetPart.slice(hashIdx + 1);
      }
      const resolved = ctx.resolveLink(target, ctx.sourcePath);
      if (resolved === null) {
        out += markdown.slice(i, close + 2);
        i = close + 2;
        continue;
      }
      const anchor =
        alias !== null ? alias : fragment !== null ? targetPart : target;
      const file = encodeURIComponent(resolved);
      const frag =
        fragment !== null ? `#${encodeURIComponent(fragment)}` : "";
      out += `[${anchor}](obsidian://open?vault=${vault}&file=${file}${frag})`;
      i = close + 2;
      continue;
    }
    out += markdown[i];
    i += 1;
  }
  return out;
}
