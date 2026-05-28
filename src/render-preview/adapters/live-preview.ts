import type {
  EditorView} from "@codemirror/view";
import {
  Decoration,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";

import { mergeMatches } from "../dom-utils.js";
import type { Feature } from "../feature.js";

export interface DecorationRange {
  from: number;
  to: number;
  html: string;
}

class HtmlWidget extends WidgetType {
  constructor(private readonly html: string) {
    super();
  }
  override eq(other: HtmlWidget): boolean {
    return other.html === this.html;
  }
  override toDOM(): HTMLElement {
    const tpl = document.createElement("template");
    tpl.innerHTML = this.html;
    const node = tpl.content.firstElementChild;
    return (node as HTMLElement) ?? document.createElement("span");
  }
  override ignoreEvent(): boolean {
    return false;
  }
}

/**
 * Pure helper: compute decoration ranges for one line of text. Boundary-
 * inclusive intersection (caret immediately after a closing brace still
 * reveals the raw syntax — matches Obsidian's convention).
 */
export function buildDecorationsForText(
  lineText: string,
  lineStart: number,
  selectionRanges: { from: number; to: number }[],
  features: Feature[],
): DecorationRange[] {
  const textFeatures = features.filter((f) => f.scope === "text");
  if (textFeatures.length === 0) return [];

  const perFeature = textFeatures.map((f) => f.detect(lineText));
  const merged = mergeMatches(perFeature);

  const out: DecorationRange[] = [];
  for (const m of merged) {
    const from = lineStart + m.start;
    const to = lineStart + m.end;
    const revealed = selectionRanges.some((s) => s.from <= to && from <= s.to);
    if (revealed) continue;
    out.push({ from, to, html: m.html });
  }
  return out;
}

/**
 * CM6 ViewPlugin that recomputes decorations on doc/viewport/selection
 * changes and emits Decoration.replace widgets for each match.
 */
export function renderPreviewExtension(features: Feature[]) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = this.build(view);
      }
      update(u: ViewUpdate): void {
        if (u.docChanged || u.viewportChanged || u.selectionSet) {
          this.decorations = this.build(u.view);
        }
      }
      private build(view: EditorView): DecorationSet {
        const builder = new RangeSetBuilder<Decoration>();
        const selectionRanges = view.state.selection.ranges.map((r) => ({
          from: r.from,
          to: r.to,
        }));
        for (const { from, to } of view.visibleRanges) {
          let pos = from;
          while (pos <= to) {
            const line = view.state.doc.lineAt(pos);
            const ranges = buildDecorationsForText(
              line.text,
              line.from,
              selectionRanges,
              features,
            );
            for (const r of ranges) {
              builder.add(
                r.from,
                r.to,
                Decoration.replace({ widget: new HtmlWidget(r.html) }),
              );
            }
            pos = line.to + 1;
          }
        }
        return builder.finish();
      }
    },
    {
      decorations: (v) => v.decorations,
    },
  );
}
