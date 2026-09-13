import { createMatchElement, mergeMatches } from "../dom-utils.js";
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

  const walker = root.ownerDocument.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        let p: Node | null = node.parentNode;
        while (p && p !== root) {
          // `nodeType` rather than `instanceof Element`: in a popout window the
          // node comes from a different realm, where `instanceof` is false for
          // the same kind of element.
          if (p.nodeType === Node.ELEMENT_NODE) {
            const tag = (p as Element).tagName;
            if (tag === "CODE" || tag === "PRE") return NodeFilter.FILTER_REJECT;
          }
          p = p.parentNode;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    },
  );

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

  // Use the node's own document: in a popout window it is not the global
  // `document`, and a node created by the wrong document cannot be inserted.
  const doc = node.ownerDocument;
  const frag = doc.createDocumentFragment();
  let cursor = 0;
  for (const m of merged) {
    if (m.start > cursor) {
      frag.appendChild(doc.createTextNode(source.slice(cursor, m.start)));
    }
    frag.appendChild(createMatchElement(m.el, doc));
    cursor = m.end;
  }
  if (cursor < source.length) {
    frag.appendChild(doc.createTextNode(source.slice(cursor)));
  }
  node.parentNode?.replaceChild(frag, node);
}
