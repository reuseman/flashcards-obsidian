import { describe, expect, it } from "vitest";
import type { IdentifiedFlashcard } from "../../../src/core/domain/card.js";
import {
  ANKI_CONTEXT_TEMPLATE,
  ANKI_MODEL_BASIC,
  ANKI_MODEL_CLOZE,
  ANKI_MODEL_REMINDER,
  ANKI_MODEL_REVERSED,
  getAnkiModelSpecs,
  renderCardForAnki,
} from "../../../src/core/render/render-card.js";

/**
 * Phase 6 slice 6b — card-to-Anki rendering (pure function + model specs).
 *
 * Module under test (impl agent will create):
 *   src/adapters/anki/render-card.ts
 *
 * Locked decisions: see tasks.md Phase 6 slice 6b.
 *
 * Ambiguities locked here:
 *
 *  1. `notePath` URL encoding: use `encodeURIComponent` on the full path.
 *     `/` becomes `%2F`. Obsidian's `obsidian://open` resolves either form.
 *     Single call is simpler and matches v1's behavior; segment-by-segment
 *     encoding adds branching with no observable benefit. Locked below.
 *
 *  2. Fenced code-block HTML shape: remark-rehype output varies slightly
 *     across versions (language class attr ordering, optional newlines).
 *     We assert containment (`<pre>` + `<code>` + the code text) rather
 *     than an exact string. Inline `<code>` is more stable so we assert
 *     exactly `<code>x</code>`.
 *
 *  3. The Source field contains one link with an action and a visible relative
 *     path. The path omits the final `.md` and is escaped as HTML. Locked.
 *
 *  4. Multi-line cloze (cloze body spans `\n`): NOT supported. The regex
 *     must be single-line (`.+?`, not `[\s\S]+?`). Locked with a negative
 *     assertion.
 *
 *  5. Empty cloze content (`==  ==`, `{1: }`) passes through verbatim —
 *     renderer does not validate. Not asserted explicitly (out of scope
 *     for this slice; documented for the impl agent).
 */

function baseCard(overrides: Partial<IdentifiedFlashcard> = {}): IdentifiedFlashcard {
  return {
    answer: "A",
    blockId: "q-7f3a",
    front: "Q",
    kind: "basic",
    source: { endOffset: 0, line: 1, startOffset: 0, syntax: "inline" },
    tags: [],
    ...overrides,
  };
}

const CTX = {
  deckName: "Default",
  notePath: "Note.md",
  tags: [],
  vaultName: "MyVault",
};

// ============================================================================
// A. getAnkiModelSpecs
// ============================================================================

describe("getAnkiModelSpecs", () => {
  it("returns exactly 4 model specs", () => {
    expect(getAnkiModelSpecs()).toHaveLength(4);
  });

  it("wraps long code in the default CSS for every new managed model", () => {
    for (const spec of getAnkiModelSpecs()) {
      expect(spec.css).toContain("white-space: pre-wrap");
      expect(spec.css).toContain("overflow-wrap: anywhere");
    }
  });

  it("styles the Source action and path for every new managed model", () => {
    for (const spec of getAnkiModelSpecs()) {
      expect(spec.css).toContain(".flashcards-source-action");
      expect(spec.css).toContain(".flashcards-source-path");
    }
  });

  it("styles prompt context separately from question and answer content", () => {
    for (const spec of getAnkiModelSpecs()) {
      expect(spec.css).toContain(".flashcards-context");
    }
  });

  it("model names match the exported constants", () => {
    const names = getAnkiModelSpecs().map((s) => s.modelName);
    expect(names).toEqual(
      expect.arrayContaining([
        ANKI_MODEL_BASIC,
        ANKI_MODEL_REVERSED,
        ANKI_MODEL_CLOZE,
        ANKI_MODEL_REMINDER,
      ]),
    );
    expect(ANKI_MODEL_BASIC).toBe("Obsidian-basic");
    expect(ANKI_MODEL_REVERSED).toBe("Obsidian-basic-reversed");
    expect(ANKI_MODEL_CLOZE).toBe("Obsidian-cloze");
    expect(ANKI_MODEL_REMINDER).toBe("Obsidian-reminder");
  });

  it("Obsidian-Basic: includes a separate Context field", () => {
    const spec = getAnkiModelSpecs().find(
      (s) => s.modelName === ANKI_MODEL_BASIC,
    )!;
    expect(spec.inOrderFields).toEqual(["Front", "Back", "Context", "Source"]);
    expect(spec.isCloze).toBe(false);
    expect(spec.cardTemplates).toHaveLength(1);
    expect(spec.cardTemplates[0]!.Front).toBe(
      `${ANKI_CONTEXT_TEMPLATE}<section class="flashcards-question">{{Front}}</section>`,
    );
    expect(spec.cardTemplates[0]!.Back).toBe(
      '{{FrontSide}}<hr id="answer" class="flashcards-answer-divider"><section class="flashcards-answer">{{Back}}</section><footer class="flashcards-source-footer">{{Source}}</footer>',
    );
  });

  it("Obsidian-Reversed: both question directions render Context", () => {
    const spec = getAnkiModelSpecs().find(
      (s) => s.modelName === ANKI_MODEL_REVERSED,
    )!;
    expect(spec.inOrderFields).toEqual(["Front", "Back", "Context", "Source"]);
    expect(spec.isCloze).toBe(false);
    expect(spec.cardTemplates).toHaveLength(2);
    expect(spec.cardTemplates[0]!.Front).toBe(
      `${ANKI_CONTEXT_TEMPLATE}<section class="flashcards-question">{{Front}}</section>`,
    );
    expect(spec.cardTemplates[0]!.Back).toBe(
      '{{FrontSide}}<hr id="answer" class="flashcards-answer-divider"><section class="flashcards-answer">{{Back}}</section><footer class="flashcards-source-footer">{{Source}}</footer>',
    );
    expect(spec.cardTemplates[1]!.Front).toBe(
      `${ANKI_CONTEXT_TEMPLATE}<section class="flashcards-question">{{Back}}</section>`,
    );
    expect(spec.cardTemplates[1]!.Back).toBe(
      '{{FrontSide}}<hr id="answer" class="flashcards-answer-divider"><section class="flashcards-answer">{{Front}}</section><footer class="flashcards-source-footer">{{Source}}</footer>',
    );
  });

  it("Obsidian-Cloze: renders Context on its question and answer templates", () => {
    const spec = getAnkiModelSpecs().find(
      (s) => s.modelName === ANKI_MODEL_CLOZE,
    )!;
    expect(spec.inOrderFields).toEqual(["Text", "Extra", "Context", "Source"]);
    expect(spec.isCloze).toBe(true);
    expect(spec.cardTemplates).toHaveLength(1);
    expect(spec.cardTemplates[0]!.Front).toBe(
      `${ANKI_CONTEXT_TEMPLATE}<section class="flashcards-question">{{cloze:Text}}</section>`,
    );
    expect(spec.cardTemplates[0]!.Back).toBe(
      `${ANKI_CONTEXT_TEMPLATE}<section class="flashcards-question">{{cloze:Text}}</section>{{#Extra}}<hr id="answer" class="flashcards-answer-divider"><section class="flashcards-answer">{{Extra}}</section>{{/Extra}}<footer class="flashcards-source-footer">{{Source}}</footer>`,
    );
  });

  it("Obsidian-Reminder: stores one Content field and asks only about timing", () => {
    const spec = getAnkiModelSpecs().find(
      (candidate) => candidate.modelName === ANKI_MODEL_REMINDER,
    )!;

    expect(spec.inOrderFields).toEqual(["Content", "Context", "Source"]);
    expect(spec.isCloze).toBe(false);
    expect(spec.cardTemplates).toHaveLength(1);
    expect(spec.cardTemplates[0]!.Front).toBe(
      `${ANKI_CONTEXT_TEMPLATE}<section class="flashcards-reminder">{{Content}}</section>`,
    );
    expect(spec.cardTemplates[0]!.Back).toContain("{{FrontSide}}");
    expect(spec.cardTemplates[0]!.Back).toContain(
      "How soon should this come back?",
    );
    expect(spec.cardTemplates[0]!.Back).toContain("{{Source}}");
  });

  it("`{{Source}}` token appears only on Back side, never on Front, across all templates", () => {
    for (const spec of getAnkiModelSpecs()) {
      for (const tpl of spec.cardTemplates) {
        expect(tpl.Front.includes("{{Source}}")).toBe(false);
        expect(tpl.Back.includes("{{Source}}")).toBe(true);
      }
    }
  });

  it("renders Context directly on every question side without adding it to basic/reversed answer content", () => {
    for (const spec of getAnkiModelSpecs()) {
      for (const tpl of spec.cardTemplates) {
        expect(tpl.Front).toContain(ANKI_CONTEXT_TEMPLATE);
        if (spec.modelName === ANKI_MODEL_CLOZE) {
          expect(tpl.Back).toContain(ANKI_CONTEXT_TEMPLATE);
        } else {
          expect(tpl.Back).not.toContain("{{Context}}");
          expect(tpl.Back).toContain("{{FrontSide}}");
        }
      }
    }
  });

  it("CSS is identical across all specs", () => {
    const specs = getAnkiModelSpecs();
    const cssValues = specs.map((s) => s.css);
    expect(cssValues[0]).toBeDefined();
    expect(cssValues[1]).toBe(cssValues[0]);
    expect(cssValues[2]).toBe(cssValues[0]);
    expect(cssValues[3]).toBe(cssValues[0]);
  });
});

describe("renderCardForAnki — reminder", () => {
  it("renders content, context, and source without an answer field", () => {
    const out = renderCardForAnki(
      baseCard({
        answer: "",
        context: "Engineering principles",
        front: "Keep the feedback loop short.",
        kind: "reminder",
      }),
      CTX,
    );

    expect(out.modelName).toBe(ANKI_MODEL_REMINDER);
    expect(out.fields).toEqual({
      Content: "<p>Keep the feedback loop short.</p>",
      Context: "<p>Engineering principles</p>",
      Source: expect.stringContaining("Edit source in Obsidian"),
    });
  });
});

// ============================================================================
// B. Source URL / link HTML
// ============================================================================

describe("renderCardForAnki — Source URL & link HTML", () => {
  it("URL-encodes a vault name with spaces", () => {
    const out = renderCardForAnki(baseCard(), {
      ...CTX,
      vaultName: "My Vault",
    });
    expect(out.fields.Source).toContain("vault=My%20Vault");
  });

  it("URL-encodes nested notePath with `encodeURIComponent` (slash → %2F)", () => {
    // Locked: full encodeURIComponent on the path. `/` is encoded as `%2F`.
    // Obsidian resolves both `Biology/Cell biology.md` and the percent-encoded
    // form; we pick the single-call encoding for simplicity. Test pins it.
    const out = renderCardForAnki(baseCard(), {
      ...CTX,
      notePath: "Biology/Cell biology.md",
    });
    expect(out.fields.Source).toContain(
      "file=Biology%2FCell%20biology.md",
    );
  });

  it("appends `#^<blockId>` fragment for v2 blockIds (`q-7f3a`)", () => {
    const out = renderCardForAnki(baseCard({ blockId: "q-7f3a" }), CTX);
    expect(out.fields.Source).toContain("#%5Eq-7f3a");
    // NOTE: `#` itself is not encoded by encodeURIComponent when we build the
    // URL with template literals, but `^` IS encoded → `%5E`. If impl chooses
    // to leave `^` literal, this assertion will fail and we'll re-lock; the
    // intent is "use encodeURIComponent on the fragment too" for consistency.
  });

  it("appends `#^<blockId>` fragment for v1 13-digit blockIds", () => {
    const out = renderCardForAnki(
      baseCard({ blockId: "1714123456789" }),
      CTX,
    );
    expect(out.fields.Source).toContain("#%5E1714123456789");
  });

  it("shows the action and relative note path without the `.md` extension", () => {
    const out = renderCardForAnki(baseCard({ blockId: "q-abcd" }), {
      ...CTX,
      notePath: "scenarios/auto-fixes/08-accepted-features.md",
      vaultName: "V",
    });
    expect(out.fields.Source).toBe(
      '<a class="flashcards-source" href="obsidian://open?vault=V&file=scenarios%2Fauto-fixes%2F08-accepted-features.md#%5Eq-abcd"><span class="flashcards-source-action">Edit source in Obsidian ↗</span><br><small class="flashcards-source-path">scenarios/auto-fixes/08-accepted-features</small></a>',
    );
  });

  it("escapes the visible note path without changing its encoded target", () => {
    const out = renderCardForAnki(baseCard({ blockId: "q-abcd" }), {
      ...CTX,
      notePath: "Research/R&D <draft>.md",
      vaultName: "V",
    });
    expect(out.fields.Source).toContain(
      "file=Research%2FR%26D%20%3Cdraft%3E.md",
    );
    expect(out.fields.Source).toContain(
      '<small class="flashcards-source-path">Research/R&amp;D &lt;draft&gt;</small>',
    );
  });

  it("emits a Source even when vaultName is the empty string (vault= empty)", () => {
    const out = renderCardForAnki(baseCard({ blockId: "q-abcd" }), {
      ...CTX,
      vaultName: "",
    });
    expect(out.fields.Source).toContain("vault=&");
    expect(out.fields.Source).toMatch(
      /^<a class="flashcards-source" href="obsidian:\/\/open\?vault=&/,
    );
  });
});

// ============================================================================
// C. Basic card rendering
// ============================================================================

describe("renderCardForAnki — basic card markdown→HTML", () => {
  it("plain text wraps in <p>", () => {
    const out = renderCardForAnki(
      baseCard({ answer: "an answer", front: "a question" }),
      CTX,
    );
    expect(out.modelName).toBe(ANKI_MODEL_BASIC);
    expect(out.fields.Front).toBe("<p>a question</p>");
    expect(out.fields.Back).toBe("<p>an answer</p>");
    expect(out.fields.Context).toBe("");
  });

  it("`**bold**` → <strong>", () => {
    const out = renderCardForAnki(
      baseCard({ answer: "A", front: "**bold**" }),
      CTX,
    );
    expect(out.fields.Front).toContain("<strong>bold</strong>");
  });

  it("GFM `~~strike~~` → <del>", () => {
    const out = renderCardForAnki(
      baseCard({ answer: "A", front: "~~old~~" }),
      CTX,
    );
    expect(out.fields.Front).toContain("<del>old</del>");
  });

  it("renders callouts as blockquotes without leaking the control marker", () => {
    const out = renderCardForAnki(
      baseCard({
        answer: ["> [!quote] Readwise", "> Highlight text"].join("\n"),
      }),
      CTX,
    );

    expect(out.fields.Back).toContain("<blockquote>");
    expect(out.fields.Back).toContain("Readwise");
    expect(out.fields.Back).toContain("Highlight text");
    expect(out.fields.Back).not.toContain("[!quote]");
  });

  it("passes deckName and tags through verbatim", () => {
    const out = renderCardForAnki(baseCard(), {
      ...CTX,
      deckName: "Biology::Cells",
      tags: ["t1", "t2/sub"],
    });
    expect(out.deckName).toBe("Biology::Cells");
    expect(out.tags).toEqual(["t1", "t2/sub"]);
  });
});

// ============================================================================
// D. Reversed card
// ============================================================================

describe("renderCardForAnki — reversed", () => {
  it("keeps Context separate from both reversible content fields", () => {
    const out = renderCardForAnki(
      baseCard({
        answer: "The flag of France.",
        context: "Image in reversed",
        front: "![[flag.png]]",
        kind: "reversed",
      }),
      CTX,
    );
    expect(out.modelName).toBe(ANKI_MODEL_REVERSED);
    expect(Object.keys(out.fields).sort()).toEqual([
      "Back",
      "Context",
      "Front",
      "Source",
    ]);
    expect(out.fields.Context).toBe("<p>Image in reversed</p>");
    expect(out.fields.Front).toBe("<p>![[flag.png]]</p>");
    expect(out.fields.Back).toBe("<p>The flag of France.</p>");
    expect(out.fields.Front).not.toContain("Image in reversed");
    expect(out.fields.Back).not.toContain("Image in reversed");
  });
});

// ============================================================================
// E. Cloze conversion
// ============================================================================

describe("renderCardForAnki — cloze conversion", () => {
  function clozeCard(front: string, answer = ""): IdentifiedFlashcard {
    return baseCard({ answer, front, kind: "cloze" });
  }

  it("single `==word==` → `{{c1::word}}` in Text field", () => {
    const out = renderCardForAnki(clozeCard("hide ==word== here"), CTX);
    expect(out.fields.Text).toContain("{{c1::word}}");
    expect(out.fields.Text).not.toContain("==word==");
  });

  it("can leave highlights as Markdown while still converting explicit clozes", () => {
    const out = renderCardForAnki(
      clozeCard("keep ==highlight== and hide {2:answer}"),
      { ...CTX, highlightClozeEnabled: false },
    );

    expect(out.fields.Text).toContain("==highlight==");
    expect(out.fields.Text).toContain("{{c2::answer}}");
    expect(out.fields.Text).not.toContain("{{c1::highlight}}");
  });

  it("two `==a== ==b==` → c1, c2", () => {
    const out = renderCardForAnki(clozeCard("==a== ==b=="), CTX);
    expect(out.fields.Text).toContain("{{c1::a}}");
    expect(out.fields.Text).toContain("{{c2::b}}");
  });

  it("explicit `{2:b}` → `{{c2::b}}`", () => {
    const out = renderCardForAnki(clozeCard("only {2:b} here"), CTX);
    expect(out.fields.Text).toContain("{{c2::b}}");
  });

  it("mixed `==a== {3:b} ==c==` → c1, c3, c2 (explicit does NOT advance counter)", () => {
    // Locked rule: `{N:..}` uses N verbatim and does not bump the auto counter.
    // Auto counter starts at 1, increments only on `==...==` matches.
    const out = renderCardForAnki(clozeCard("==a== {3:b} ==c=="), CTX);
    expect(out.fields.Text).toContain("{{c1::a}}");
    expect(out.fields.Text).toContain("{{c3::b}}");
    expect(out.fields.Text).toContain("{{c2::c}}");
  });

  it("mixed `{1:a} ==b==` → both `{{c1::a}}` and `{{c1::b}}` (counter still at 1 after explicit)", () => {
    // Locked rule: explicit `{1:a}` doesn't advance counter, so next auto match
    // picks up the current counter value (1), then bumps it.
    const out = renderCardForAnki(clozeCard("{1:a} ==b=="), CTX);
    expect(out.fields.Text).toContain("{{c1::a}}");
    expect(out.fields.Text).toContain("{{c1::b}}");
  });

  it("preserves balanced LaTeX braces inside a numbered cloze", () => {
    const out = renderCardForAnki(
      clozeCard("First $a+b$, then {1:$c^{2}+d$}, then $e+f$."),
      CTX,
    );

    expect(out.fields.Text).toContain(String.raw`\(a+b\)`);
    expect(out.fields.Text).toContain(String.raw`{{c1::\(c^{2}+d\)}}`);
    expect(out.fields.Text).toContain(String.raw`\(e+f\)`);
    expect(out.fields.Text).not.toContain("<em>");
  });

  it("leaves native Anki cloze syntax unchanged", () => {
    const out = renderCardForAnki(clozeCard("{{c2::x^{2}}}"), CTX);
    expect(out.fields.Text).toContain("{{c2::x^{2}}}");
  });

  it("cloze markers survive the rehype pipeline as literal `{{cN::...}}` (NOT HTML-entity-escaped)", () => {
    const out = renderCardForAnki(clozeCard("==hello=="), CTX);
    // Must NOT be escaped to `&#123;&#123;…` or `&lbrace;`.
    expect(out.fields.Text).toMatch(/\{\{c1::hello\}\}/);
    expect(out.fields.Text).not.toContain("&#123;");
    expect(out.fields.Text).not.toContain("&lbrace;");
  });

  it("picks Obsidian-Cloze model and uses Text/Extra/Source fields", () => {
    const out = renderCardForAnki(
      clozeCard("a ==b== c", "extra info"),
      CTX,
    );
    expect(out.modelName).toBe(ANKI_MODEL_CLOZE);
    expect(Object.keys(out.fields).sort()).toEqual([
      "Context",
      "Extra",
      "Source",
      "Text",
    ]);
    expect(out.fields.Extra).toContain("extra info");
  });

  it("empty answer for cloze → Extra is empty string", () => {
    const out = renderCardForAnki(clozeCard("==x=="), CTX);
    expect(out.fields.Extra).toBe("");
  });

  it("multi-line cloze NOT supported: `==hello\\nworld==` stays unconverted", () => {
    // Locked: regex is single-line (`.+?`), not `[\s\S]+?`. Newlines inside
    // `==…==` do not match, so the literal markers survive into HTML. Final
    // HTML will contain the literal `==` runs (possibly inside <p> wrappers
    // or split across paragraphs depending on markdown), but MUST NOT contain
    // a `{{c1::...}}` token.
    const out = renderCardForAnki(clozeCard("==hello\nworld=="), CTX);
    expect(out.fields.Text).not.toMatch(/\{\{c\d+::/);
  });
});

// ============================================================================
// F. Tags & deckName passthrough
// ============================================================================

describe("renderCardForAnki — tags and deckName passthrough", () => {
  it("empty tags → empty array", () => {
    const out = renderCardForAnki(baseCard(), { ...CTX, tags: [] });
    expect(out.tags).toEqual([]);
  });

  it("nested tags with `/` preserved verbatim (Anki nested tag notation)", () => {
    const out = renderCardForAnki(baseCard(), {
      ...CTX,
      tags: ["a/b/c", "x"],
    });
    expect(out.tags).toEqual(["a/b/c", "x"]);
  });

  it("nested deck names with `::` preserved verbatim", () => {
    const out = renderCardForAnki(baseCard(), {
      ...CTX,
      deckName: "Top::Sub::Leaf",
    });
    expect(out.deckName).toBe("Top::Sub::Leaf");
  });
});

// ============================================================================
// G. Trailing newline trimmed
// ============================================================================

describe("renderCardForAnki — trailing newline trim", () => {
  it("final field strings have no trailing newline", () => {
    const out = renderCardForAnki(
      baseCard({ answer: "answer text", front: "question text" }),
      CTX,
    );
    expect(out.fields.Front.endsWith("\n")).toBe(false);
    expect(out.fields.Back.endsWith("\n")).toBe(false);
    expect(out.fields.Source.endsWith("\n")).toBe(false);
  });
});

// ============================================================================
// H. Fenced code blocks (containment assertion, version-tolerant)
// ============================================================================

describe("renderCardForAnki — code blocks", () => {
  it("inline `code` → exact `<code>code</code>`", () => {
    const out = renderCardForAnki(
      baseCard({ front: "use `x` here" }),
      CTX,
    );
    expect(out.fields.Front).toContain("<code>x</code>");
  });

  it("fenced ```js block → contains <pre> and <code> wrapping the code text", () => {
    // Locked at containment level only — remark-rehype versions vary on
    // exact attribute form for the language class.
    const out = renderCardForAnki(
      baseCard({ front: "```js\nconst a = 1;\n```" }),
      CTX,
    );
    expect(out.fields.Front).toContain("<pre>");
    expect(out.fields.Front).toContain("<code");
    expect(out.fields.Front).toContain("const a = 1;");
    expect(out.fields.Front).toContain("</code>");
    expect(out.fields.Front).toContain("</pre>");
  });
});

// ============================================================================
// I. Wikilink rewriting via optional resolveLink
// ============================================================================

describe("renderCardForAnki — wikilink rewriting", () => {
  const identityResolver = (target: string): string => target;

  // Locked: `resolveLink` is an OPTIONAL field on RenderContext (to be added by
  // the implementor). Until then, cast at the call site so this test file
  // typechecks cleanly without modifying any src/ file.
  type CtxWithResolver = typeof CTX & {
    resolveLink?: (target: string, sourcePath: string) => string | null;
  };
  const withResolver = (
    resolveLink: (target: string, sourcePath: string) => string | null,
  ): CtxWithResolver => ({ ...CTX, resolveLink });

  it("rewrites a wikilink in the front to an obsidian:// anchor when resolveLink is provided", () => {
    const out = renderCardForAnki(
      baseCard({ answer: "A", front: "see [[Note]]" }),
      withResolver(identityResolver),
    );
    expect(out.fields.Front).toContain(
      '<a href="obsidian://open?vault=MyVault&amp;file=Note">Note</a>',
    );
    expect(out.fields.Front).not.toContain("[[Note]]");
  });

  it("rewrites a wikilink in the answer (back) when resolveLink is provided", () => {
    const out = renderCardForAnki(
      baseCard({ answer: "see [[Note]]", front: "Q" }),
      withResolver(identityResolver),
    );
    expect(out.fields.Back).toContain(
      '<a href="obsidian://open?vault=MyVault&amp;file=Note">Note</a>',
    );
    expect(out.fields.Back).not.toContain("[[Note]]");
  });

  it("leaves wikilinks literal when resolveLink is undefined (no-resolver path preserves current behavior)", () => {
    const out = renderCardForAnki(
      baseCard({ answer: "A", front: "see [[Note]]" }),
      CTX,
    );
    expect(out.fields.Front).toContain("[[Note]]");
    expect(out.fields.Front).not.toContain("obsidian://open");
  });

  it("rewrites only the wikilinks the resolver resolves; unresolved ones stay literal", () => {
    const resolveLink = (target: string): string | null =>
      target === "Known" ? "Known" : null;
    const out = renderCardForAnki(
      baseCard({ answer: "A", front: "[[Known]] and [[Unknown]]" }),
      withResolver(resolveLink),
    );
    expect(out.fields.Front).toContain(
      '<a href="obsidian://open?vault=MyVault&amp;file=Known">Known</a>',
    );
    expect(out.fields.Front).toContain("[[Unknown]]");
    expect(out.fields.Front).not.toContain("[[Known]]");
  });

  it("cloze card: wikilink inside ==…== produces both the cloze and the rewritten link", () => {
    const out = renderCardForAnki(
      baseCard({ answer: "", front: "the ==[[Note]]== thing", kind: "cloze" }),
      withResolver(identityResolver),
    );
    expect(out.fields.Text).toMatch(/\{\{c1::/);
    expect(out.fields.Text).toContain("obsidian://open?vault=MyVault");
    expect(out.fields.Text).toContain("file=Note");
    expect(out.fields.Text).not.toContain("[[Note]]");
  });

  it("reversed card: wikilink in front is rewritten in Front field", () => {
    const out = renderCardForAnki(
      baseCard({ answer: "B", front: "ref [[Note]]", kind: "reversed" }),
      withResolver(identityResolver),
    );
    expect(out.modelName).toBe(ANKI_MODEL_REVERSED);
    expect(out.fields.Front).toContain(
      '<a href="obsidian://open?vault=MyVault&amp;file=Note">Note</a>',
    );
    expect(out.fields.Front).not.toContain("[[Note]]");
  });

  it("Source field is unaffected by the wikilink rewriter", () => {
    const out = renderCardForAnki(
      baseCard({ answer: "A", front: "[[Note]]", blockId: "q-abcd" }),
      withResolver(identityResolver),
    );
    expect(out.fields.Source).toBe(
      '<a class="flashcards-source" href="obsidian://open?vault=MyVault&file=Note.md#%5Eq-abcd"><span class="flashcards-source-action">Edit source in Obsidian ↗</span><br><small class="flashcards-source-path">Note</small></a>',
    );
  });
});
