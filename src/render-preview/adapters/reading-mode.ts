import { mergeMatches } from "../dom-utils.js";
import type { Feature, Match } from "../feature.js";

/**
 * Apply text-scope features to all text nodes under `root`, in-place.
 * Skips text inside <code> and <pre> elements.
 * Block-scope features are not implemented in phase 1.
 */
export function applyReadingMode(root: HTMLElement, features: Feature[]): void {
  if (features.length === 0) return;
  const textFeatures = features.filter((f) => f.scope === "text");
  if (textFeatures.length === 0) return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      let p: Node | null = node.parentNode;
      while (p && p !== root) {
        if (p instanceof Element) {
          const tag = p.tagName;
          if (tag === "CODE" || tag === "PRE") return NodeFilter.FILTER_REJECT;
        }
        p = p.parentNode;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    nodes.push(n as Text);
  }

  for (const node of nodes) {
    processTextNode(node, textFeatures);
  }
}

function processTextNode(node: Text, features: Feature[]): void {
  const source = node.nodeValue ?? "";
  const perFeature: Match[][] = features.map((f) => f.detect(source));
  const merged = mergeMatches(perFeature);
  if (merged.length === 0) return;

  const frag = document.createDocumentFragment();
  let cursor = 0;
  for (const m of merged) {
    if (m.start > cursor) {
      frag.appendChild(document.createTextNode(source.slice(cursor, m.start)));
    }
    const tpl = document.createElement("template");
    tpl.innerHTML = m.html;
    frag.appendChild(tpl.content);
    cursor = m.end;
  }
  if (cursor < source.length) {
    frag.appendChild(document.createTextNode(source.slice(cursor)));
  }
  node.parentNode?.replaceChild(frag, node);
}
