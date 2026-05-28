// @vitest-environment jsdom

import { describe, expect, test } from "vitest";
import { DEFAULT_SETTINGS } from "../../../src/core/config/settings.js";
import { applyReadingMode } from "../../../src/render-preview/adapters/reading-mode.js";
import { buildRegistry } from "../../../src/render-preview/registry.js";

function render(html: string, settings = DEFAULT_SETTINGS): string {
  const el = document.createElement("div");
  el.innerHTML = html;
  applyReadingMode(el, buildRegistry(settings));
  return el.innerHTML;
}

describe("reading-mode adapter", () => {
  test("replaces cloze with ff-cloze span", () => {
    const out = render("<p>The {{c1::brain}} thinks.</p>");
    expect(out).toContain(`<span class="ff-cloze" data-c="1">brain</span>`);
    expect(out).not.toContain("{{c1::brain}}");
  });

  test("replaces anchor with ff-anchor span (raw text not visible in DOM body)", () => {
    const el = document.createElement("div");
    el.innerHTML = "<p>Q:: A ^q-abcd</p>";
    applyReadingMode(el, buildRegistry(DEFAULT_SETTINGS));
    expect(el.innerHTML).toContain(`<span class="ff-anchor"`);
    // The raw anchor appears in the title attribute (tooltip) but not in the
    // visible text content of the DOM.
    expect(el.textContent).not.toContain("^q-abcd");
  });

  test("legacy-hashtag rendered when enabled", () => {
    const out = render("<p>note #card</p>");
    expect(out).toContain(`class="ff-legacy-tag"`);
  });

  test("first-feature-wins: cloze containing anchor-shaped text", () => {
    const out = render("<p>{{c1::^q-abcd}} text</p>");
    expect(out).toContain(`<span class="ff-cloze"`);
    expect(out).not.toContain(`class="ff-anchor"`);
  });

  test("untouched when registry is empty (master switch off)", () => {
    const out = render("<p>{{c1::x}} ^q-abcd #card</p>", {
      ...DEFAULT_SETTINGS,
      renderPreview: { ...DEFAULT_SETTINGS.renderPreview, enabled: false },
    });
    expect(out).toBe("<p>{{c1::x}} ^q-abcd #card</p>");
  });

  test("does not descend into code blocks", () => {
    const out = render("<pre><code>{{c1::x}}</code></pre>");
    expect(out).toContain("{{c1::x}}");
    expect(out).not.toContain(`class="ff-cloze"`);
  });
});
