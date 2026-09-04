import rehypeRaw from "rehype-raw";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import type { AnkiCreateModelSpec } from "../sync/anki-contract.js";
import type { IdentifiedFlashcard } from "../domain/card.js";
import { rewriteWikilinks } from "./rewrite-wikilinks.js";
import { renderClozeForAnki } from "../parse/cloze-syntax.js";
import {
  collectProtectedMarkdownSpans,
  parseMarkdownTree,
} from "../parse/markdown-tree.js";
import type { Nodes, Parent, Root } from "mdast";
import { visit } from "unist-util-visit";

// Names match v1 (lowercase) so v2 can extend the existing models in-place
// instead of creating parallel ones. Anki treats model names case-insensitively
// for uniqueness — `Obsidian-Basic` would collide with v1's `Obsidian-basic`
// and Anki would silently rename our creation to `Obsidian-Basic-<suffix>`,
// then route addNote calls to the v1 model (dropping the Source field).
export const ANKI_MODEL_BASIC = "Obsidian-basic";
export const ANKI_MODEL_REVERSED = "Obsidian-basic-reversed";
export const ANKI_MODEL_CLOZE = "Obsidian-cloze";
export const ANKI_MODEL_REMINDER = "Obsidian-reminder";

const DEFAULT_CSS = `/* flashcards-obsidian-managed:start */
.card {
  --flashcards-accent: #7056b3;
  --flashcards-accent-soft: #eee9fb;
  --flashcards-background: #f8f8f6;
  --flashcards-border: #deded9;
  --flashcards-code-background: #eeeeeb;
  --flashcards-muted: #6f716d;
  --flashcards-text: #20221f;
  margin: 0;
  padding: clamp(1.5rem, 6vw, 3rem);
  background: var(--flashcards-background);
  color: var(--flashcards-text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 20px;
  line-height: 1.58;
  text-align: left;
}

.nightMode,
.nightMode .card,
.night_mode .card {
  --flashcards-accent: #bda8ff;
  --flashcards-accent-soft: #302a44;
  --flashcards-background: #171816;
  --flashcards-border: #3b3d39;
  --flashcards-code-background: #242522;
  --flashcards-muted: #a7aaa3;
  --flashcards-text: #f0f1ed;
}

.flashcards-question,
.flashcards-reminder,
.flashcards-reminder-guidance,
.flashcards-context,
.flashcards-answer,
.flashcards-source-footer,
.flashcards-answer-divider {
  width: min(100%, 700px);
  margin-right: auto;
  margin-left: auto;
}

.flashcards-context {
  margin-bottom: 0.55rem;
  color: var(--flashcards-muted);
  font-size: 0.78em;
  font-weight: 650;
  letter-spacing: 0.01em;
}

.flashcards-context p {
  margin: 0;
}

.flashcards-question {
  font-size: 1.18em;
  font-weight: 600;
  letter-spacing: -0.018em;
  line-height: 1.4;
}

.flashcards-reminder {
  font-size: 1.08em;
}

.flashcards-reminder-guidance {
  color: var(--flashcards-muted);
  font-size: 0.86em;
  font-weight: 650;
}

.flashcards-answer-divider {
  margin-top: 2rem;
  margin-bottom: 2rem;
  border: 0;
  border-top: 2px solid var(--flashcards-accent);
}

.flashcards-source-footer {
  margin-top: 2.4rem;
  padding-top: 0.9rem;
  border-top: 1px solid var(--flashcards-border);
}

.flashcards-source {
  display: inline-flex;
  max-width: 100%;
  flex-direction: column;
  gap: 0.15rem;
  padding: 0.45rem 0.6rem;
  border: 1px solid var(--flashcards-border);
  border-radius: 0.45rem;
  color: var(--flashcards-text);
  text-decoration: none;
}

.flashcards-source:hover,
.flashcards-source:focus {
  border-color: var(--flashcards-accent);
}

.flashcards-source br {
  display: none;
}

.flashcards-source-action {
  color: var(--flashcards-accent);
  font-size: 0.72rem;
  font-weight: 700;
}

.flashcards-source-path {
  color: var(--flashcards-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.67rem;
  overflow-wrap: anywhere;
}

.cloze {
  padding: 0.05em 0.22em;
  border-radius: 0.25em;
  background: var(--flashcards-accent-soft);
  color: var(--flashcards-accent);
  font-weight: 700;
}

pre {
  padding: 0.8rem 0.9rem;
  border: 1px solid var(--flashcards-border);
  border-radius: 0.5rem;
  background: var(--flashcards-code-background);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.88em;
}

img {
  max-width: 100%;
  height: auto;
}

table {
  display: block;
  max-width: 100%;
  overflow-x: auto;
  border-collapse: collapse;
}

th,
td {
  padding: 0.4rem 0.55rem;
  border: 1px solid var(--flashcards-border);
}

blockquote {
  margin-left: 0;
  padding-left: 1rem;
  border-left: 3px solid var(--flashcards-border);
  color: var(--flashcards-muted);
}

@media (max-width: 480px) {
  .card {
    padding: 1.25rem;
    font-size: 18px;
  }
}
/* flashcards-obsidian-managed:end */
`;

export const ANKI_CONTEXT_TEMPLATE =
  '{{#Context}}<aside class="flashcards-context">{{Context}}</aside>{{/Context}}';
const BASIC_FRONT_TEMPLATE = `${ANKI_CONTEXT_TEMPLATE}<section class="flashcards-question">{{Front}}</section>`;
const BASIC_BACK_TEMPLATE =
  '{{FrontSide}}<hr id="answer" class="flashcards-answer-divider"><section class="flashcards-answer">{{Back}}</section><footer class="flashcards-source-footer">{{Source}}</footer>';
const REVERSED_FRONT_TEMPLATE = `${ANKI_CONTEXT_TEMPLATE}<section class="flashcards-question">{{Back}}</section>`;
const REVERSED_BACK_TEMPLATE =
  '{{FrontSide}}<hr id="answer" class="flashcards-answer-divider"><section class="flashcards-answer">{{Front}}</section><footer class="flashcards-source-footer">{{Source}}</footer>';
const CLOZE_FRONT_TEMPLATE = `${ANKI_CONTEXT_TEMPLATE}<section class="flashcards-question">{{cloze:Text}}</section>`;
const CLOZE_BACK_TEMPLATE = `${ANKI_CONTEXT_TEMPLATE}<section class="flashcards-question">{{cloze:Text}}</section>{{#Extra}}<hr id="answer" class="flashcards-answer-divider"><section class="flashcards-answer">{{Extra}}</section>{{/Extra}}<footer class="flashcards-source-footer">{{Source}}</footer>`;
const REMINDER_FRONT_TEMPLATE = `${ANKI_CONTEXT_TEMPLATE}<section class="flashcards-reminder">{{Content}}</section>`;
const REMINDER_BACK_TEMPLATE =
  '{{FrontSide}}<hr id="answer" class="flashcards-answer-divider"><section class="flashcards-reminder-guidance">How soon should this come back?</section><footer class="flashcards-source-footer">{{Source}}</footer>';

export interface RenderContext {
  /** Convert `==text==` to an Anki cloze. Default: true. */
  highlightClozeEnabled?: boolean;
  deckName: string;
  notePath: string;
  tags: string[];
  vaultName: string;
  resolveLink?: (target: string, sourcePath: string) => string | null;
}

export interface RenderedFields {
  // Anki note fields are a string→string map; these named fields are the
  // ones this renderer always produces. The index signature lets a
  // RenderedFields flow into the AnkiConnect `Record<string, string>` field
  // map without an unsafe cast.
  [field: string]: string;
  Content: string;
  Front: string;
  Back: string;
  Context: string;
  Text: string;
  Extra: string;
  Source: string;
}

export interface RenderedCard {
  deckName: string;
  modelName: string;
  fields: RenderedFields;
  tags: string[];
}

export function getAnkiModelSpecs(): AnkiCreateModelSpec[] {
  return [
    {
      modelName: ANKI_MODEL_BASIC,
      inOrderFields: ["Front", "Back", "Context", "Source"],
      isCloze: false,
      css: DEFAULT_CSS,
      cardTemplates: [
        {
          Name: "Card 1",
          Front: BASIC_FRONT_TEMPLATE,
          Back: BASIC_BACK_TEMPLATE,
        },
      ],
    },
    {
      modelName: ANKI_MODEL_REVERSED,
      inOrderFields: ["Front", "Back", "Context", "Source"],
      isCloze: false,
      css: DEFAULT_CSS,
      cardTemplates: [
        {
          Name: "Card 1",
          Front: BASIC_FRONT_TEMPLATE,
          Back: BASIC_BACK_TEMPLATE,
        },
        {
          Name: "Card 2",
          Front: REVERSED_FRONT_TEMPLATE,
          Back: REVERSED_BACK_TEMPLATE,
        },
      ],
    },
    {
      modelName: ANKI_MODEL_CLOZE,
      inOrderFields: ["Text", "Extra", "Context", "Source"],
      isCloze: true,
      css: DEFAULT_CSS,
      cardTemplates: [
        {
          Name: "Card 1",
          Front: CLOZE_FRONT_TEMPLATE,
          Back: CLOZE_BACK_TEMPLATE,
        },
      ],
    },
    {
      modelName: ANKI_MODEL_REMINDER,
      inOrderFields: ["Content", "Context", "Source"],
      isCloze: false,
      css: DEFAULT_CSS,
      cardTemplates: [
        {
          Name: "Card 1",
          Front: REMINDER_FRONT_TEMPLATE,
          Back: REMINDER_BACK_TEMPLATE,
        },
      ],
    },
  ];
}

/** Shared strict cloze grammar; Markdown code and math nodes stay opaque. */
function convertCloze(src: string, highlightClozeEnabled: boolean): string {
  const tree = parseMarkdownTree(src);
  return renderClozeForAnki(src, collectProtectedMarkdownSpans(tree), {
    auto: highlightClozeEnabled,
  });
}

function remarkMathToAnki() {
  return (tree: Root): void => {
    visit(tree, (node: Nodes, index, parent) => {
      if (
        (node.type !== "inlineMath" && node.type !== "math") ||
        index === undefined ||
        parent === undefined
      ) return;

      const delimiter = node.type === "inlineMath" ? ["\\(", "\\)"] : ["\\[", "\\]"];
      (parent as Parent).children[index] = {
        type: "text",
        value: `${delimiter[0]}${node.value}${delimiter[1]}`,
      };
    });
  };
}

function remarkCalloutsToAnki() {
  return (tree: Root): void => {
    visit(tree, "blockquote", (node) => {
      const first = node.children[0];
      if (first?.type !== "paragraph") return;
      const firstText = first.children[0];
      if (firstText?.type !== "text") return;
      const cleaned = firstText.value.replace(
        /^\[![^\]\r\n]+\][+-]?[ \t]*(?::[ \t]*)?/,
        "",
      );
      if (cleaned === firstText.value) return;
      if (cleaned.length > 0) {
        firstText.value = cleaned;
        return;
      }
      first.children.shift();
      if (first.children.length === 0) node.children.shift();
    });
  };
}

const processor = unified()
  .use(remarkParse)
  .use(remarkMath)
  .use(remarkGfm)
  .use(remarkCalloutsToAnki)
  .use(remarkMathToAnki)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  .use(rehypeStringify, { characterReferences: { useNamedReferences: true } });

function md(src: string): string {
  const out = String(processor.processSync(src));
  return out.replace(/\s+$/, "");
}

function buildSourceLink(ctx: RenderContext, blockId: string): string {
  const vault = encodeURIComponent(ctx.vaultName);
  const file = encodeURIComponent(ctx.notePath);
  const frag = encodeURIComponent(blockId);
  const url = `obsidian://open?vault=${vault}&file=${file}#%5E${frag}`;
  const path = escapeHtml(ctx.notePath.replace(/\.md$/i, ""));
  return `<a class="flashcards-source" href="${url}"><span class="flashcards-source-action">Edit source in Obsidian ↗</span><br><small class="flashcards-source-path">${path}</small></a>`;
}

function escapeHtml(value: string): string {
  const replacements: Record<string, string> = {
    "&": "&amp;",
    "'": "&#39;",
    '"': "&quot;",
    "<": "&lt;",
    ">": "&gt;",
  };
  return value.replace(/[&<>"']/g, (character) => replacements[character]!);
}

export function renderCardForAnki(
  card: IdentifiedFlashcard,
  ctx: RenderContext,
): RenderedCard {
  const source = buildSourceLink(ctx, card.blockId);

  const resolveLink = ctx.resolveLink;
  const rewrite = (src: string): string =>
    resolveLink === undefined
      ? src
      : rewriteWikilinks(src, {
          vaultName: ctx.vaultName,
          sourcePath: ctx.notePath,
          resolveLink,
        });
  const context = card.context === undefined ? "" : md(rewrite(card.context));

  if (card.kind === "cloze") {
    const text = md(
      convertCloze(rewrite(card.front), ctx.highlightClozeEnabled ?? true),
    );
    const extra = card.answer === "" ? "" : md(rewrite(card.answer));
    return {
      deckName: ctx.deckName,
      modelName: ANKI_MODEL_CLOZE,
      fields: {
        Text: text,
        Extra: extra,
        Context: context,
        Source: source,
      } as RenderedFields,
      tags: ctx.tags,
    };
  }

  if (card.kind === "reminder") {
    return {
      deckName: ctx.deckName,
      modelName: ANKI_MODEL_REMINDER,
      fields: {
        Content: md(rewrite(card.front)),
        Context: context,
        Source: source,
      } as RenderedFields,
      tags: ctx.tags,
    };
  }

  const modelName =
    card.kind === "reversed" ? ANKI_MODEL_REVERSED : ANKI_MODEL_BASIC;
  return {
    deckName: ctx.deckName,
    modelName,
    fields: {
      Front: md(rewrite(card.front)),
      Back: md(rewrite(card.answer)),
      Context: context,
      Source: source,
    } as RenderedFields,
    tags: ctx.tags,
  };
}
