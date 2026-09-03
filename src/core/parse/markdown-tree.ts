import type { Nodes, Parent, Root } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { mathFromMarkdown } from "mdast-util-math";
import { frontmatter } from "micromark-extension-frontmatter";
import { math } from "micromark-extension-math";

import type { SourceSpan } from "./cloze-syntax.js";

export function parseMarkdownTree(markdown: string): Root {
  return fromMarkdown(markdown, {
    extensions: [frontmatter(["yaml"]), math()],
    mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()],
  });
}

export function collectProtectedMarkdownSpans(
  node: Nodes,
  contentStart = 0,
): SourceSpan[] {
  const spans: SourceSpan[] = [];

  const walk = (current: Nodes): void => {
    if (
      current.type === "inlineCode" ||
      current.type === "code" ||
      current.type === "inlineMath" ||
      current.type === "math"
    ) {
      const start = current.position?.start.offset;
      const end = current.position?.end.offset;
      if (typeof start === "number" && typeof end === "number") {
        spans.push({ start: start - contentStart, end: end - contentStart });
      }
      return;
    }

    if ("children" in current) {
      for (const child of (current as Parent).children as Nodes[]) walk(child);
    }
  };

  walk(node);
  return spans;
}
