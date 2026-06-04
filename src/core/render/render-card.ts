import rehypeRaw from "rehype-raw";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import type { AnkiCreateModelSpec } from "../sync/anki-contract.js";
import type { IdentifiedFlashcard } from "../domain/card.js";
import { rewriteWikilinks } from "./rewrite-wikilinks.js";

// Names match v1 (lowercase) so v2 can extend the existing models in-place
// instead of creating parallel ones. Anki treats model names case-insensitively
// for uniqueness — `Obsidian-Basic` would collide with v1's `Obsidian-basic`
// and Anki would silently rename our creation to `Obsidian-Basic-<suffix>`,
// then route addNote calls to the v1 model (dropping the Source field).
export const ANKI_MODEL_BASIC = "Obsidian-basic";
export const ANKI_MODEL_REVERSED = "Obsidian-basic-reversed";
export const ANKI_MODEL_CLOZE = "Obsidian-cloze";

const DEFAULT_CSS =
  ".card {\n font-family: arial;\n font-size: 20px;\n text-align: center;\n color: black;\n background-color: white;\n}\n";

const BACK_TEMPLATE = "{{FrontSide}}<hr id=answer>{{Back}}<br><br>{{Source}}";

export interface RenderContext {
  deckName: string;
  notePath: string;
  tags: string[];
  vaultName: string;
  resolveLink?: (target: string, sourcePath: string) => string | null;
}

export interface RenderedFields {
  Front: string;
  Back: string;
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
      inOrderFields: ["Front", "Back", "Source"],
      isCloze: false,
      css: DEFAULT_CSS,
      cardTemplates: [{ Name: "Card 1", Front: "{{Front}}", Back: BACK_TEMPLATE }],
    },
    {
      modelName: ANKI_MODEL_REVERSED,
      inOrderFields: ["Front", "Back", "Source"],
      isCloze: false,
      css: DEFAULT_CSS,
      cardTemplates: [
        { Name: "Card 1", Front: "{{Front}}", Back: BACK_TEMPLATE },
        {
          Name: "Card 2",
          Front: "{{Back}}",
          Back: "{{FrontSide}}<hr id=answer>{{Front}}<br><br>{{Source}}",
        },
      ],
    },
    {
      modelName: ANKI_MODEL_CLOZE,
      inOrderFields: ["Text", "Extra", "Source"],
      isCloze: true,
      css: DEFAULT_CSS,
      cardTemplates: [
        {
          Name: "Card 1",
          Front: "{{cloze:Text}}",
          Back: "{{cloze:Text}}<br>{{Extra}}<br><br>{{Source}}",
        },
      ],
    },
  ];
}

/**
 * Single-pass cloze conversion.
 * `==x==` → `{{c<auto++>::x}}`. `{N:x}` → `{{cN::x}}` (no counter bump).
 * Single-line only (`.+?`).
 */
function convertCloze(src: string): string {
  let counter = 1;
  return src.replace(/==(.+?)==|\{(\d+):(.+?)\}/g, (_m, autoBody, n, expBody) => {
    if (autoBody !== undefined) {
      return `{{c${counter++}::${autoBody}}}`;
    }
    return `{{c${n}::${expBody}}}`;
  });
}

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
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
  return `<a href="${url}">Open in Obsidian</a>`;
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

  if (card.kind === "cloze") {
    const text = md(convertCloze(rewrite(card.front)));
    const extra = card.answer === "" ? "" : md(rewrite(card.answer));
    return {
      deckName: ctx.deckName,
      modelName: ANKI_MODEL_CLOZE,
      fields: { Text: text, Extra: extra, Source: source } as RenderedFields,
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
      Source: source,
    } as RenderedFields,
    tags: ctx.tags,
  };
}
